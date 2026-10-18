#!/usr/bin/env node
// 왜이슈 콘텐츠 도구 (외부 패키지 없이 Node만으로 동작해요)
//
//   node scripts/content.mjs validate   categories.json / today.json / terms.json 규칙 검사 (어기면 종료 코드 1)
//   node scripts/content.mjs merge      today.json 의 카드를 terms.json(사전)에 합치기
//   node scripts/content.mjs recent     최근 2주 해설을 분야마다 7개까지 모은 recent.json 만들기 (사이트·앱을 올릴 때 자동으로 만들어져요. 저장소에는 올리지 않아요)
//   node scripts/content.mjs check <카드목록.json>   새 카드 후보 파일이 규칙에 맞는지만 검사 (사전·today 는 건드리지 않아요)
//   node scripts/content.mjs add <카드목록.json>     검사를 통과한 지난 카드를 사전(terms.json)에만 추가 (오늘 카드는 today.json + merge 로 올려요)
//   node scripts/content.mjs verify-media [--prune]  카드에 붙인 유튜브 영상이 실제로 있고 다른 곳에서 재생이 허용되는지 유튜브에 물어봐요
//                                                     (인터넷이 되는 GitHub Actions 에서 써요. --prune 이면 막힌 영상만 올릴 파일에서 빼요)
//
// 옵션: --site <폴더>   기본값은 site
//
// 규칙의 목적: 출처 없는 내용, 민감한 주제, 너무 긴 글, 올린 곳이 불분명한 영상, 며칠 전·지난달 기사에 기댄 '오늘 소식'이 앱에 올라가지 않게 막는 안전장치예요.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const command = argv[0];
const siteIdx = argv.indexOf('--site');
const siteDir = resolve(siteIdx >= 0 ? argv[siteIdx + 1] : 'site');
const TODAY_PATH = join(siteDir, 'data', 'today.json');
const TERMS_PATH = join(siteDir, 'data', 'terms.json');
const CATEGORIES_PATH = join(siteDir, 'data', 'categories.json');
const RECENT_PATH = join(siteDir, 'data', 'recent.json');

// 분야 목록은 site/data/categories.json 하나만 기준이에요. (앱 화면과 이 검사가 같은 파일을 읽어요)
// loadCategories() 가 그 파일의 id 로 채워요.
let GROUPS = [];
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
// 하루 카드는 여러 분야에 골고루 있어야 '내 분야' 만 골라 본 사람도 매일 볼 거리가 있어요.
// 앱은 고른 분야마다 오늘 해설 + 최근 2주 해설을 합쳐 최대 FEED_MAX_PER_GROUP 개를 보여줘요. 그래서 분야마다 하루 1~2개씩 꾸준히 쌓여야 해요.
const MIN_CARDS_PER_DAY = 7;
const MAX_CARDS_PER_DAY = 14;
const MIN_GROUPS_PER_DAY = 5; // 하루 카드가 걸쳐야 하는 서로 다른 분야 수
const MAX_PER_GROUP_PER_DAY = 4; // 한 분야가 하루 카드를 독차지하지 않게
const RECENT_DAYS = 14; // 앱 분야별 목록에 쓰는 지난 해설 기간 (오늘 포함 14일)
const FEED_MAX_PER_GROUP = 7; // 앱이 분야마다 보여주는 최대 개수 (recent.json 도 분야마다 이만큼만 담아요)
const FEED_MIN_PER_GROUP = 5; // 분야마다 최근 RECENT_DAYS 일 안에 이만큼은 있어야 해요 (모자라면 validate 가 알려줘요)
// '오늘 뜨는' 소식이 며칠 전·지난달 기사에 기대지 않게 해요. 아래 일수는 모두 카드 날짜(date) 기준이에요.
//  - 모든 출처가 MAX_SOURCE_AGE_DAYS 일 안에 나온 기사여야 해요.
//  - 가장 최근 출처는 NEWEST_SOURCE_MAX_DAYS 일 안(카드 날짜 당일~전날)에 나온 기사여야 해요.
//  - FRESH_SOURCE_DAYS 일 안에 나온 기사가 서로 다른 매체 MIN_FRESH_OUTLETS 곳 이상이어야 해요.
// 유행어·밈(meme 분야)은 기사가 드문드문 올라와서 기준을 조금 넓혀요 (MEME_*).
// 오늘 카드와 `check`/`add` 후보에는 이 기준이 에러로 적용돼요. 사전(terms.json)에 이미 있는 카드는 지우지 않지만,
// 이 기준을 못 넘으면 앱의 '최근 2주' 목록(recent.json)에서는 빠져요 (사전 화면에는 그대로 있어요).
const MAX_SOURCE_AGE_DAYS = 14;
const NEWEST_SOURCE_MAX_DAYS = 1;
const FRESH_SOURCE_DAYS = 3;
const MEME_NEWEST_SOURCE_MAX_DAYS = 3;
const MEME_FRESH_SOURCE_DAYS = 7;
const MIN_FRESH_OUTLETS = 2;

