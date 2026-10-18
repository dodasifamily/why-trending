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
//   node scripts/content.mjs find-videos [--write] [--cache <파일>]   영상이 없는 카드에 이번 소식 영상을 유튜브 검색(키: 환경변수 YOUTUBE_API_KEY)으로 찾아 붙여요
//                                                     (GitHub Actions 에서 써요. --write 가 있어야 올릴 파일을 바꿔요. 키가 없으면 건너뛰어요)
//
// 옵션: --site <폴더>   기본값은 site
//
// 규칙의 목적: 출처 없는 내용, 민감한 주제, 너무 긴 글, 올린 곳이 불분명한 영상, 며칠 전·지난달 기사에 기댄 '오늘 소식'이 앱에 올라가지 않게 막는 안전장치예요.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const argv = process.argv.slice(2);
const command = argv[0];
const argValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const siteDir = resolve(argValue('--site') || 'site');
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

// 올릴 카드 파일 세 개(오늘·사전·최근 목록)를 읽어요. 있는 것만요.
function siteFiles() {
  return [
    { path: TODAY_PATH, list: (j) => j.cards },
    { path: TERMS_PATH, list: (j) => j.terms },
    { path: RECENT_PATH, list: (j) => j.cards }
  ]
    .filter((f) => existsSync(f.path))
    .map((f) => ({ ...f, json: readJson(f.path) }));
}

async function verifyMedia() {
  const prune = argv.includes('--prune');
  const files = siteFiles();

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

// ---------- 영상 자동 찾기 (유튜브 검색 키가 있을 때만) ----------
// 사이트를 올릴 때 영상이 없는 카드에 '이번 소식'을 다룬 영상을 유튜브 검색(YouTube Data API v3)으로 찾아 붙여요. (2026-10-18 사용자 요청)
//  - 뉴스·행사 카드: 방송·언론사 채널(NEWS_CHANNELS)이 카드 날짜 앞 7일~뒤 3일 안에 올린 영상 중 제목에 키워드가 든 것 1개를 media 로 붙여요.
//    유튜브 검색에는 같은 행사·경매의 지난해 영상도 섞여 나와서, 날짜 범위·제목의 연도·키워드를 모두 따져요.
//  - 밈·신조어 카드: 조회수 CLIP_MIN_VIEWS 이상이고 제목에 키워드가 그대로 든 영상을 조회수 순으로 CLIP_MAX 개까지 clips 로 붙여요.
//  - 공통: 공개·재생 허용·생중계 아님·연령 제한 없음·아이용 표시 없음·한국에서 재생 가능·길이 제한·금지어 없음.
//    붙이기 전에 validateMedia·validateClips 로 한 번 더 검사해요.
//  - 구글이 2026년 6월부터 검색(search.list)을 하루 100번까지만 무료로 줘서, 영상이 없는 카드만 찾고 한 번에 FIND_MAX_SEARCHES 번까지만 써요.
//    결과(못 찾은 것도)는 --cache 파일에 적어 두고 GitHub Actions 캐시로 이어 써서, 같은 카드를 FIND_RETRY_HOURS 시간 안에는 다시 검색하지 않아요.
//  - --write 가 있을 때만 올릴 파일(today·terms·recent)에 붙여요. 저장소 원본에는 커밋하지 않아요.
//    유튜브 API 이용약관(받아 둔 정보는 30일 안에 새로 받거나 지우기)에 맞게 기록은 FIND_KEEP_DAYS 일만 써요.
//  - 키(YOUTUBE_API_KEY)가 없거나 오류가 나면 건너뛰어요(사이트는 그대로 올라가요). 키는 로그에 찍지 않아요.
const YT_API_URL = (process.env.YT_API_URL || 'https://www.googleapis.com/youtube/v3').replace(/\/+$/, '');
const FIND_MAX_SEARCHES = Number(process.env.FIND_VIDEOS_MAX_SEARCHES) > 0 ? Number(process.env.FIND_VIDEOS_MAX_SEARCHES) : 12;
const FIND_RETRY_HOURS = 6; // 못 찾은 카드는 이만큼 지나야 다시 검색해요
const FIND_KEEP_DAYS = 14; // 찾은 영상 기록을 쓰는 기간
const FIND_NEWS_DAYS_BEFORE = 7; // 뉴스 영상은 카드 날짜보다 이만큼 앞서 올라온 것부터
const FIND_NEWS_DAYS_AFTER = 3; // 카드 날짜 뒤로 이만큼(당일 포함해 +1일)까지
const FIND_MIN_SECONDS = 10;
const FIND_NEWS_MAX_SECONDS = 15 * 60;
const FIND_CLIP_MAX_SECONDS = 20 * 60;
const FIND_CLIP_MIN_KEYWORD = 3; // 밈 키워드가 이보다 짧으면(예: '야르') 다른 뜻의 영상이 섞일 수 있어서 자동으로 붙이지 않아요
const VIDEO_BLOCK_IDS = []; // 문제가 알려진 영상 번호: 자동으로 붙이지 않아요 (이상한 영상이 보이면 여기에 번호를 추가해요)
const VIDEO_BLOCK_CHANNELS = []; // 자동으로 붙이지 않을 채널 이름
const DAY_MS = 86400000;

const needsVideo = (c) => !!c && !(Array.isArray(c.media) && c.media.length) && !(Array.isArray(c.clips) && c.clips.length);
const codePoint = (n) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

// 유튜브 검색 결과의 제목에는 &#39; 같은 HTML 문자가 섞여 있어요
function htmlDecode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// 유튜브의 길이 표기(PT1H2M3S)를 초로 바꿔요. 읽을 수 없으면 null
function isoSeconds(d) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(d || ''));
  if (!m) return null;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
}

