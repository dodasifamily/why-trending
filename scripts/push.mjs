#!/usr/bin/env node
// 분야별 맞춤 알림을 FCM(HTTP v1)으로 보내요.
// GitHub Actions 의 push.yml 이 매일 아침 7시·8시·9시(한국 시간)에 한 번씩 실행해요.
//
// 사용:  node scripts/push.mjs [--hour 8] [--dry-run] [--wait 25]
// 환경 변수:
//   FCM_SERVICE_ACCOUNT_JSON  Firebase 서비스 계정 키(JSON 전체). 없으면 아무것도 보내지 않고 끝내요.
//   HOUR      받는 시각(7·8·9). --hour 로도 줄 수 있어요.
//   DRY_RUN   1 또는 true 면 보내지 않고 보낼 내용만 보여줘요. (키가 없어도 돼요)
//   WAIT_MIN  오늘 해설이 올라오길 기다리는 최대 분. 기본 0.
//
// 하는 일
//   1) 오늘(한국 시간) 해설이 main 에 올라올 때까지 기다려요 (git fetch 로 origin/main 의 today.json 을 봐요)
//   2) 오늘 해설이 있는 분야마다 메시지를 1개씩 만들어, '그 분야를 고르고 이 시각을 고른 기기'에만 보내요
//      (조건: 'cat_<분야>' in topics && 'h<시각>' in topics — 앱이 알림을 켤 때 이 주제들을 구독해요)
//   3) 오늘 해설이 없거나 아직 안 올라왔으면 아무것도 보내지 않아요. 지난 해설로 '새 해설' 알림을 보내지 않아요.
//
// 비밀 값(서비스 계정 키, 접근 토큰)은 화면에 출력하지 않아요.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HOURS = [7, 8, 9];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOPIC_RE = /^[a-z0-9_]{1,30}$/;