// 해설 화면에 붙이는 영상 규칙.
// 기사 사진·짤·캡처는 저작권 때문에 가져다 쓰지 않아요. 영상은 유튜브 공식 플레이어로만 보여줘요(영상은 올린 곳에서 그대로 재생돼요).
// 아무 영상이나 붙지 않도록 '누가 올린 영상인지'를 두 가지로 제한하고, 카드마다 그 채널 이름과 제목을 적어 둬요.
//   official: 그 소식의 당사자나 권리를 가진 곳(가수·소속사·기업·구단·리그·게임사·영화 제작·배급사·방송 프로그램 등)이 직접 운영하는 채널의 영상
//   news:     NEWS_CHANNELS 에 있는 방송·언론사 채널의 영상
// 리액션·모음·재업로드·개인 편집본·제목으로 낚는 영상은 쓰지 않아요. 갱신 담당이 영상 페이지를 직접 열어 제목·채널·날짜를 확인한 것만 넣어요.
// (예전 형식 — channel 없이 from 만 있는 항목: 출처로 단 기사 페이지에 매체가 직접 실어 둔 영상 — 도 그대로 받아요.)
const VIDEO_KINDS = ['official', 'news'];
const VIDEO_CHANNEL_MAX = 40;
const VIDEO_TITLE_MAX = 120;
// 뉴스 채널 허용 목록. 유튜브에 보이는 채널 이름 그대로예요(대소문자·띄어쓰기는 가리지 않아요).
// 새 채널을 허용하려면 채널 이름을 직접 열어 방송·언론사가 운영하는 곳인지 확인한 뒤 여기에 추가해요.
const NEWS_CHANNELS = [
  'YTN', 'YTN star', 'YTN dmb', 'YTN 사이언스', 'YTN 사이언스 투데이',
  'SBS 뉴스', 'SBS News', 'SBS Biz', 'SBS 연예뉴스',
  'KBS News', 'KBS 뉴스',
  'MBCNEWS', 'MBC 뉴스',
  'JTBC News',
  '채널A News', '채널A 뉴스',
  'MBN News', 'TV CHOSUN News',
  '연합뉴스TV', '연합뉴스TV Yonhap News TV', '연합뉴스 Yonhapnews', '연합뉴스',
  // 신문사·방송사가 직접 운영하는 영상 채널: 서울경제TV(서울경제), 14F 일사에프(한국일보), 전자신문 etnews(전자신문), 엠빅뉴스(MBC), Arirang News(아리랑TV)
  '서울경제TV', '14F 일사에프', '전자신문 etnews', '엠빅뉴스', 'Arirang News',
  // 지역 방송사 뉴스 채널(지역 행사·소식은 전국 방송보다 지역 방송사에 영상이 있는 경우가 많아요): 대전MBC 뉴스(대전MBC, 2026-10-18 추가)
  '대전MBC 뉴스',
  'ABC News', 'Bloomberg Television', 'CNBC Television', 'Reuters', 'BBC News', 'CNN', 'Associated Press', 'NBC News', 'CBS News', 'Sky News'
];
// 제목에 이런 말이 있으면 반응 영상·모음·자극적인 영상일 가능성이 커서 쓰지 않아요.
const VIDEO_TITLE_BLOCKED = /리액션|reaction|해외\s*반응|반응\s*영상|모음|compilation|충격|경악|폭로|논란|의혹|ㄷㄷ/i;
// 많이 본 관련 영상(clips) 규칙 (2026-10-18 사용자 요청: 'L을 가져가' 처럼 유튜브에 연관 영상이 많은 말).
// 뉴스·공식 채널 영상(media)이 없는 밈·신조어 카드에, 그 말로 유튜브를 검색해 찾은 '많이 본 영상'을 카드당 CLIP_MAX 개까지 붙여요.
// 올린 곳이 일반 채널이어도 받는 대신 이렇게 걸러요: (1) 조회수 CLIP_MIN_VIEWS 이상 (갱신 담당이 영상 페이지에서 읽은 숫자, 그 뒤로는 늘기만 하니 '이상'으로 보여줘요),
// (2) 영상 제목에 카드 키워드가 그대로 들어 있어야 해요(연관성), (3) 제목에 반응·모음·자극적인 말이나 아이(미성년자)가 주인공이라는 단서가 없어야 해요.
// 영상 안의 내용은 우리가 확인할 수 없으니 앱이 '유튜브에 올라온 영상이에요. 내용은 왜이슈?와 관계없어요'라고 알려줘요. clips 는 출처(sources)가 아니에요.
const CLIP_GROUPS = ['meme'];
const CLIP_MAX = 2;
const CLIP_MIN_VIEWS = 100000;
const CLIP_TITLE_BLOCKED = /초등|초딩|중딩|고딩|어린이|유치원|키즈|\bkids?\b|아기|애기|베이비|꼬마|청소년|미성년/i;
// 예전 형식(from) 영상을 가져오는 기사 매체
const VIDEO_FROM_HOSTS = [
  'www.ytn.co.kr', // 확인됨: 기사 페이지에 자사 유튜브 영상을 싣는 매체
  'www.yna.co.kr',
  'www.yonhapnewstv.co.kr',
  'news.sbs.co.kr',
  'imnews.imbc.com',
  'news.kbs.co.kr',
  'news.jtbc.co.kr'
];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function normName(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s·・\-_.'’"]/g, '');
}
const NEWS_CHANNEL_KEYS = new Set(NEWS_CHANNELS.map(normName));

// 다루지 않기로 한 주제의 단서가 되는 말들이에요. 걸리면 그 카드는 빼거나 다시 써야 해요.
const BLOCKED_WORDS = [
  // 정치·선거
  '대통령', '국회', '의원', '정당', '여당', '야당', '탄핵', '선거', '총선', '대선', '민주당', '국민의힘', '정부 비판',
  // 수사·재판·사건사고
  '검찰', '경찰', '수사', '재판', '기소', '구속', '체포', '영장', '혐의', '판결', '실형', '고소', '고발',
  '사망', '숨져', '숨진', '별세', '부고', '자살', '극단적 선택', '살인', '폭행', '성폭행', '성추행', '성범죄', '마약',
  '불륜', '학교폭력', '학폭', '참사', '화재', '붕괴', '추락', '교통사고',
  // 갈등·분쟁
  '시위', '집회', '파업', '전쟁', '테러', '북한', '미사일'
];

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