// 유튜브 API 한 번 부르기. 주소(키가 들어 있어요)는 로그에 남기지 않고, 상태와 이유만 돌려줘요.
async function ytGet(endpoint, params, key) {
  const url = new URL(`${YT_API_URL}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set('key', key);
  let last = { status: 0, reason: 'network' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'whyttuji-find-videos/1.0' } });
      let body = null;
      try {
        body = await res.json();
      } catch {
        /* 본문이 JSON 이 아니면 비워 둬요 */
      }
      if (res.ok) return { status: res.status, body };
      const e = body && body.error;
      const reason =
        (e && Array.isArray(e.errors) && e.errors[0] && e.errors[0].reason) ||
        (e && Array.isArray(e.details) && e.details[0] && e.details[0].reason) ||
        (e && e.status) ||
        '';
      last = { status: res.status, reason: String(reason) };
      if (res.status < 500) return last;
    } catch (e) {
      last = { status: 0, reason: 'network', detail: String((e && e.cause && e.cause.code) || (e && e.name) || '') };
    }
    if (attempt === 0) await sleep(1500);
  }
  return last;
}

function ytProblemText(r) {
  const reason = r.reason || '';
  const why = `응답 ${r.status}${reason ? ', ' + reason : ''}${r.detail ? ', ' + r.detail : ''}`;
  if (/quota|rateLimit|dailyLimit/i.test(reason)) return `오늘 유튜브 검색 한도(하루 100번)를 다 썼어요 (${why}). 내일 다시 찾아요`;
  if (/keyInvalid|API_KEY_INVALID|keyExpired/i.test(reason)) return `유튜브가 키를 받아들이지 않았어요 (${why}). 키를 다시 복사해 YOUTUBE_API_KEY 로 넣었는지 확인해 주세요`;
  if (/referer|referrer|IP_ADDRESS_BLOCKED|APP_BLOCKED/i.test(reason)) return `이 키는 '애플리케이션 제한사항'이 걸려 있어서 사이트 올리기 서버에서는 못 써요 (${why}). 구글 클라우드의 이 키 설정에서 '애플리케이션 제한사항'을 '없음'으로 바꿔 주세요 (대신 'API 제한사항'은 'YouTube Data API v3' 하나만 두세요)`;
  if (r.status === 401 || r.status === 403) return `유튜브가 요청을 거절했어요 (${why}). 'YouTube Data API v3' 가 사용 상태인지, 키의 API 제한사항에 'YouTube Data API v3' 가 들어 있는지 확인해 주세요`;
  if (r.status === 0 || r.status >= 500) return `유튜브에 연결하지 못했어요 (${why}). 다음에 다시 찾아요`;
  return `유튜브가 요청을 받아들이지 않았어요 (${why})`;
}

// 영상 제목이 카드 키워드와 얼마나 맞는지(0~1). 0 이면 쓰지 않아요.
//  - 밈·신조어(clips): 키워드가 제목에 그대로 들어 있어야 해요 (validateClips 와 같은 규칙).
//  - 뉴스·행사(news): 키워드를 띄어쓰기로 나눈 말 가운데 가장 긴 말(사람·행사·제품 이름)은 꼭 들어 있고, 전체의 2/3 이상이 들어 있어야 해요.
function keywordFit(card, title, mode) {
  const full = textKey(card.keyword);
  const tk = textKey(title);
  if (!full) return 0;
  if (mode === 'clips') return tk.includes(full) ? 1 : 0;
  const tokens = String(card.keyword).split(/\s+/).map(textKey).filter((t) => t.length >= 2);
  if (!tokens.length) return tk.includes(full) ? 1 : 0;
  const longest = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  if (!tk.includes(longest)) return 0;
  const hit = tokens.filter((t) => tk.includes(t)).length;
  const need = tokens.length <= 2 ? tokens.length : Math.ceil((tokens.length * 2) / 3);
  return hit >= need ? hit / tokens.length : 0;
}

// videos.list 가 돌려준 영상 하나가 이 카드에 붙여도 되는지 따져요. 되면 { v }, 안 되면 { why }
function evaluateVideo(it, card, mode) {
  const sn = (it && it.snippet) || {};
  const cd = (it && it.contentDetails) || {};
  const st = (it && it.status) || {};
  const id = it && typeof it.id === 'string' ? it.id : '';
  if (!YOUTUBE_ID.test(id)) return { why: '번호 형식' };
  if (VIDEO_BLOCK_IDS.includes(id)) return { why: '막아 둔 영상' };
  const channel = htmlDecode(sn.channelTitle).trim();
  const title = htmlDecode(sn.title).trim();
  if (!channel || !title) return { why: '제목·채널 없음' };
  if (channel.length > VIDEO_CHANNEL_MAX) return { why: '채널 이름이 너무 길어요' };
  if (VIDEO_BLOCK_CHANNELS.some((x) => normName(x) === normName(channel))) return { why: '막아 둔 채널' };
  if (mode === 'news' && !NEWS_CHANNEL_KEYS.has(normName(channel))) return { why: '허용 채널 아님' };
  if (sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none') return { why: '생중계' };
  if (st.privacyStatus !== 'public' || st.embeddable !== true) return { why: '재생 허용 안 됨' };
  if (st.madeForKids === true) return { why: '아이용 영상' };
  if (cd.contentRating && cd.contentRating.ytRating === 'ytAgeRestricted') return { why: '연령 제한' };
  const rr = cd.regionRestriction;
  if (rr && ((Array.isArray(rr.blocked) && rr.blocked.includes('KR')) || (Array.isArray(rr.allowed) && !rr.allowed.includes('KR')))) return { why: '한국에서 막힘' };
  const seconds = isoSeconds(cd.duration);
  if (seconds === null || seconds < FIND_MIN_SECONDS || seconds > (mode === 'news' ? FIND_NEWS_MAX_SECONDS : FIND_CLIP_MAX_SECONDS)) return { why: '길이' };
  const published = Date.parse(sn.publishedAt);
  if (!Number.isFinite(published)) return { why: '올린 날 없음' };
  if (BLOCKED_WORDS.some((w) => title.includes(w) || channel.includes(w))) return { why: '금지어' };
  if (VIDEO_TITLE_BLOCKED.test(title) || VIDEO_TITLE_BLOCKED.test(channel)) return { why: '반응·모음·자극적인 제목' };
  const fit = keywordFit(card, title, mode);
  if (!fit) return { why: '제목에 키워드 없음' };
  const views = Number(it.statistics && it.statistics.viewCount);
  if (mode === 'news') {
    const start = Date.parse(`${card.date}T00:00:00+09:00`);
    if (published < start - FIND_NEWS_DAYS_BEFORE * DAY_MS || published > start + (FIND_NEWS_DAYS_AFTER + 1) * DAY_MS) return { why: '날짜 범위 밖' };
    const cardYear = Number(card.date.slice(0, 4));
    if ([...title.matchAll(/(?<![0-9])(20\d{2})(?![0-9])/g)].some((m) => Number(m[1]) < cardYear)) return { why: '지난 연도 제목' };
  } else {
    if (!(views >= CLIP_MIN_VIEWS)) return { why: '조회수 모자람' };
    const around = [title, channel, ...(Array.isArray(sn.tags) ? sn.tags : []), String(sn.description || '').slice(0, 400)].join(' ');
    if (CLIP_TITLE_BLOCKED.test(around)) return { why: '아이(미성년자) 단서' };
  }
  return { v: { id, channel, title: title.slice(0, VIDEO_TITLE_MAX), published, views: Number.isFinite(views) ? Math.floor(views) : 0, fit } };
}

// 통과한 영상 가운데 카드에 붙일 것을 골라요. 뉴스는 1개(media), 밈은 조회수 순 CLIP_MAX 개(clips, 채널이 겹치지 않게 먼저)
function chooseVideos(passed, mode) {
  if (!passed.length) return null;
  if (mode === 'news') {
    const best = [...passed].sort((a, b) => b.fit - a.fit || b.views - a.views || b.published - a.published)[0];
    return { media: { type: 'video', provider: 'youtube', id: best.id, kind: 'news', channel: best.channel, title: best.title }, info: [best] };
  }
  const sorted = [...passed].sort((a, b) => b.views - a.views);
  const out = [];
  for (const v of sorted) if (out.length < CLIP_MAX && !out.some((x) => normName(x.channel) === normName(v.channel))) out.push(v);
  for (const v of sorted) if (out.length < CLIP_MAX && !out.includes(v)) out.push(v);
  return { clips: out.map((v) => ({ type: 'video', provider: 'youtube', id: v.id, channel: v.channel, title: v.title, views: v.views })), info: out };
}

// 고른 영상이 카드 검사 규칙(validateMedia·validateClips)을 통과하는지 확인해요. 걸린 이유 목록을 돌려줘요.
function pickProblems(card, pick) {
  const probe = { ...card };
  delete probe.media;
  delete probe.clips;
  if (pick.media) probe.media = [pick.media];
  if (pick.clips) probe.clips = pick.clips;
  const before = errors.length;
  validateMedia(probe, 'pick');
  validateClips(probe, 'pick');
  return errors.splice(before);
}

// 카드 하나에 대해 검색(search.list 1번) + 세부 정보(videos.list 1번)로 영상을 찾아요.
async function searchPick(card, mode, key, stat) {
  const meme = mode === 'clips';
  const start = Date.parse(`${card.date}T00:00:00+09:00`);
  const params = {
    part: 'snippet',
    type: 'video',
    q: card.keyword,
    maxResults: 50,
    regionCode: 'KR',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    safeSearch: 'strict',
    order: meme ? 'viewCount' : 'relevance'
  };
  if (/[가-힣]/.test(card.keyword)) params.relevanceLanguage = 'ko';
  if (!meme && Number.isFinite(start)) params.publishedAfter = new Date(start - FIND_NEWS_DAYS_BEFORE * DAY_MS).toISOString();
  stat.searched++;
  const s = await ytGet('search', params, key);
  if (s.status !== 200) return { problem: s };
  const items = s.body && Array.isArray(s.body.items) ? s.body.items : [];
  const ids = [...new Set(items.map((x) => x && x.id && x.id.videoId).filter((v) => typeof v === 'string' && YOUTUBE_ID.test(v)))].slice(0, 50);
  if (!ids.length) return { pick: null, why: '검색 결과가 없어요' };
  await sleep(200);
  const d = await ytGet('videos', { part: 'snippet,contentDetails,status,statistics', id: ids.join(',') }, key);
  if (d.status !== 200) return { problem: d };
  const details = d.body && Array.isArray(d.body.items) ? d.body.items : [];
  const passed = [];
  const why = {};
  for (const it of details) {
    const r = evaluateVideo(it, card, mode);
    if (r.v) passed.push(r.v);
    else why[r.why] = (why[r.why] || 0) + 1;
  }
  const chosen = chooseVideos(passed, mode);
  if (!chosen) {
    const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ');
    return { pick: null, why: `후보 ${details.length}개가 모두 안 맞았어요 (${top || '이유 없음'})` };
  }
  const problems = pickProblems(card, chosen);
  if (problems.length) return { pick: null, why: `카드 검사에 걸렸어요: ${problems[0]}` };
  return { pick: { pick: chosen.media ? { media: chosen.media } : { clips: chosen.clips }, info: chosen.info } };
}

function applyPicks(files, picks) {
  let count = 0;
  for (const f of files) {
    let changed = false;
    for (const c of f.list(f.json) || []) {
      const p = c && picks.get(c.id);
      if (!p || !needsVideo(c)) continue;
      if (p.media) c.media = [p.media];
      else if (p.clips) c.clips = p.clips;
      else continue;
      changed = true;
      count++;
    }
    if (changed) writeJson(f.path, f.json);
  }
  return count;
}

async function findVideos() {
  const write = argv.includes('--write');
  const key = String(process.env.YOUTUBE_API_KEY || '').trim();
  if (!key) {
    console.log('::notice title=영상 자동 찾기를 건너뛰었어요::YOUTUBE_API_KEY 가 없어요. 저장소 Settings → Secrets and variables → Actions 에 유튜브 검색 키를 YOUTUBE_API_KEY 라는 이름으로 넣으면 켜져요');
    return;
  }
  const files = siteFiles();
  const source = files.find((f) => f.path === RECENT_PATH) || files.find((f) => f.path === TODAY_PATH);
  if (!source) return console.log('ℹ️ 카드 목록 파일이 없어서 영상 자동 찾기를 건너뛰었어요');
  const cards = (source.list(source.json) || []).filter((c) => c && typeof c.id === 'string' && typeof c.keyword === 'string' && isRealDate(c.date) && needsVideo(c));

  const cachePath = resolve(argValue('--cache') || '.cache/video-picks.json');
  let cache = { v: 1, cards: {} };
  try {
    const j = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (j && j.v === 1 && j.cards && typeof j.cards === 'object' && !Array.isArray(j.cards)) cache = j;
  } catch {
    /* 처음이거나 읽을 수 없으면 새로 시작해요 */
  }
  const parsedNow = process.env.FV_NOW ? Date.parse(process.env.FV_NOW) : NaN;
  const now = Number.isFinite(parsedNow) ? parsedNow : Date.now();
  const nowIso = new Date(now).toISOString();

  const picks = new Map(); // 카드 id -> { media | clips, info, cached }
  const stat = { cached: 0, searched: 0, found: 0, none: 0, waiting: 0, postponed: 0 };
  let stopped = '';
  const deadline = Date.now() + 4 * 60 * 1000; // 인터넷이 느려도 이 단계가 오래 붙잡지 않게
  for (const card of cards) {
    const sig = `${card.keyword}|${card.date}`;
    const hit = cache.cards[card.id];
    if (hit && hit.sig === sig) {
      const stamp = Date.parse(hit.fetchedAt || hit.searchedAt);
      if (hit.pick && Number.isFinite(stamp) && (now - stamp) / DAY_MS <= FIND_KEEP_DAYS && !pickProblems(card, hit.pick).length) {
        picks.set(card.id, { ...hit.pick, info: Array.isArray(hit.info) ? hit.info : [], cached: true });
        stat.cached++;
        continue;
      }
      if (!hit.pick && (now - Date.parse(hit.searchedAt)) / 3600000 < FIND_RETRY_HOURS) {
        stat.waiting++;
        continue;
      }
    }
    if (stopped || stat.searched >= FIND_MAX_SEARCHES || Date.now() > deadline) {
      stat.postponed++;
      continue;
    }
    const mode = CLIP_GROUPS.includes(card.group) ? 'clips' : 'news';
    if (mode === 'clips' && textKey(card.keyword).length < FIND_CLIP_MIN_KEYWORD) {
      cache.cards[card.id] = { sig, searchedAt: nowIso, pick: null };
      stat.none++;
      console.log(`  ${card.id} (${card.keyword}): 키워드가 짧아서(${FIND_CLIP_MIN_KEYWORD}글자 미만) 자동으로 찾지 않아요`);
      continue;
    }
    const r = await searchPick(card, mode, key, stat);
    if (r.problem) {
      stopped = ytProblemText(r.problem);
      console.log(`::warning title=영상 자동 찾기를 멈췄어요::${ghEsc(stopped)}`);
      stat.postponed++;
      continue;
    }
    if (r.pick) {
      cache.cards[card.id] = { sig, searchedAt: nowIso, fetchedAt: nowIso, pick: r.pick.pick, info: r.pick.info };
      picks.set(card.id, { ...r.pick.pick, info: r.pick.info });
      stat.found++;
    } else {
      cache.cards[card.id] = { sig, searchedAt: nowIso, pick: null };
      stat.none++;
      console.log(`  ${card.id} (${card.keyword}): 맞는 영상을 못 찾았어요 — ${r.why}`);
    }
    await sleep(200);
  }

  // 지금 영상이 필요 없는 카드·오래된 기록은 정리해요
  const want = new Set(cards.map((c) => c.id));
  for (const id of Object.keys(cache.cards)) {
    const e = cache.cards[id];
    if (!want.has(id) || !e || (now - Date.parse(e.searchedAt)) / DAY_MS > FIND_KEEP_DAYS + 7) delete cache.cards[id];
  }

  const lines = [];
  for (const [id, p] of picks) {
    for (const v of p.info || []) {
      lines.push(`${id} | ${p.media ? '뉴스 영상' : '많이 본 영상'} | ${v.channel} | ${v.title} | ${v.id} | ${new Date(v.published).toISOString().slice(0, 10)}${p.clips ? ' | 조회수 ' + v.views : ''}${p.cached ? ' | (기록)' : ''}`);
    }
  }
  for (const l of lines) console.log('  ' + l);
  for (let i = 0; i < lines.length; i += 8) console.log(`::notice title=영상 자동 찾기 결과 (${i + 1}~${Math.min(i + 8, lines.length)})::${ghEsc(lines.slice(i, i + 8).join('\n'))}`);

  let applied = 0;
  if (write) {
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n', 'utf8');
    applied = applyPicks(files, picks);
  }
  console.log(
    `✅ 영상 자동 찾기: 영상 없는 카드 ${cards.length}개 → 붙임 ${picks.size}개 (기록에서 ${stat.cached}개, 새로 찾음 ${stat.found}개), 못 찾음 ${stat.none}개, 기다리는 중 ${stat.waiting}개, 다음으로 미룸 ${stat.postponed}개 · 이번 검색 ${stat.searched}번 (하루 무료 한도 100번)` +
      (write ? ` · 올릴 파일에 ${applied}곳 붙였어요 (저장소 원본은 그대로예요)` : ' · --write 가 없어서 파일은 바꾸지 않았어요')
  );
}

try {
  if (command === 'validate') validate();
  else if (command === 'merge') merge();
  else if (command === 'recent') recent();
  else if (command === 'check') checkFile(argv[1]);
  else if (command === 'add') add(argv[1]);
  else if (command === 'verify-media') await verifyMedia();
  else if (command === 'find-videos') await findVideos();
  else {
    console.error('사용법: node scripts/content.mjs <validate|merge|recent|check|add|verify-media|find-videos> [카드목록.json] [--site site]');
    process.exit(2);
  }
} catch (e) {
  console.error('❌ ' + e.message);
  process.exit(1);
}
