#!/usr/bin/env node
// 푸시 알림(FCM)을 이번 빌드에서 켤지 정하고, 켜는 경우 필요한 부품을 package.json 에 더해요.
// GitHub Actions 에서 `npm install` 바로 앞에 실행해요. (app 폴더에서 실행)
//
// 켜지는 조건: Firebase 설정 파일(google-services.json)이 있을 때
//   - 환경 변수 GOOGLE_SERVICES_JSON (GitHub Secrets 에 붙여 넣은 파일 내용) → app/google-services.json 으로 저장해요
//   - 또는 app/google-services.json 파일이 이미 있을 때 (시험용 가지에서 가짜 파일로 빌드만 시험할 때)
// 조건이 맞지 않으면 아무것도 바꾸지 않고 '꺼짐' 으로 끝나요. (그러면 앱은 지금처럼 기기 안 알림만 써요)
// 파일이 있는데 내용이 이상하면 일부러 실패해서, 푸시가 안 되는 앱이 조용히 만들어지지 않게 해요.
//
// 파일 내용(API 키 등)은 화면에 출력하지 않아요.

import fs from 'node:fs';
import path from 'node:path';

const appDir = process.cwd();
const jsonPath = path.join(appDir, 'google-services.json');
const pkgPath = path.join(appDir, 'package.json');
const PLUGIN = '@capacitor-firebase/messaging';
const PLUGIN_RANGE = '^8.0.0'; // Capacitor 8 용 (8.x)

function setOutput(enabled) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `enabled=${enabled ? 'true' : 'false'}\n`);
}

function notice(title, msg) {
  console.log(`::notice title=${title}::${msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
}

function fail(msg) {
  console.error(`❌ ${msg}`);
  console.log(`::error title=푸시 알림(FCM) 준비 실패::${msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  process.exit(1);
}

const appId = JSON.parse(fs.readFileSync(path.join(appDir, 'capacitor.config.json'), 'utf8')).appId;
if (!appId) fail('capacitor.config.json 에 appId 가 없어요');

const fromEnv = (process.env.GOOGLE_SERVICES_JSON || '').trim();
if (fromEnv) {
  fs.writeFileSync(jsonPath, fromEnv + '\n', { mode: 0o600 });
}

if (!fs.existsSync(jsonPath)) {
  setOutput(false);
  notice('푸시 알림(FCM)은 꺼져 있어요', 'Firebase 설정(GOOGLE_SERVICES_JSON)이 아직 등록되지 않아서, 앱은 기기 안 알림만 써요. Firebase 설정을 마치면 다음 빌드부터 켜져요.');
  console.log('FCM 꺼짐: google-services.json 이 없어요');
  process.exit(0);
}

// ---------- 파일 검사 ----------
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  fail('GOOGLE_SERVICES_JSON 이 JSON 이 아니에요. Firebase 에서 내려받은 google-services.json 파일의 내용 전체를 그대로 붙여 넣어야 해요.');
}
const info = cfg && cfg.project_info;
if (!info || typeof info.project_id !== 'string' || !info.project_id) fail('google-services.json 에 project_info.project_id 가 없어요. Firebase 에서 받은 파일이 맞는지 확인해 주세요.');
if (!Array.isArray(cfg.client) || !cfg.client.length) fail('google-services.json 에 등록된 안드로이드 앱(client)이 없어요. Firebase 에서 안드로이드 앱을 먼저 등록해 주세요.');

const names = cfg.client.map((c) => c && c.client_info && c.client_info.android_client_info && c.client_info.android_client_info.package_name).filter(Boolean);
if (!names.includes(appId)) {
  fail(`google-services.json 에 등록된 앱 이름(패키지 이름)이 ${appId} 가 아니에요. 지금 등록된 이름: ${names.join(', ') || '(없음)'}. Firebase 에서 안드로이드 앱을 추가할 때 패키지 이름을 ${appId} 로 입력하고, 그 앱의 google-services.json 을 다시 받아 주세요.`);
}
const mine = cfg.client.find((c) => c.client_info.android_client_info.package_name === appId);
if (!mine.client_info.mobilesdk_app_id) fail('google-services.json 에 mobilesdk_app_id 가 없어요. 파일을 다시 받아 주세요.');

// ---------- 부품 더하기 ----------
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies = pkg.dependencies || {};
if (!pkg.dependencies[PLUGIN]) {
  pkg.dependencies[PLUGIN] = PLUGIN_RANGE;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

setOutput(true);
notice('푸시 알림(FCM)을 켰어요', `Firebase 프로젝트 ${info.project_id}, 앱 ${appId}. 부품 ${PLUGIN} 을 넣어서 만들어요.`);
console.log(`FCM 켜짐: 프로젝트 ${info.project_id}, 앱 ${appId}, 부품 ${PLUGIN}@${pkg.dependencies[PLUGIN]}`);