function readJson(path) {
  if (!existsSync(path)) throw new Error(`파일이 없어요: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`JSON 형식이 올바르지 않아요 (${path}): ${e.message}`);
  }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function textLen(s) {
  return [...s].length;
}

function checkString(where, field, value, min, max) {
  if (typeof value !== 'string') return err(where, `${field} 는 글자여야 해요`);
  if (value !== value.trim()) err(where, `${field} 앞뒤에 공백이 있어요`);
  const n = textLen(value.trim());
  if (n < min || n > max) err(where, `${field} 길이는 ${min}~${max}자여야 해요 (지금 ${n}자)`);
}

function scanBlocked(where, label, text) {
  for (const w of BLOCKED_WORDS) {
    if (text.includes(w)) err(where, `${label} 에 다루지 않는 주제의 단서 '${w}' 가 있어요`);
  }
}

// 분야 목록 파일 검사. 통과한 id 들이 GROUPS 가 돼요.
function loadCategories() {
  const where = 'categories.json';
  const cats = readJson(CATEGORIES_PATH);
  if (cats.schema !== 1) err(where, 'schema 는 1 이어야 해요');
  // revision: 분야 구성을 크게 바꿀 때마다 1씩 올려요. 앱이 이 번호가 바뀐 걸 보면 옛 선택을 새 분야로 옮기고(replaces) 한 번 다시 고르게 안내해요.
  if (cats.revision !== undefined && (!Number.isInteger(cats.revision) || cats.revision < 1)) err(where, 'revision 은 1 이상의 정수여야 해요');
  if (!Array.isArray(cats.groups) || cats.groups.length < 2 || cats.groups.length > 12) {
    err(where, 'groups 는 2~12개의 목록이어야 해요');
    return cats;
  }
  const ids = new Set();
  cats.groups.forEach((g, i) => {
    const w = `${where}.groups[${i}]`;
    if (!g || typeof g !== 'object' || Array.isArray(g)) return err(w, '객체가 아니에요');
    if (typeof g.id !== 'string' || !/^[a-z][a-z0-9]{1,11}$/.test(g.id)) err(w, 'id 는 영문 소문자로 시작하는 2~12자(소문자·숫자)여야 해요');
    else if (ids.has(g.id)) err(w, `id 가 중복돼요: ${g.id}`);
    else ids.add(g.id);
    checkString(w, 'label', g.label, 1, 12);
    checkString(w, 'hint', g.hint, 1, 30);
    if (typeof g.icon !== 'string' || !/^[a-z]{2,12}$/.test(g.icon)) err(w, 'icon 은 영문 소문자 이름이어야 해요');
    for (const k of ['a1', 'a2']) if (typeof g[k] !== 'string' || !HEX_COLOR.test(g[k])) err(w, `${k} 는 #RRGGBB 색이어야 해요`);
    if (g.ink !== undefined && (typeof g.ink !== 'string' || !HEX_COLOR.test(g.ink))) err(w, 'ink 는 #RRGGBB 색이어야 해요');
    // replaces: 이 분야가 대신하게 된 옛 분야 id. 앱이 옛 선택을 새 분야로 옮길 때 써요. since: 이 분야가 생긴 revision(그 revision 에만 '새 분야' 표시가 붙어요)
    if (g.replaces !== undefined && (!Array.isArray(g.replaces) || g.replaces.length > 6 || !g.replaces.every((x) => typeof x === 'string' && /^[a-z][a-z0-9]{1,11}$/.test(x)))) {
      err(w, 'replaces 는 없어진 옛 분야 id(영문 소문자) 목록이어야 해요');
    }
    if (g.since !== undefined && (!Number.isInteger(g.since) || g.since < 1 || g.since > (Number.isInteger(cats.revision) ? cats.revision : 1))) {
      err(w, 'since 는 이 분야가 생긴 revision 번호(1 이상, 지금 revision 이하)여야 해요');
    }
  });
  const labels = cats.groups.map((g) => g && g.label);
  if (new Set(labels).size !== labels.length) err(where, '분야 이름(label)이 겹쳐요');
  const replacedBy = new Map();
  for (const g of cats.groups) {
    if (!g || !Array.isArray(g.replaces)) continue;
    for (const old of g.replaces) {
      if (ids.has(old)) err(where, `replaces 에 적은 ${old} 는 지금도 있는 분야예요`);
      else if (replacedBy.has(old)) err(where, `옛 분야 ${old} 를 ${replacedBy.get(old)} 와 ${g.id} 가 함께 대신한다고 적혀 있어요`);
      else replacedBy.set(old, g.id);
    }
  }
  GROUPS = [...ids];
  return cats;
}

function validateCard(card, where) {
  if (!card || typeof card !== 'object') return err(where, '카드가 객체가 아니에요');
  if (typeof card.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(card.id) || card.id.length > 40) {
    err(where, 'id 는 영문 소문자·숫자·하이픈만 쓰고 40자 이하여야 해요');
  }
  if (!isRealDate(card.date)) err(where, 'date 는 YYYY-MM-DD 형식의 실제 날짜여야 해요');
  if (!GROUPS.includes(card.group)) err(where, `group 은 ${GROUPS.join(' / ')} 중 하나여야 해요`);
  checkString(where, 'cat', card.cat, 1, 8);
  checkString(where, 'keyword', card.keyword, 1, 24);
  checkString(where, 'line', card.line, 4, 48);
  checkString(where, 'meaning', card.meaning, 10, 260);

  if (!Array.isArray(card.why) || card.why.length < 2 || card.why.length > 4) {
    err(where, 'why 는 2~4개의 문장이어야 해요');
  } else {
    card.why.forEach((w, i) => checkString(where, `why[${i}]`, w, 10, 220));
  }

  if (card.example !== undefined) checkString(where, 'example', card.example, 4, 120);

  if (!Array.isArray(card.sources) || card.sources.length < 2) {
    err(where, 'sources 는 2곳 이상이어야 해요');
  } else {
    const names = new Set();
    const urls = new Set();
    card.sources.forEach((s, i) => {
      const w = `${where}.sources[${i}]`;
      if (!s || typeof s !== 'object') return err(w, '출처가 객체가 아니에요');
      checkString(w, 'name', s.name, 1, 20);
      checkString(w, 'title', s.title, 1, 140);
      if (!isRealDate(s.published)) err(w, 'published 는 YYYY-MM-DD 형식의 실제 날짜여야 해요');
      else if (isRealDate(card.date) && s.published > card.date) err(w, 'published 가 카드 날짜보다 늦어요');
      try {
        const u = new URL(s.url);
        if (u.protocol !== 'https:') err(w, 'url 은 https 로 시작해야 해요');
        if (!u.hostname.includes('.')) err(w, 'url 의 도메인이 올바르지 않아요');
        if (u.username || u.password) err(w, 'url 에 계정 정보가 들어 있어요');
      } catch {
        err(w, 'url 이 올바르지 않아요');
      }
      if (urls.has(s.url)) err(w, '같은 url 이 중복돼요');
      urls.add(s.url);
      if (typeof s.name === 'string') names.add(s.name.trim());
      if (typeof s.title === 'string') scanBlocked(w, 'title', s.title);
    });
    if (names.size < 2) err(where, '서로 다른 매체의 출처가 2곳 이상이어야 해요');
  }

  for (const f of ['keyword', 'line', 'meaning', 'example']) {
    if (typeof card[f] === 'string') scanBlocked(where, f, card[f]);
  }
  if (Array.isArray(card.why)) card.why.forEach((w, i) => typeof w === 'string' && scanBlocked(where, `why[${i}]`, w));

  validateMedia(card, where);
  validateClips(card, where);
  validateScene(card, where);
}