// ---------- 작은 도구 ----------
export function kstDate(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function esc(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function notice(title, msg) {
  console.log(`::notice title=${esc(title)}::${esc(msg)}`);
}
function warning(title, msg) {
  console.log(`::warning title=${esc(title)}::${esc(msg)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 메시지 만들기 ----------
/**
 * 오늘 해설이 있는 분야마다 알림 하나를 만들어요.
 * @returns {{group:string, condition:string, title:string, body:string, route:string, count:number}[]}
 */
export function buildMessages({ today, groups, hour, date }) {
  if (!HOURS.includes(hour)) throw new Error(`받는 시각은 ${HOURS.join('·')} 중 하나여야 해요: ${hour}`);
  const byGroup = new Map();
  for (const c of (today && today.cards) || []) {
    if (!c || c.date !== date || typeof c.id !== 'string' || typeof c.group !== 'string' || typeof c.keyword !== 'string') continue;
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push(c);
  }
  const out = [];
  for (const g of groups || []) {
    if (!g || !TOPIC_RE.test(String(g.id))) continue;
    const list = byGroup.get(g.id);
    if (!list || !list.length) continue;
    const first = list[0];
    const more = list.length - 1;
    out.push({
      group: g.id,
      condition: `'cat_${g.id}' in topics && 'h${hour}' in topics`,
      title: `오늘 뜨는 ${g.label}`,
      body: `${first.keyword}${more > 0 ? ` 외 ${more}개` : ''} · 왜 뜨는지 30초로 알아봐요`,
      route: `/t/${encodeURIComponent(first.id)}`,
      count: list.length
    });
  }
  return out;
}

/** FCM HTTP v1 요청 본문 */
export function toFcmBody(m) {
  return {
    message: {
      condition: m.condition,
      notification: { title: m.title, body: m.body },
      data: { route: m.route, group: m.group },
      android: {
        priority: 'NORMAL', // 아침 알림은 몇 분 늦어도 괜찮아요 (잠든 기기를 억지로 깨우지 않아요)
        ttl: '21600s', // 6시간 안에 못 받으면 버려요. 저녁에 '아침 알림'이 도착하지 않게 해요
        collapse_key: `daily_${m.group}`,
        notification: { channel_id: 'daily', tag: `daily_${m.group}`, icon: 'ic_stat_whyttuji', color: '#3347FF' }
      }
    }
  };
}

// ---------- 인증 (서비스 계정 → 접근 토큰) ----------
export function parseServiceAccount(raw) {
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (e) {
    throw new Error('FCM_SERVICE_ACCOUNT_JSON 이 JSON 이 아니에요. 서비스 계정 키 파일의 내용 전체를 그대로 붙여 넣어야 해요.');
  }
  for (const k of ['project_id', 'client_email', 'private_key']) {
    if (!sa || typeof sa[k] !== 'string' || !sa[k]) throw new Error(`서비스 계정 키에 ${k} 가 없어요. Firebase 에서 받은 '서비스 계정 키' 파일이 맞는지 확인해 주세요.`);
  }
  if (!/^[a-z][a-z0-9-]{4,29}$/.test(sa.project_id)) throw new Error('서비스 계정 키의 project_id 모양이 이상해요.');
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(sa.private_key)) throw new Error('서비스 계정 키의 private_key 모양이 이상해요.');
  return sa;
}

const b64url = (v) => Buffer.from(v).toString('base64url');

export function signJwt(sa, now = Math.floor(Date.now() / 1000)) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope: SCOPE, aud: sa.token_uri || TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key);
  return `${unsigned}.${b64url(sig)}`;
}

export async function getAccessToken(sa, fetchImpl = fetch) {
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(sa) });
  const res = await fetchImpl(sa.token_uri || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    /* 아래에서 처리해요 */
  }
  if (!res.ok || !json || !json.access_token) {
    const why = json && (json.error_description || json.error) ? `${json.error || ''} ${json.error_description || ''}`.trim() : text.slice(0, 160);
    throw new Error(`접근 토큰을 받지 못했어요 (HTTP ${res.status}): ${why}`);
  }
  return json.access_token;
}

// ---------- 보내기 ----------
export async function sendOne({ accessToken, projectId, body, fetchImpl = fetch, retries = 2, wait = sleep }) {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body)
      });
    } catch (netErr) {
      if (attempt >= retries) throw new Error(`FCM 에 연결하지 못했어요: ${netErr && netErr.message ? netErr.message : netErr}`);
      await wait(2000 * (attempt + 1));
      continue;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      /* 아래에서 처리해요 */
    }
    if (res.ok) return (json && json.name) || '(이름 없음)';
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      await wait(2000 * (attempt + 1));
      continue;
    }
    const err = (json && json.error) || {};
    throw new Error(`FCM 응답 ${res.status} ${err.status || ''}: ${err.message || text.slice(0, 200)}`.replace(/\s+/g, ' ').trim());
  }
}

// ---------- 오늘 해설 읽기 ----------
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function gitShow(ref, file) {
  return JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
}

/** 오늘 해설이 올라올 때까지 기다려요. 못 찾으면 null 이에요. */
export async function loadToday({ date, waitMin = 0, readLocal, readRemote, wait = sleep, now = Date.now }) {
  const deadline = now() + waitMin * 60 * 1000;
  let attempt = 0;
  for (;;) {
    let today = null;
    try {
      today = attempt === 0 ? readLocal() : readRemote();
    } catch (e) {
      today = null;
    }
    if (today && today.date === date && Array.isArray(today.cards) && today.cards.length) return today;
    attempt++;
    if (now() >= deadline) return null;
    console.log(`오늘(${date}) 해설이 아직 안 올라왔어요. 3분 뒤 다시 볼게요.`);
    await wait(3 * 60 * 1000);
  }
}

/** origin/main 의 최신 today.json 을 읽어요 (해설 갱신이 push.yml 시작 뒤에 올라온 경우를 위해) */
export function readRemoteFromGit() {
  execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd: ROOT, stdio: 'ignore' });
  return gitShow('FETCH_HEAD', 'site/data/today.json');
}

// ---------- 실행 ----------
function parseArgs(argv) {
  const a = { dryRun: false, hour: undefined, wait: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') a.dryRun = true;
    else if (argv[i] === '--hour') a.hour = argv[++i];
    else if (argv[i] === '--wait') a.wait = argv[++i];
  }
  return a;
}

export async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, wait = sleep, now = Date.now, readLocal, readRemote } = {}) {
  const args = parseArgs(argv);
  const hour = Number(args.hour ?? env.HOUR ?? 8);
  const dry = args.dryRun || env.DRY_RUN === '1' || String(env.DRY_RUN).toLowerCase() === 'true';
  const waitMin = Math.max(0, Number(args.wait ?? env.WAIT_MIN ?? 0) || 0);
  if (!HOURS.includes(hour)) {
    console.error(`❌ 받는 시각이 올바르지 않아요: ${args.hour ?? env.HOUR} (7, 8, 9 중 하나)`);
    return 1;
  }

  const saRaw = env.FCM_SERVICE_ACCOUNT_JSON;
  let sa = null;
  if (saRaw) {
    try {
      sa = parseServiceAccount(saRaw);
    } catch (e) {
      console.error(`❌ ${e.message}`);
      return 1;
    }
  } else if (!dry) {
    notice('알림 보내기를 건너뛰었어요', 'FCM_SERVICE_ACCOUNT_JSON 이 아직 등록되지 않았어요. Firebase 설정을 마치고 GitHub 의 Secrets 에 등록하면 그때부터 보내요.');
    return 0;
  }

  const date = kstDate(now());
  const groups = (readLocal ? readLocal('categories') : readJson('site/data/categories.json')).groups;
  const today = await loadToday({
    date,
    waitMin,
    readLocal: () => (readLocal ? readLocal('today') : readJson('site/data/today.json')),
    readRemote: readRemote || readRemoteFromGit,
    wait,
    now
  });
  if (!today) {
    warning('알림을 보내지 않았어요', `오늘(${date}) 해설이 아직 올라오지 않았어요. 지난 해설로 '새 해설' 알림을 보내지 않아요.`);
    console.log(`오늘(${date}) 해설이 없어서 ${hour}시 알림을 보내지 않았어요.`);
    return 0;
  }

  const messages = buildMessages({ today, groups, hour, date });
  console.log(`${date} ${hour}시 알림: 분야 ${messages.length}곳 (오늘 해설 ${today.cards.length}개)${dry ? ' — 시험 보기(보내지 않아요)' : ''}`);
  if (!messages.length) return 0;

  if (dry) {
    for (const m of messages) {
      console.log(`- [${m.group}] ${m.title} / ${m.body}`);
      console.log(`    조건: ${m.condition}  열기: ${m.route}  (해설 ${m.count}개)`);
    }
    return 0;
  }

  let accessToken;
  try {
    accessToken = await getAccessToken(sa, fetchImpl);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    return 1;
  }

  let failed = 0;
  const sent = [];
  for (const m of messages) {
    try {
      const name = await sendOne({ accessToken, projectId: sa.project_id, body: toFcmBody(m), fetchImpl, wait });
      sent.push(m.group);
      console.log(`✅ [${m.group}] 보냈어요 (${name.split('/').pop()})`);
    } catch (e) {
      failed++;
      console.error(`❌ [${m.group}] 못 보냈어요: ${e.message}`);
    }
  }
  notice('분야별 알림', `${date} ${hour}시: ${sent.length}곳 보냄 (${sent.join(', ') || '없음'})${failed ? `, ${failed}곳 실패` : ''}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`❌ ${e && e.message ? e.message : e}`);
      process.exit(1);
    }
  );
}
