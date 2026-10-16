#!/usr/bin/env node
// 왜뜨지 콘텐츠 도구 (외부 패키지 없이 Node만으로 동작해요)
//
//   node scripts/content.mjs validate   categories.json / today.json / terms.json 규칙 검사 (어기면 종료 코드 1)
//   node scripts/content.mjs merge      today.json 의 카드를 terms.json(사전)에 합치기
//   node scripts/content.mjs recent     최근 2주 해설을 분야마다 7개까지 모은 recent.json 만들기 (사이트·앱을 올릴 때 자동으로 만들어져요. 저장소에는 올리지 않아요)
//   node scripts/content.mjs check <카드목록.json>   새 카드 후보 파일이 규칙에 맞는지만 검사 (사전·today 는 건드리지 않아요)
//   node scripts/content.mjs add <카드목록.json>     검사를 통과한 지난 카드를 사전(terms.json)에만 추가 (오늘 카드는 today.json + merge 로 올려요)
//
// 옵션: --site <폴더>   기본값은 site
//
// 규칙의 목적: 출처 없는 내용, 민감한 주제, 너무 긴 글, 출처가 불분명한 영상이 앱에 올라가지 않게 막는 안전장치예요.

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
// '오늘 뜨는 말'인데 몇 달 전 기사만 있으면 지금 뜨는 게 아닐 수 있어요.
// 카드 날짜 기준, 가장 최근 출처가 이 일수 안에 있어야 오늘의 카드로 올릴 수 있어요. (사전 항목에는 적용하지 않아요)
const MAX_SOURCE_AGE_DAYS = 45;

// 해설 화면에 붙이는 영상 규칙.
// 저작권 때문에 기사 사진은 가져다 쓰지 않아요. 대신 '출처로 단 기사 페이지에 매체가 직접 실어 둔 유튜브 영상'만
// 미리보기(썸네일)와 재생 링크로 보여줘요. 그래서 영상에는 반드시 그 기사 주소(from)가 따라붙고,
// 그 기사는 카드의 출처 목록에도 들어 있어야 해요. (기사 페이지에 영상이 정말 있는지는 갱신 담당이 직접 열어 확인해요)
// 목록에 없는 매체의 기사에서는 영상을 가져오지 않아요. 새 매체를 허용하려면 여기에 추가해요.
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
  });
  const labels = cats.groups.map((g) => g && g.label);
  if (new Set(labels).size !== labels.length) err(where, '분야 이름(label)이 겹쳐요');
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
// 형식: "media": [{ "type": "video", "provider": "youtube", "id": "11글자", "from": "출처로 단 기사 주소" }]
function validateMedia(card, where) {
  if (card.media === undefined) return;
  if (!Array.isArray(card.media) || card.media.length !== 1) {
    return err(where, 'media 는 영상 1개짜리 목록이어야 해요 (영상이 없으면 media 항목 자체를 빼세요)');
  }
  card.media.forEach((m, i) => {
    const w = `${where}.media[${i}]`;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return err(w, '객체가 아니에요');
    if (m.type !== 'video') return err(w, "type 은 'video' 만 쓸 수 있어요");
    const extra = Object.keys(m).filter((k) => !['type', 'provider', 'id', 'from'].includes(k));
    if (extra.length) err(w, `쓸 수 없는 항목이 있어요: ${extra.join(', ')}`);
    if (m.provider !== 'youtube') err(w, "provider 는 'youtube' 여야 해요");
    if (typeof m.id !== 'string' || !YOUTUBE_ID.test(m.id)) err(w, 'id 는 유튜브 영상 주소의 11글자 번호여야 해요 (영문·숫자·-·_)');
    const from = Array.isArray(card.sources) ? card.sources.find((s) => s && s.url === m.from) : undefined;
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
  });
}

function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// 오늘의 카드: 가장 최근 출처가 너무 오래됐으면 올리지 않아요.
function checkFreshness(card, where) {
  if (!isRealDate(card.date) || !Array.isArray(card.sources)) return;
  const dates = card.sources.map((s) => s && s.published).filter(isRealDate);
  if (!dates.length) return;
  const newest = dates.sort().at(-1);
  const age = daysBetween(newest, card.date);
  if (age > MAX_SOURCE_AGE_DAYS) {
    err(where, `가장 최근 출처(${newest})가 카드 날짜보다 ${age}일 전이에요. 오늘의 카드는 ${MAX_SOURCE_AGE_DAYS}일 안의 출처가 있어야 해요 (사전에만 넣을 수는 있어요)`);
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
    for (const c of terms.terms) if (c.date >= from && c.date <= today.date) count[c.group] = (count[c.group] || 0) + 1;
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
  const inWindow = [...byId.values()]
    .map((c, idx) => ({ c, idx }))
    .filter((x) => x.c.date >= from && x.c.date <= today.date)
    .sort((a, b) => (a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : a.idx - b.idx));
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

try {
  if (command === 'validate') validate();
  else if (command === 'merge') merge();
  else if (command === 'recent') recent();
  else if (command === 'check') checkFile(argv[1]);
  else if (command === 'add') add(argv[1]);
  else {
    console.error('사용법: node scripts/content.mjs <validate|merge|recent|check|add> [카드목록.json] [--site site]');
    process.exit(2);
  }
} catch (e) {
  console.error('❌ ' + e.message);
  process.exit(1);
}