// scene 은 선택 항목이에요. 영상이 없는 해설에 앱이 '이모지로 만든 한 장면'을 분야별 그림 카드 위에 보여줘요.
// 사진·짤·캡처는 출처를 달아도 저작권 문제가 있어서 쓰지 않고, 우리가 직접 고른 이모지로 뜻을 바로 떠올리게 하려는 거예요.
// 형식: "scene": ["🎮", "😝", "L", "🏳️"]  (2~4칸, 칸마다 이모지 한 개이거나 영문·숫자 1~3자. 이모지는 1개 이상)
const SCENE_EMOJI = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*$/u;
const SCENE_CHIP = /^[A-Za-z0-9?!]{1,3}$/;
function validateScene(card, where) {
  if (card.scene === undefined) return;
  if (!Array.isArray(card.scene) || card.scene.length < 2 || card.scene.length > 4) {
    return err(where, 'scene 은 2~4칸짜리 목록이어야 해요 (장면이 없으면 scene 항목 자체를 빼세요)');
  }
  card.scene.forEach((x, i) => {
    if (typeof x !== 'string' || !(SCENE_EMOJI.test(x) || SCENE_CHIP.test(x))) {
      err(`${where}.scene[${i}]`, '칸마다 이모지 한 개이거나 영문·숫자 1~3자여야 해요');
    }
  });
  if (!card.scene.some((x) => typeof x === 'string' && SCENE_EMOJI.test(x))) err(where, 'scene 에는 이모지가 1개 이상 있어야 해요');
}

// media 는 선택 항목이에요. 없으면 앱이 분야별 그림 카드를 대신 보여줘요.
// 형식: "media": [{ "type": "video", "provider": "youtube", "id": "11글자", "kind": "official 또는 news",
//                   "channel": "유튜브에 보이는 채널 이름", "title": "유튜브에 적힌 영상 제목", "from": "(선택) 영상을 소개한 출처 기사 주소" }]
// 예전 형식(channel·kind·title 없이 from 만 있는 영상)도 받아요: { "type", "provider", "id", "from": "출처로 단 기사 주소" }
function validateMedia(card, where) {
  if (card.media === undefined) return;
  if (!Array.isArray(card.media) || card.media.length !== 1) {
    return err(where, 'media 는 영상 1개짜리 목록이어야 해요 (영상이 없으면 media 항목 자체를 빼세요)');
  }
  card.media.forEach((m, i) => {
    const w = `${where}.media[${i}]`;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return err(w, '객체가 아니에요');
    if (m.type !== 'video') return err(w, "type 은 'video' 만 쓸 수 있어요");
    const extra = Object.keys(m).filter((k) => !['type', 'provider', 'id', 'kind', 'channel', 'title', 'from'].includes(k));
    if (extra.length) err(w, `쓸 수 없는 항목이 있어요: ${extra.join(', ')}`);
    if (m.provider !== 'youtube') err(w, "provider 는 'youtube' 여야 해요");
    if (typeof m.id !== 'string' || !YOUTUBE_ID.test(m.id)) err(w, 'id 는 유튜브 영상 주소의 11글자 번호여야 해요 (영문·숫자·-·_)');
    const from = Array.isArray(card.sources) && m.from !== undefined ? card.sources.find((s) => s && s.url === m.from) : undefined;
    const legacy = m.kind === undefined && m.channel === undefined && m.title === undefined;

    if (legacy) {
      // 예전 형식: 출처로 단 기사(허용 매체)에 실린 영상
      if (!from) {
        err(w, 'from 은 이 카드의 출처(sources)에 들어 있는 기사 주소여야 해요');
      } else {
        try {
          const host = new URL(from.url).hostname;
          if (!VIDEO_FROM_HOSTS.includes(host)) err(w, `${host} 기사에서는 영상을 가져오지 않아요 (허용 매체: ${VIDEO_FROM_HOSTS.join(', ')})`);
        } catch {
          /* 주소 형식 오류는 sources 검사에서 이미 알려줘요 */
        }
      }
      return;
    }

    // 새 형식: 누가 올린 영상인지(kind·channel)와 제목을 함께 적어요
    if (!VIDEO_KINDS.includes(m.kind)) err(w, `kind 는 ${VIDEO_KINDS.join(' / ')} 중 하나여야 해요 (official: 당사자·권리를 가진 곳의 공식 채널, news: 방송·언론사 뉴스 채널)`);
    checkString(w, 'channel', m.channel, 1, VIDEO_CHANNEL_MAX);
    checkString(w, 'title', m.title, 1, VIDEO_TITLE_MAX);
    if (typeof m.channel === 'string') scanBlocked(w, 'channel', m.channel);
    if (typeof m.title === 'string') {
      scanBlocked(w, 'title', m.title);
      if (VIDEO_TITLE_BLOCKED.test(m.title)) err(w, `영상 제목에 반응 영상·모음·자극적인 영상의 단서가 있어요: ${m.title}`);
    }
    if (m.kind === 'news' && typeof m.channel === 'string' && !NEWS_CHANNEL_KEYS.has(normName(m.channel))) {
      err(w, `'${m.channel}' 은(는) 뉴스 채널 허용 목록에 없어요. 방송·언론사 채널이 맞다면 content.mjs 의 NEWS_CHANNELS 에 먼저 추가하고, 아니면 official(당사자 공식 채널)인 경우에만 쓰세요`);
    }
    if (m.from !== undefined && !from) err(w, 'from 을 쓴다면 이 카드의 출처(sources)에 들어 있는 기사 주소여야 해요');
  });
}

