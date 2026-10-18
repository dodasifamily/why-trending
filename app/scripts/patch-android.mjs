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
//   5) (푸시 알림을 켠 빌드에서만) Firebase 설정 파일·Gradle 부품·매니페스트 설정 넣기
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
const SIGN_MARK = '// ---- 왜이슈: 시험용 서명 키 고정 ----';
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

// ---------- 4) 푸시 알림(FCM): app/google-services.json 이 있을 때만 ----------
// (prepare-fcm.mjs 가 파일을 검사하고 부품을 넣었을 때만 파일이 있어요. 없으면 이 구역은 건너뛰어요.)
const fcmJson = path.join(appDir, 'google-services.json');
const fcmOn = fs.existsSync(fcmJson);
const FCM_MARK = '// ---- 왜이슈: 푸시 알림(FCM) ----';
if (fcmOn) {
  // (a) Firebase 설정 파일을 앱 폴더로
  fs.copyFileSync(fcmJson, path.join(androidDir, 'app', 'google-services.json'));

  // (b) 구글 서비스 Gradle 부품(classpath): Capacitor 가 만든 틀에 이미 들어 있어요. 빠져 있으면 넣어요
  const rootGradlePath = path.join(androidDir, 'build.gradle');
  let rootGradle = mustRead(rootGradlePath);
  if (!/com\.google\.gms:google-services:/.test(rootGradle)) {
    const re = /(buildscript\s*\{[\s\S]*?dependencies\s*\{)/;
    if (!re.test(rootGradle)) throw new Error('android/build.gradle 에서 buildscript dependencies 를 찾지 못했어요');
    rootGradle = rootGradle.replace(re, `$1\n        classpath 'com.google.gms:google-services:4.4.4'`);
    fs.writeFileSync(rootGradlePath, rootGradle);
    console.log('android/build.gradle 에 google-services classpath 를 넣었어요');
  }

  // (c) 앱 build.gradle: google-services 부품을 적용해요 (틀에 '파일이 있을 때만 적용' 코드가 이미 있어요. 없으면 넣어요)
  gradle = fs.readFileSync(gradlePath, 'utf8');
  if (!/com\.google\.gms\.google-services/.test(gradle)) {
    gradle += `\n${FCM_MARK}\napply plugin: 'com.google.gms.google-services'\n`;
    fs.writeFileSync(gradlePath, gradle);
    console.log('app/build.gradle 에 google-services 적용 코드를 넣었어요');
  }

  // (d) 매니페스트: 알림 작은 아이콘·기본 채널, 그리고 '알림을 켜기 전에는 기기 등록을 하지 않게' 자동 등록 끄기
  //     (앱이 알림을 켤 때 getToken() 으로 등록해요. 끄면 deleteToken() 으로 지워요)
  manifest = fs.readFileSync(manifestPath, 'utf8');
  const metas = [
    ['com.google.firebase.messaging.default_notification_icon', 'android:resource="@drawable/ic_stat_whyttuji"'],
    ['com.google.firebase.messaging.default_notification_channel_id', 'android:value="daily"'],
    ['firebase_messaging_auto_init_enabled', 'android:value="false"'],
    ['firebase_analytics_collection_enabled', 'android:value="false"']
  ];
  for (const [name, attr] of metas) {
    if (!manifest.includes(`android:name="${name}"`)) {
      manifest = manifest.replace('</application>', `        <meta-data android:name="${name}" ${attr} />\n    </application>`);
    }
  }
  fs.writeFileSync(manifestPath, manifest);
}

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
if (fcmOn) {
  const afterFcm = fs.readFileSync(manifestPath, 'utf8');
  for (const needle of ['com.google.firebase.messaging.default_notification_icon', 'com.google.firebase.messaging.default_notification_channel_id', 'firebase_messaging_auto_init_enabled']) {
    if (!afterFcm.includes(needle)) throw new Error(`푸시 알림을 켰는데 매니페스트에 ${needle} 가 없어요`);
  }
  if (!fs.existsSync(path.join(androidDir, 'app', 'google-services.json'))) throw new Error('android/app/google-services.json 이 없어요');
  const rg = fs.readFileSync(path.join(androidDir, 'build.gradle'), 'utf8');
  const ag = fs.readFileSync(gradlePath, 'utf8');
  if (!/com\.google\.gms:google-services:/.test(rg)) throw new Error('android/build.gradle 에 google-services classpath 가 없어요');
  if (!/com\.google\.gms\.google-services/.test(ag)) throw new Error('app/build.gradle 에 google-services 적용 코드가 없어요');
  const cp = (rg.match(/.*com\.google\.gms:google-services:.*/) || [''])[0].trim();
  const ap = ag.split('\n').filter((l) => /google-services/.test(l)).map((l) => l.trim()).join(' | ');
  console.log(`::notice title=푸시 알림(FCM) Gradle 설정::${cp} / ${ap}`);
}
console.log('✅ android 프로젝트 고치기 완료');
console.log(`   versionCode=${versionCode} versionName=${versionName}`);
console.log(`   AdMob 앱 ID=${admobAppId}`);
console.log(`   푸시 알림(FCM)=${fcmOn ? '켜짐' : '꺼짐'}`);
console.log('--- AndroidManifest.xml ---');
console.log(after);
