#!/usr/bin/env node
// 아침 알림을 FCM(HTTP v1)으로 보내요. 시각마다 알림은 딱 1개예요 (분야별로 나누지 않아요).
// GitHub Actions 의 push.yml 이 매일 아침 7시·8시·9시(한국 시간)에 한 번씩 실행해요.
//
// 사용:  node scripts/push.mjs [--hour 8] [--dry-run] [--wait 25]
// 환경 변수:
//   FCM_SERVICE_ACCOUNT_JSON  Firebase 서비스 계정 키(JSON 전체). 없으면 아무것도 보내지 않고 끝내요.
//   HOUR      받는 시각(7·8·9). --hour 로도 줄 수 있어요.
//   DRY_RUN   1 또는 true 면 보내지 않고 보낼 내용만 보여줘요. (키가 없어도 돼요)
//   WAIT_MIN  오늘 해설이 올라오길 기다리는 최대 분. 기본 0.
//   PUSH_FILE 시험 보내기 파일 경로(ops/push-now.json). 이 파일이 있으면 HOUR·DRY_RUN·WAIT_MIN 대신 파일 내용대로 해요.
//             {"hours":[8], "dry_run": false} — dry_run 을 false 로 분명히 적었을 때만 진짜로 보내요.
//             {"hours":[8], "dry_run": false, "validate_only": true} — FCM 에 '검사만' 부탁해요. 기기에는 아무것도 가지 않고,
//             키·프로젝트·FCM 설정이 맞는지만 확인돼요.
//             {"hours":[8], "dry_run": false, "use_latest": true} — 오늘 해설이 아직 안 올라온 시각(자정~아침 해설 갱신 전)에도
//             시험할 수 있게, 저장소에 올라와 있는 가장 최근 해설로 해요. true 라고 분명히 적었을 때만 켜지고,
//             시험 보내기 파일에서만 쓸 수 있어요 (예약 실행은 항상 '오늘 해설'만 보내요).
//   GOOGLE_SERVICES_JSON  (선택) 앱에 넣은 Firebase 설정. 있으면 서비스 계정 키와 같은 프로젝트인지 확인해요.
//
// 하는 일
//   1) 오늘(한국 시간) 해설이 main 에 올라올 때까지 기다려요 (git fetch 로 origin/main 의 today.json 을 봐요)
//   2) 오늘 해설이 있으면 알림을 1개 만들어, '이 시각을 고른 기기'(주제 'h<시각>')에 보내요.
//      제목은 '오늘 뜨는 소식 N개', 내용은 서로 다른 분야의 대표 소식 2개 + 나머지 개수예요. 누르면 앱 첫 화면이 열려요.
//      (앱은 알림을 켤 때 'cat_<분야>' 와 'h<시각>' 주제를 함께 구독하지만, 알림은 분야와 상관없이 시각 주제로만 보내요)
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
// 실패 이유가 GitHub 의 '알림'으로도 남아요 (전체 로그를 열지 않아도 보여요). 비밀 값은 넣지 않아요.
function failure(title, msg) {
  console.log(`::error title=${esc(title)}::${esc(msg)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 메시지 만들기 ----------
/**
 * 오늘 해설이 있으면 그 시각의 알림을 하나 만들어요 (분야별로 나누지 않아요).
 * 제목에 오늘 해설 개수, 내용에 대표 소식 2개(서로 다른 분야의 첫 카드)와 나머지 개수를 넣어서
 * 한 번에 새 소식을 보러 오게 해요. today.json 의 카드는 화제성 높은 순서로 올라와요.
 * @returns {{group:string, topic:string, title:string, body:string, route:string, count:number}[]}
 */
export function buildMessages({ today, hour, date }) {
  if (!HOURS.includes(hour)) throw new Error(`받는 시각은 ${HOURS.join('·')} 중 하나여야 해요: ${hour}`);
  const cards = [];
  for (const c of (today && today.cards) || []) {
    if (!c || c.date !== date || typeof c.id !== 'string' || typeof c.group !== 'string' || typeof c.keyword !== 'string' || !c.keyword.trim()) continue;
    cards.push(c);
  }
  if (!cards.length) return [];
  const leads = [];
  const seen = new Set();
  for (const c of cards) {
    if (leads.length >= 2) break;
    if (seen.has(c.group)) continue;
    seen.add(c.group);
    leads.push(c);
  }
  for (const c of cards) {
    if (leads.length >= 2) break; // 분야가 하나뿐이면 같은 분야 카드로 채워요
    if (!leads.includes(c)) leads.push(c);
  }
  const rest = cards.length - leads.length;
  return [
    {
      group: 'all',
      topic: `h${hour}`,
      title: `오늘 뜨는 소식 ${cards.length}개`,
      body: `${leads.map((c) => c.keyword.trim()).join(', ')}${rest > 0 ? ` 외 ${rest}개` : ''} · 왜 뜨는지 30초로 알아봐요`,
      route: '/',
      count: cards.length
    }
  ];
}

/** FCM HTTP v1 요청 본문 (m.topic 이 있으면 그 주제로, 없으면 m.condition 조건으로 보내요) */
export function toFcmBody(m, { validateOnly = false } = {}) {
  return {
    ...(validateOnly ? { validate_only: true } : {}),
    message: {
      ...(m.topic ? { topic: m.topic } : { condition: m.condition }),
      notification: { title: m.title, body: m.body },
      data: { route: m.route, group: m.group },
      android: {
        priority: 'high', // 정한 시각에 맞춰 도착해야 해서 high 예요 (normal 은 잠든 기기에 몇 시간 늦게 갈 수 있어요). 하루 한 번만 보내요
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

/** 앱에 넣은 Firebase 설정(google-services.json)의 프로젝트 ID. 읽지 못하면 null (확인을 건너뛰어요) */
export function appProjectId(raw) {
  try {
    const id = JSON.parse(raw).project_info.project_id;
    return typeof id === 'string' && id ? id : null;
  } catch (e) {
    return null;
  }
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

export async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch, wait = sleep, now = Date.now, readLocal, readRemote, readFile } = {}) {
  const args = parseArgs(argv);
  let hours = [Number(args.hour ?? env.HOUR ?? 8)];
  let dry = args.dryRun || env.DRY_RUN === '1' || String(env.DRY_RUN).toLowerCase() === 'true';
  let waitMin = Math.max(0, Number(args.wait ?? env.WAIT_MIN ?? 0) || 0);
  let validateOnly = false;
  let useLatest = false;

  // 시험 보내기: ops/push-now.json 이 바뀐 커밋이 main 에 올라오면 push.yml 이 파일에 적힌 대로 보내요.
  if (env.PUSH_FILE) {
    let cfg;
    try {
      cfg = JSON.parse(readFile ? readFile(env.PUSH_FILE) : fs.readFileSync(path.join(ROOT, env.PUSH_FILE), 'utf8'));
    } catch (e) {
      notice('시험 보내기를 건너뛰었어요', `${env.PUSH_FILE} 를 읽지 못했어요 (파일이 지워졌거나 JSON 모양이 아니에요).`);
      return 0;
    }
    hours = (Array.isArray(cfg && cfg.hours) ? cfg.hours : [cfg && cfg.hour !== undefined ? cfg.hour : 8]).map(Number);
    dry = !(cfg && cfg.dry_run === false); // false 라고 분명히 적었을 때만 진짜로 보내요
    validateOnly = !!(cfg && cfg.validate_only === true); // true 라고 분명히 적었을 때만 '검사만' 해요
    useLatest = !!(cfg && cfg.use_latest === true); // true 라고 분명히 적었을 때만 '올라와 있는 가장 최근 해설'로 해요 (시험 전용)
    waitMin = 0;
  }
  hours = [...new Set(hours)];
  if (!hours.length || hours.some((h) => !HOURS.includes(h))) {
    console.error(`❌ 받는 시각이 올바르지 않아요: ${hours.join(', ') || '(없음)'} (7, 8, 9 중에서 골라요)`);
    return 1;
  }

  const saRaw = env.FCM_SERVICE_ACCOUNT_JSON;
  let sa = null;
  if (saRaw) {
    try {
      sa = parseServiceAccount(saRaw);
    } catch (e) {
      console.error(`❌ ${e.message}`);
      failure('서비스 계정 키가 이상해요', e.message);
      return 1;
    }
  } else if (!dry) {
    notice('알림 보내기를 건너뛰었어요', 'FCM_SERVICE_ACCOUNT_JSON 이 아직 등록되지 않았어요. Firebase 설정을 마치고 GitHub 의 Secrets 에 등록하면 그때부터 보내요.');
    return 0;
  }
  // 앱에 넣은 Firebase 프로젝트와 알림을 보내는 프로젝트가 다르면 알림이 기기에 닿지 않아요
  const appProject = env.GOOGLE_SERVICES_JSON ? appProjectId(env.GOOGLE_SERVICES_JSON) : null;
  if (sa && appProject && appProject !== sa.project_id) {
    const msg = `앱에 넣은 Firebase 프로젝트(${appProject})와 서비스 계정 키의 프로젝트(${sa.project_id})가 달라요. 두 값을 같은 Firebase 프로젝트에서 받았는지 확인해 주세요.`;
    console.error(`❌ ${msg}`);
    failure('Firebase 프로젝트가 서로 달라요', msg);
    return 1;
  }

  let date = kstDate(now());
  if (useLatest) {
    let latest = null;
    try {
      latest = (readLocal ? readLocal('today') : readJson('site/data/today.json')).date;
    } catch (e) {
      latest = null;
    }
    if (typeof latest === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(latest) && latest !== date) {
      notice('가장 최근 해설로 시험해요', `오늘(${date}) 해설이 아직 없어서, 저장소에 올라와 있는 ${latest} 해설로 시험해요. (시험 보내기에서만 쓰는 옵션이에요)`);
      date = latest;
    }
  }
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
    console.log(`오늘(${date}) 해설이 없어서 ${hours.join('·')}시 알림을 보내지 않았어요.`);
    return 0;
  }

  let accessToken = null;
  let failed = 0;
  for (const hour of hours) {
    const messages = buildMessages({ today, hour, date });
    console.log(`${date} ${hour}시 알림: ${messages.length}개 (오늘 해설 ${today.cards.length}개)${dry ? ' — 시험 보기(보내지 않아요)' : ''}`);
    if (!messages.length) continue;

    if (dry) {
      const lines = [];
      for (const m of messages) {
        console.log(`- ${m.title} / ${m.body}`);
        console.log(`    대상: 주제 ${m.topic}  열기: ${m.route}  (해설 ${m.count}개)`);
        lines.push(`${m.title} / ${m.body}`);
      }
      notice(`시험 보기 ${hour}시 (보내지 않아요)`, lines.join('\n'));
      continue;
    }

    if (!accessToken) {
      try {
        accessToken = await getAccessToken(sa, fetchImpl);
      } catch (e) {
        console.error(`❌ ${e.message}`);
        failure('접근 토큰을 받지 못했어요', e.message);
        return 1;
      }
    }

    const sent = [];
    let failedHere = 0;
    for (const m of messages) {
      try {
        const name = await sendOne({ accessToken, projectId: sa.project_id, body: toFcmBody(m, { validateOnly }), fetchImpl, wait });
        sent.push(m.group);
        console.log(validateOnly ? `✅ [${m.group}] 검사 통과 (기기에는 보내지 않았어요)` : `✅ [${m.group}] 보냈어요 (${name.split('/').pop()})`);
      } catch (e) {
        failedHere++;
        console.error(`❌ [${m.group}] 못 보냈어요: ${e.message}`);
        failure(`${m.group} 알림을 못 보냈어요`, e.message);
      }
    }
    failed += failedHere;
    notice(validateOnly ? '아침 알림 (검사만)' : '아침 알림', `${date} ${hour}시: ${sent.length ? (validateOnly ? '검사 통과, 기기에는 보내지 않았어요' : '보냄') : '못 보냄'} — ${messages[0].title} / ${messages[0].body}${failedHere ? ` (${failedHere}개 실패)` : ''}`);
  }
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