// clips 는 선택 항목이에요(밈·신조어 카드만). 뉴스·공식 영상이 없는 말에, 유튜브에서 그 말로 검색해 찾은 '많이 본 영상'을 보여줘요.
// 형식: "clips": [{ "type": "video", "provider": "youtube", "id": "11글자", "channel": "유튜브에 보이는 채널 이름", "title": "유튜브에 적힌 영상 제목", "views": 300263 }]
//   views: 갱신 담당이 영상 페이지에서 읽은 조회수예요(CLIP_MIN_VIEWS 이상). 페이지에서 읽을 수 없는 영상은 쓰지 않아요.
function validateClips(card, where) {
  if (card.clips === undefined) return;
  if (!CLIP_GROUPS.includes(card.group)) return err(where, `clips 는 ${CLIP_GROUPS.join('·')} 분야 카드에만 붙일 수 있어요`);
  if (!Array.isArray(card.clips) || card.clips.length < 1 || card.clips.length > CLIP_MAX) {
    return err(where, `clips 는 영상 1~${CLIP_MAX}개짜리 목록이어야 해요 (영상이 없으면 clips 항목 자체를 빼세요)`);
  }
  const seen = new Set(Array.isArray(card.media) && card.media[0] && typeof card.media[0].id === 'string' ? [card.media[0].id] : []);
  const key = textKey(card.keyword);
  card.clips.forEach((m, i) => {
    const w = `${where}.clips[${i}]`;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return err(w, '객체가 아니에요');
    if (m.type !== 'video') err(w, "type 은 'video' 만 쓸 수 있어요");
    const extra = Object.keys(m).filter((k) => !['type', 'provider', 'id', 'channel', 'title', 'views'].includes(k));
    if (extra.length) err(w, `쓸 수 없는 항목이 있어요: ${extra.join(', ')}`);
    if (m.provider !== 'youtube') err(w, "provider 는 'youtube' 여야 해요");
    if (typeof m.id !== 'string' || !YOUTUBE_ID.test(m.id)) err(w, 'id 는 유튜브 영상 주소의 11글자 번호여야 해요 (영문·숫자·-·_)');
    else if (seen.has(m.id)) err(w, `같은 영상이 한 카드에 두 번 들어 있어요: ${m.id}`);
    else seen.add(m.id);
    checkString(w, 'channel', m.channel, 1, VIDEO_CHANNEL_MAX);
    checkString(w, 'title', m.title, 1, VIDEO_TITLE_MAX);
    if (typeof m.channel === 'string') scanBlocked(w, 'channel', m.channel);
    if (typeof m.title === 'string') {
      scanBlocked(w, 'title', m.title);
      if (VIDEO_TITLE_BLOCKED.test(m.title)) err(w, `영상 제목에 반응 영상·모음·자극적인 영상의 단서가 있어요: ${m.title}`);
      if (CLIP_TITLE_BLOCKED.test(m.title)) err(w, `영상 제목에 아이(미성년자)가 주인공일 수 있는 단서가 있어서 쓰지 않아요: ${m.title}`);
      if (key && !textKey(m.title).includes(key)) err(w, `영상 제목에 카드 키워드 '${card.keyword}' 가 그대로 들어 있어야 해요(연관성): ${m.title}`);
    }
    if (!Number.isInteger(m.views) || m.views < CLIP_MIN_VIEWS || m.views > 100000000000) {
      err(w, `views 는 영상 페이지에서 읽은 조회수(${CLIP_MIN_VIEWS} 이상의 정수)여야 해요`);
    }
  });
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// 카드 날짜 기준으로 출처가 충분히 최근인지 봐요. 문제가 없으면 빈 목록, 있으면 이유 글자들을 돌려줘요.
function freshnessProblems(card) {
  if (!card || typeof card !== 'object' || !isRealDate(card.date) || !Array.isArray(card.sources)) return [];
  const items = card.sources
    .filter((s) => s && typeof s === 'object' && isRealDate(s.published))
    .map((s) => ({ name: String(s.name || '').trim(), published: s.published, age: daysBetween(s.published, card.date) }));
  if (!items.length) return [];
  const meme = card.group === 'meme';
  const newestMax = meme ? MEME_NEWEST_SOURCE_MAX_DAYS : NEWEST_SOURCE_MAX_DAYS;
  const freshDays = meme ? MEME_FRESH_SOURCE_DAYS : FRESH_SOURCE_DAYS;
  const out = [];
  const newest = items.reduce((a, b) => (b.age < a.age ? b : a));
  if (newest.age > newestMax) {
    out.push(`가장 최근 출처(${newest.published})가 카드 날짜보다 ${newest.age}일 전이에요 (${newestMax}일 안이어야 해요)`);
  }
  const stale = items.filter((x) => x.age > MAX_SOURCE_AGE_DAYS);
  if (stale.length) out.push(`${MAX_SOURCE_AGE_DAYS}일보다 오래된 출처가 있어요: ${stale.map((x) => `${x.name} ${x.published}`).join(', ')}`);
  const fresh = new Set(items.filter((x) => x.age <= freshDays).map((x) => x.name));
  if (fresh.size < MIN_FRESH_OUTLETS) {
    out.push(`카드 날짜 ${freshDays}일 안에 나온 기사가 서로 다른 매체 ${MIN_FRESH_OUTLETS}곳 이상 있어야 해요 (지금 ${fresh.size}곳)`);
  }
  return out;
}

// 오늘의 카드(와 add 후보): 출처가 오래됐으면 올리지 않아요.
function checkFreshness(card, where) {
  for (const p of freshnessProblems(card)) {
    err(where, `${p} — 오늘 뜨는 소식은 최근 기사에 기대야 해요. 며칠 전·지난달 기사로는 올리지 않아요`);
  }
}

function validateToday(today) {
  const where = 'today.json';
  if (today.schema !== 1) err(where, 'schema 는 1 이어야 해요');
  if (!isRealDate(today.date)) err(where, 'date 는 YYYY-MM-DD 형식의 실제 날짜여야 해요');
  if (typeof today.updatedAt !== 'string' || Number.isNaN(Date.parse(today.updatedAt))) {
    err(where, 'updatedAt 은 날짜·시간 글자여야 해요 (예: 2026-10-16T07:30:00+09:00)');
  }
  if (!Array.isArray(today.cards)) return err(where, 'cards 는 목록이어야 해요');
  if (today.cards.length < MIN_CARDS_PER_DAY || today.cards.length > MAX_CARDS_PER_DAY) {
    err(where, `하루 카드는 ${MIN_CARDS_PER_DAY}~${MAX_CARDS_PER_DAY}개여야 해요 (지금 ${today.cards.length}개)`);
  }
  const ids = new Set();
  const perGroup = {};
  today.cards.forEach((c, i) => {
    const cardWhere = `today.cards[${i}]${c && c.id ? ` (${c.id})` : ''}`;
    if (c && typeof c === 'object' && typeof c.group === 'string') perGroup[c.group] = (perGroup[c.group] || 0) + 1;
    validateCard(c, cardWhere);
    if (c && typeof c === 'object') checkFreshness(c, cardWhere);
    if (c && ids.has(c.id)) err(where, `id 가 중복돼요: ${c.id}`);
    if (c) ids.add(c.id);
    if (c && isRealDate(today.date) && c.date !== today.date) {
      err(where, `카드 ${c.id} 의 date(${c.date}) 가 today.date(${today.date}) 와 달라요`);
    }
  });
  // 분야별 분포: 한 분야로 쏠리지 않게 막아요 (분야 목록 자체가 잘못됐으면 위에서 이미 알려줘요)
  if (GROUPS.length) {
    const kinds = Object.keys(perGroup).filter((g) => GROUPS.includes(g)).length;
    const need = Math.min(MIN_GROUPS_PER_DAY, GROUPS.length);
    if (today.cards.length >= MIN_CARDS_PER_DAY && kinds < need) {
      err(where, `하루 카드는 서로 다른 분야 ${need}개 이상에 걸쳐야 해요 (지금 ${kinds}개 분야: ${Object.keys(perGroup).join(', ')})`);
    }
    for (const [g, n] of Object.entries(perGroup)) {
      if (n > MAX_PER_GROUP_PER_DAY) err(where, `한 분야(${g})의 카드는 하루 ${MAX_PER_GROUP_PER_DAY}개까지예요 (지금 ${n}개)`);
    }
  }
}

function validateTerms(terms, today) {
  const where = 'terms.json';
  if (terms.schema !== 1) err(where, 'schema 는 1 이어야 해요');
  if (!Array.isArray(terms.terms)) return err(where, 'terms 는 목록이어야 해요');
  const ids = new Set();
  const keywords = new Set();
  terms.terms.forEach((c, i) => {
    validateCard(c, `terms[${i}]${c && c.id ? ` (${c.id})` : ''}`);
    if (!c) return;
    if (ids.has(c.id)) err(where, `id 가 중복돼요: ${c.id}`);
    ids.add(c.id);
    const k = String(c.keyword).replace(/\s+/g, '');
    if (keywords.has(k)) err(where, `같은 키워드가 두 번 있어요: ${c.keyword}`);
    keywords.add(k);
  });
  if (today && Array.isArray(today.cards)) {
    for (const c of today.cards) {
      const t = terms.terms.find((x) => x.id === c.id);
      if (!t) err(where, `today 카드 ${c.id} 가 사전에 없어요 (node scripts/content.mjs merge 를 실행하세요)`);
      else if (JSON.stringify(t) !== JSON.stringify(c)) err(where, `today 카드 ${c.id} 와 사전 내용이 달라요 (merge 를 다시 실행하세요)`);
    }
  }
}

function shiftDate(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function validate() {
  const cats = loadCategories();
  const today = readJson(TODAY_PATH);
  const terms = readJson(TERMS_PATH);
  validateToday(today);
  validateTerms(terms, today);
  if (errors.length) {
    console.error(`❌ 콘텐츠 검사 실패 (${errors.length}건)`);
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }
  console.log(`✅ 콘텐츠 검사 통과: 분야 ${GROUPS.length}개, 오늘 ${today.cards.length}개, 사전 ${terms.terms.length}개`);

  // 통과해도 알려주는 참고 사항(실패는 아니에요): 최근 2주 동안 해설이 모자란 분야
  if (isRealDate(today.date)) {
    const from = shiftDate(today.date, -(RECENT_DAYS - 1));
    const count = {};
    const inWindow = terms.terms.filter((c) => c.date >= from && c.date <= today.date);
    const stale = inWindow.filter((c) => freshnessProblems(c).length);
    // 출처가 오래된 해설은 앱의 '최근 2주' 목록(recent.json)에서 빠지니까 개수에도 넣지 않아요
    for (const c of inWindow) if (!stale.includes(c)) count[c.group] = (count[c.group] || 0) + 1;
    if (stale.length) {
      console.log(`⚠️ 최근 ${RECENT_DAYS}일 안이지만 출처가 오래돼 앱 목록에서 빠지는 해설 ${stale.length}개 (사전에는 남아요):`);
      for (const c of stale) console.log(`   - ${c.id} (${c.date}): ${freshnessProblems(c)[0]}`);
    }
    const low = cats.groups.filter((g) => (count[g.id] || 0) < FEED_MIN_PER_GROUP);
    if (low.length) {
      console.log(`⚠️ 최근 ${RECENT_DAYS}일 해설이 ${FEED_MIN_PER_GROUP}개 미만인 분야: ${low.map((g) => `${g.label}(${g.id}) ${count[g.id] || 0}개`).join(', ')} — 오늘 카드에서 이 분야부터 채워 주세요`);
    } else {
      console.log(`✅ 모든 분야에 최근 ${RECENT_DAYS}일 해설이 ${FEED_MIN_PER_GROUP}개 이상 있어요`);
    }
  }
}

function merge() {
  const today = readJson(TODAY_PATH);
  const terms = existsSync(TERMS_PATH) ? readJson(TERMS_PATH) : { schema: 1, updatedAt: today.updatedAt, terms: [] };
  if (!Array.isArray(terms.terms)) terms.terms = [];
  for (const c of today.cards) {
    const i = terms.terms.findIndex((x) => x.id === c.id);
    if (i >= 0) terms.terms[i] = c;
    else terms.terms.push(c);
  }
  // 최근에 해설한 말이 위로 오게 정렬 (같은 날짜면 기존 순서 유지)
  terms.terms = terms.terms
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => (a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : a.idx - b.idx))
    .map((x) => x.c);
  terms.schema = 1;
  terms.updatedAt = today.updatedAt;
  writeJson(TERMS_PATH, terms);
  console.log(`✅ 사전에 합쳤어요: 총 ${terms.terms.length}개`);
}

// 앱 첫 화면의 분야별 목록에 쓰는 파일을 만들어요. 사전(terms.json)은 계속 커지니까, 최근 2주 해설을 분야마다 최신순 7개까지만 담아요.
// today.json 의 날짜를 기준으로 하고, 사전에서 파생되는 파일이라 저장소에는 올리지 않고 올릴 때마다 새로 만들어요.
function recent() {
  const today = readJson(TODAY_PATH);
  if (!isRealDate(today.date) || !Array.isArray(today.cards)) throw new Error('today.json 이 올바르지 않아요. 먼저 validate 를 실행하세요');
  const terms = existsSync(TERMS_PATH) ? readJson(TERMS_PATH) : { terms: [] };
  const byId = new Map();
  for (const c of [...(Array.isArray(terms.terms) ? terms.terms : []), ...today.cards]) byId.set(c.id, c);
  const from = shiftDate(today.date, -(RECENT_DAYS - 1));
  const inRange = [...byId.values()]
    .map((c, idx) => ({ c, idx }))
    .filter((x) => x.c.date >= from && x.c.date <= today.date)
    .sort((a, b) => (a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : a.idx - b.idx));
  // 며칠 전·지난달 기사에 기댄 해설은 '최근 2주' 목록에 올리지 않아요 (사전에는 그대로 있어요)
  const inWindow = inRange.filter((x) => freshnessProblems(x.c).length === 0);
  if (inWindow.length < inRange.length) {
    console.log(`ℹ️ 출처가 오래돼 최근 목록에서 뺀 해설 ${inRange.length - inWindow.length}개: ${inRange.filter((x) => !inWindow.includes(x)).map((x) => x.c.id).join(', ')}`);
  }
  const perGroup = {};
  const cards = inWindow
    .filter((x) => {
      perGroup[x.c.group] = (perGroup[x.c.group] || 0) + 1;
      return perGroup[x.c.group] <= FEED_MAX_PER_GROUP;
    })
    .map((x) => x.c);
  writeJson(RECENT_PATH, { schema: 1, updatedAt: today.updatedAt, days: RECENT_DAYS, perGroup: FEED_MAX_PER_GROUP, cards });
  console.log(`✅ 최근 ${RECENT_DAYS}일 해설 ${cards.length}개(분야마다 최대 ${FEED_MAX_PER_GROUP}개)를 recent.json 에 담았어요 (${from} ~ ${today.date})`);
}

// 새 카드 후보 파일(JSON 배열)을 규칙에 맞춰 검사해요. 사전·today 는 읽기만 하고, 통과한 카드 목록을 돌려줘요.
function checkFile(file) {
  if (!file) throw new Error('사용법: node scripts/content.mjs check <카드목록.json>');
  loadCategories();
  const today = readJson(TODAY_PATH);
  const terms = existsSync(TERMS_PATH) ? readJson(TERMS_PATH) : { terms: [] };
  const raw = readJson(resolve(file));
  const cards = Array.isArray(raw) ? raw : raw && Array.isArray(raw.cards) ? raw.cards : null;
  if (!cards) throw new Error('카드 목록(JSON 배열)이 아니에요');
  const known = Array.isArray(terms.terms) ? terms.terms : [];
  const ids = new Set(known.map((c) => c.id));
  const kws = new Set(known.map((c) => String(c.keyword).replace(/\s+/g, '')));
  const seenIds = new Set();
  const seenKws = new Set();
  const from = isRealDate(today.date) ? shiftDate(today.date, -(RECENT_DAYS - 1)) : null;
  cards.forEach((c, i) => {
    const w = `cards[${i}]${c && c.id ? ` (${c.id})` : ''}`;
    validateCard(c, w);
    if (!c || typeof c !== 'object') return;
    checkFreshness(c, w);
    if (isRealDate(c.date) && from) {
      if (c.date > today.date) err(w, `date(${c.date}) 가 오늘(${today.date}) 보다 미래예요`);
      else if (c.date < from) err(w, `date(${c.date}) 가 최근 ${RECENT_DAYS}일(${from} ~ ${today.date}) 밖이에요. 앱 목록에 나오지 않아요`);
    }
    if (ids.has(c.id) || seenIds.has(c.id)) err(w, `id 가 사전이나 이 파일 안에서 겹쳐요: ${c.id}`);
    seenIds.add(c.id);
    const k = String(c.keyword).replace(/\s+/g, '');
    if (kws.has(k) || seenKws.has(k)) err(w, `같은 키워드가 사전이나 이 파일 안에 이미 있어요: ${c.keyword}`);
    seenKws.add(k);
  });
  if (errors.length) {
    console.error(`❌ 카드 검사 실패 (${errors.length}건)`);
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }
  const byGroup = {};
  for (const c of cards) byGroup[c.group] = (byGroup[c.group] || 0) + 1;
  console.log(`✅ 카드 ${cards.length}개 통과 (${Object.entries(byGroup).map(([g, n]) => `${g} ${n}`).join(', ')})`);
  return { cards, terms };
}

// 지난 날짜의 카드를 사전에만 더해요 (앱의 분야별 목록은 사전에서 recent.json 을 만들어 써요).
function add(file) {
  const { cards, terms } = checkFile(file);
  const list = Array.isArray(terms.terms) ? terms.terms : [];
  const merged = [...list, ...cards]
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => (a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : a.idx - b.idx))
    .map((x) => x.c);
  terms.schema = 1;
  terms.terms = merged;
  writeJson(TERMS_PATH, terms);
  console.log(`✅ 사전에 ${cards.length}개를 더했어요: 총 ${merged.length}개`);
}

