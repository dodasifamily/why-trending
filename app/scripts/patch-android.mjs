#!/usr/bin/env node
// Capacitor 가 만든 android 폴더를 우리 앱에 맞게 고쳐요.
// GitHub Actions 에서 `npx cap add android` 바로 다음에 실행해요. (app 폴더에서 실행)
//
// 하는 일
//   1) 매니페스트에 AdMob 앱 ID 와 알림 권한 넣기 (AdMob ID 가 없으면 앱이 시작하자마자 꺼져요)
//      + 알림 부품이 끼워 넣는 '정확한 알람' 권한은 빼기 (플레이 심사에 걸릴 수 있어요)
//   2) versionCode / versionName 정하기 (구글 플레이는 올릴 때마다 versionCode 가 커져야 해요)
//   3) 알림 작은 아이콘 만들기
//   4) 시험용(디버그) 앱 서명 키를 환경 변수로 받은 고정 키로 바꾸기 (폰에서 덮어 설치되게)
// 하나라도 못 고치면 일부러 실패해서, 잘못된 앱이 만들어지지 않게 해요.

import fs from 'node:fs';
import path from 'node:path';

const appDir = process.cwd();
const androidDir = path.join(appDir, 'android');
const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = path.join(androidDir, 'app', 'build.gradle');
const drawableDir = path.join(androidDir, 'app', 'src', 'main', 'res', 'drawable');

const cfg = JSON.parse(fs.readFileSync(path.join(appDir, 'app.config.json'), 'utf8'));
const versionCode = String(process.env.VERSION_CODE || '1');
if (!/^\d+$/.test(versionCode)) throw new Error(`VERSION_CODE 가 숫자가 아니에요: ${versionCode}`);
const versionName = String(cfg.versionName || '1.0');
const admobAppId = cfg.admob && cfg.admob.appId;
if (!/^ca-app-pub-\d{16}~\d{10}$/.test(String(admobAppId))) throw new Error(`AdMob 앱 ID 형식이 올바르지 않아요: ${admobAppId}`);

function mustRead(file) {
  if (!fs.existsSync(file)) throw new Error(`파일이 없어요: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

// ---------- 1) 매니페스트 ----------
let manifest = mustRead(manifestPath);

if (!manifest.includes('com.google.android.gms.ads.APPLICATION_ID')) {
  const meta = `\n        <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${admobAppId}" />\n    `;
  if (!manifest.includes('</application>')) throw new Error('매니페스트에서 </application> 을 찾지 못했어요');
  manifest = manifest.replace('</application>', `${meta}</application>`);
}

const perms = ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'];
for (const p of perms) {
  if (!manifest.includes(`android:name="${p}"`)) {
    if (!manifest.includes('</manifest>')) throw new Error('매니페스트에서 </manifest> 를 찾지 못했어요');
    manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${p}" />\n</manifest>`);
  }
}

// 알림 부품(local-notifications)이 '정확한 알람' 권한을 몰래 끼워 넣어요.
// 구글 플레이는 알람·캘린더 앱이 아니면 이 권한이 든 앱을 올리지 못하게 해요.
// 이 앱의 아침 알림은 몇 분 늦어도 괜찮아서, 권한을 빼면 부품이 알아서 '대략적인 시각' 방식으로 예약해요.
const strip = ['android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM'];
if (!/xmlns:tools\s*=/.test(manifest)) {
  if (!/<manifest\b/.test(manifest)) throw new Error('매니페스트에서 <manifest 를 찾지 못했어요');
  manifest = manifest.replace(/<manifest\b/, '<manifest xmlns:tools="http://schemas.android.com/tools"');
}
for (const p of strip) {
  if (!manifest.includes(`android:name="${p}"`)) {
    manifest = manifest.replace('</manifest>', `    <uses-permission android:name="${p}" tools:node="remove" />\n</manifest>`);
  }
}
fs.writeFileSync(manifestPath, manifest);

// ---------- 2) 버전 ----------
let gradle = mustRead(gradlePath);
const vcRe = /versionCode\s*=?\s*\d+/;
const vnRe = /versionName\s*=?\s*"[^"]*"/;
if (!vcRe.test(gradle) || !vnRe.test(gradle)) throw new Error('build.gradle 에서 versionCode/versionName 을 찾지 못했어요');
gradle = gradle.replace(vcRe, `versionCode ${versionCode}`).replace(vnRe, `versionName "${versionName}"`);
const SIGN_MARK = '// ---- 왜뜨지: 시험용 서명 키 고정 ----';
if (!gradle.includes(SIGN_MARK)) {
  // 환경 변수 WHYTTUJI_DEBUG_KEYSTORE 에 키 파일 경로가 있으면 시험용(디버그) 앱을 그 키로 서명해요. 없으면 기본 동작이에요.
  // 빌드마다 같은 키여야 폰에서 새 시험용 앱을 지우지 않고 덮어 설치할 수 있어요. (출시용 키가 아니에요)
  gradle += `
${SIGN_MARK}
def whyttujiDebugKeystore = System.getenv('WHYTTUJI_DEBUG_KEYSTORE')
if (whyttujiDebugKeystore) {
    android {
        signingConfigs {
            debug {
                storeFile file(whyttujiDebugKeystore)
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
    }
}
`;
}
fs.writeFileSync(gradlePath, gradle);

// ---------- 3) 알림 작은 아이콘 (흰색 말풍선) ----------
fs.mkdirSync(drawableDir, { recursive: true });
fs.writeFileSync(
  path.join(drawableDir, 'ic_stat_whyttuji.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M5,3 h14 a3,3 0 0 1 3,3 v8 a3,3 0 0 1 -3,3 h-6 l-5,4 v-4 h-3 a3,3 0 0 1 -3,-3 v-8 a3,3 0 0 1 3,-3 z" />
</vector>
`
);

// ---------- 확인 ----------
const after = fs.readFileSync(manifestPath, 'utf8');
if (!fs.readFileSync(gradlePath, 'utf8').includes(SIGN_MARK)) throw new Error('build.gradle 에 시험용 서명 키 설정이 들어가지 않았어요');
for (const needle of ['com.google.android.gms.ads.APPLICATION_ID', 'android.permission.POST_NOTIFICATIONS', 'android.permission.INTERNET']) {
  if (!after.includes(needle)) throw new Error(`고친 뒤에도 매니페스트에 ${needle} 가 없어요`);
}
for (const p of strip) {
  const re = new RegExp(`<uses-permission[^>]*android:name="${p.replace(/\./g, '\\.')}"[^>]*tools:node="remove"`);
  if (!re.test(after)) throw new Error(`고친 뒤에도 매니페스트에 ${p} 제거 표시가 없어요`);
}
if (!/xmlns:tools="http:\/\/schemas\.android\.com\/tools"/.test(after)) throw new Error('매니페스트에 tools 이름공간이 없어요');
console.log('✅ android 프로젝트 고치기 완료');
console.log(`   versionCode=${versionCode} versionName=${versionName}`);
console.log(`   AdMob 앱 ID=${admobAppId}`);
console.log('--- AndroidManifest.xml ---');
console.log(after);
