#!/usr/bin/env node
// 왜뜨지 콘텐츠 도구 (외부 패키지 없이 Node만으로 동작해요)
//
//   node scripts/content.mjs validate   today.json / terms.json 규칙 검사 (어기면 종료 코드 1)
//   node scripts/content.mjs merge      today.json 의 카드를 terms.json(사전)에 합치기
//
// 옵션: --site <폴더>   기본값은 site
//
// 규칙의 목적: 출처 없는 내용, 민감한 주제, 너무 긴 글이 앱에 올라가지 않게 막는 안전장치예요.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const command = argv[0];
const siteIdx = argv.indexOf('--site');
const siteDir = resolve(siteIdx >= 0 ? argv[siteIdx + 1] : 'site');
const TODAY_PATH = join(siteDir, 'data', 'today.json');
const TERMS_PATH = join(siteDir, 'data', 'terms.json');

const GROUPS = ['meme', 'culture', 'sports', 'biz'];
const MIN_CARDS_PER_DAY = 3;
const MAX_CARDS_PER_DAY = 8;

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
  today.cards.forEach((c, i) => {
    validateCard(c, `today.cards[${i}]${c && c.id ? ` (${c.id})` : ''}`);
    if (c && ids.has(c.id)) err(where, `id 가 중복돼요: ${c.id}`);
    if (c) ids.add(c.id);
    if (c && isRealDate(today.date) && c.date !== today.date) {
      err(where, `카드 ${c.id} 의 date(${c.date}) 가 today.date(${today.date}) 와 달라요`);
    }
  });
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

function validate() {
  const today = readJson(TODAY_PATH);
  const terms = readJson(TERMS_PATH);
  validateToday(today);
  validateTerms(terms, today);
  if (errors.length) {
    console.error(`❌ 콘텐츠 검사 실패 (${errors.length}건)`);
    for (const e of errors) console.error(' - ' + e);
    process.exit(1);
  }
  console.log(`✅ 콘텐츠 검사 통과: 오늘 ${today.cards.length}개, 사전 ${terms.terms.length}개`);
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

try {
  if (command === 'validate') validate();
  else if (command === 'merge') merge();
  else {
    console.error('사용법: node scripts/content.mjs <validate|merge> [--site site]');
    process.exit(2);
  }
} catch (e) {
  console.error('❌ ' + e.message);
  process.exit(1);
}