// ---------- 영상 확인 (인터넷이 되는 곳에서만 써요) ----------
// 카드에 붙인 영상이 지워졌거나 다른 곳에서 재생이 막혔는지, 적어 둔 채널이 실제로 올린 곳과 같은지 유튜브(oEmbed)에 물어봐요.
//  - 유튜브가 확실히 '없다 / 재생이 막혔다 / 채널이 다르다'고 알려준 영상만 문제로 봐요.
//    인터넷 문제 등으로 확인하지 못한 영상은 그대로 두어요.
//  - 확인용 영상(CANARY)조차 열리지 않으면 이 컴퓨터에서는 확인이 안 되는 상태라서, 아무것도 빼지 않고 건너뛰어요.
//  - --prune 이면 문제 영상을 '올릴 파일'(today·terms·recent)에서만 빼요. 저장소에 저장된 원본은 건드리지 않아요.
const OEMBED_URL = process.env.YT_OEMBED_URL || 'https://www.youtube.com/oembed';
const CANARY_ID = 'jNQXAC9IVRw'; // 유튜브의 첫 영상. 오래 남아 있는 확인용 영상이에요.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askOembed(id) {
  const url = `${OEMBED_URL}?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`;
  let last = { status: 0, inconclusive: true };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'whyttuji-media-check/1.0' } });
      if (res.status === 200) {
        const j = await res.json();
        return { status: 200, author: String(j.author_name || ''), title: String(j.title || '') };
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) return { status: res.status };
      last = { status: res.status, inconclusive: true };
    } catch (e) {
      last = { status: 0, inconclusive: true, error: e && e.message };
    }
    if (attempt === 0) await sleep(1500);
  }
  return last;
}

function textKey(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s) => {
    const m = new Map();
    const c = [...s];
    for (let i = 0; i < c.length - 1; i++) m.set(c[i] + c[i + 1], (m.get(c[i] + c[i + 1]) || 0) + 1);
    return m;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  let total = 0;
  for (const n of A.values()) total += n;
  for (const n of B.values()) total += n;
  for (const [k, n] of A) inter += Math.min(n, B.get(k) || 0);
  return total ? (2 * inter) / total : 0;
}
// GitHub Actions 의 줄 메모(annotation)에 넣을 글자 처리
const ghEsc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

async function verifyMedia() {
  const prune = argv.includes('--prune');
  const files = [
    { path: TODAY_PATH, list: (j) => j.cards },
    { path: TERMS_PATH, list: (j) => j.terms },
    { path: RECENT_PATH, list: (j) => j.cards }
  ]
    .filter((f) => existsSync(f.path))
    .map((f) => ({ ...f, json: readJson(f.path) }));

  // 카드의 영상은 두 곳이에요: media(뉴스·공식 채널 영상 1개), clips(밈 카드의 많이 본 관련 영상)
  const videosOf = (c) => [...(c && Array.isArray(c.media) ? c.media.slice(0, 1) : []), ...(c && Array.isArray(c.clips) ? c.clips : [])];
  const videos = new Map(); // id -> { id, channel, title, cards }
  for (const f of files) {
    for (const c of f.list(f.json) || []) {
      for (const m of videosOf(c)) {
        if (!m || typeof m.id !== 'string' || !YOUTUBE_ID.test(m.id)) continue;
        const v = videos.get(m.id) || { id: m.id, channel: m.channel, title: m.title, cards: new Set() };
        v.cards.add(c.id);
        videos.set(m.id, v);
      }
    }
  }
  if (!videos.size) return console.log('ℹ️ 확인할 영상이 없어요');

  const canary = await askOembed(CANARY_ID);
  if (canary.status !== 200) {
    console.log(`::warning title=영상 확인을 건너뛰었어요::확인용 영상이 열리지 않아서(응답 ${canary.status}) 영상 ${videos.size}개를 확인하지 못했고, 아무것도 빼지 않았어요`);
    return;
  }

  const queue = [...videos.values()];
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const v = queue.shift();
      results.push({ v, r: await askOembed(v.id) });
      await sleep(150);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  results.sort((a, b) => [...a.v.cards][0].localeCompare([...b.v.cards][0]));

  const bad = new Set();
  const notes = [];
  const problems = [];
  let ok = 0;
  let unknown = 0;
  for (const { v, r } of results) {
    const cards = [...v.cards].join(',');
    if (r.status === 200) {
      const sameChannel = v.channel === undefined || normName(r.author) === normName(v.channel);
      if (!sameChannel) {
        bad.add(v.id);
        problems.push(`${v.id} (${cards}): 적어 둔 채널 '${v.channel}' 과 실제 채널 '${r.author}' 이 달라요 → 뺐어요`);
      } else {
        ok++;
        const similar = v.title === undefined || dice(textKey(r.title), textKey(v.title)) >= 0.5 || textKey(r.title).includes(textKey(v.title)) || textKey(v.title).includes(textKey(r.title));
        notes.push(`${v.id} | ${r.author} | ${r.title}${similar ? '' : '   (적어 둔 제목과 달라요: ' + v.title + ')'} | ${cards}`);
      }
    } else if (r.inconclusive) {
      unknown++;
      notes.push(`${v.id} | 확인 못 함 (응답 ${r.status}${r.error ? ', ' + r.error : ''}) | ${cards}`);
    } else {
      bad.add(v.id);
      const why = r.status === 401 ? '다른 곳에서 재생이 막혀 있어요' : '영상이 없거나 비공개예요';
      problems.push(`${v.id} (${cards}): ${why} (응답 ${r.status}) → 뺐어요`);
    }
  }

  for (const line of notes) console.log('  ' + line);
  for (const line of problems) console.log('  ❌ ' + line);
  // 줄 메모는 종류마다 10개까지만 보여서, 여러 줄을 묶어서 남겨요
  for (let i = 0; i < notes.length; i += 8) console.log(`::notice title=영상 확인 결과 (${i + 1}~${Math.min(i + 8, notes.length)})::${ghEsc(notes.slice(i, i + 8).join('\n'))}`);
  if (problems.length) console.log(`::warning title=재생이 안 되는 영상 ${problems.length}개::${ghEsc(problems.join('\n'))}`);
  console.log(`✅ 영상 ${videos.size}개 확인: 정상 ${ok}개, 문제 ${bad.size}개, 확인 못 함 ${unknown}개`);

  if (prune && bad.size) {
    let cut = 0;
    for (const f of files) {
      let changed = false;
      for (const c of f.list(f.json) || []) {
        const m = c && Array.isArray(c.media) ? c.media[0] : null;
        if (m && bad.has(m.id)) {
          delete c.media;
          changed = true;
          cut++;
        }
        if (c && Array.isArray(c.clips)) {
          const keep = c.clips.filter((x) => !(x && bad.has(x.id)));
          if (keep.length !== c.clips.length) {
            cut += c.clips.length - keep.length;
            if (keep.length) c.clips = keep;
            else delete c.clips;
            changed = true;
          }
        }
      }
      if (changed) writeJson(f.path, f.json);
    }
    console.log(`✂️ 올릴 파일에서 문제 영상 ${cut}곳을 뺐어요 (저장소 원본은 그대로예요)`);
  }
}

try {
  if (command === 'validate') validate();
  else if (command === 'merge') merge();
  else if (command === 'recent') recent();
  else if (command === 'check') checkFile(argv[1]);
  else if (command === 'add') add(argv[1]);
  else if (command === 'verify-media') await verifyMedia();
  else {
    console.error('사용법: node scripts/content.mjs <validate|merge|recent|check|add|verify-media> [카드목록.json] [--site site]');
    process.exit(2);
  }
} catch (e) {
  console.error('❌ ' + e.message);
  process.exit(1);
}
