#!/usr/bin/env bash
# 만들어진 시험용 APK 안을 들여다보고, 꼭 있어야 하는 것들이 있는지 확인해요.
# (저장소 맨 위 폴더에서 실행해요.) 결과 요약은 GitHub 의 '알림'으로도 남겨요.
set -uo pipefail

SDK="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
BT="$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -n 1)"
[ -n "$BT" ] || { echo "build-tools 를 찾지 못했어요"; exit 1; }
APK="$(ls app/android/app/build/outputs/apk/debug/*.apk 2>/dev/null | head -n 1)"
[ -n "$APK" ] || { echo "APK 파일을 찾지 못했어요"; exit 1; }

WORK="$(mktemp -d)"
"$BT/aapt2" dump badging "$APK" > "$WORK/badging.txt" || { echo "aapt2 dump badging 실패"; exit 1; }
"$BT/aapt2" dump xmltree --file AndroidManifest.xml "$APK" > "$WORK/manifest.txt" || { echo "aapt2 dump xmltree 실패"; exit 1; }

report="APK: $(basename "$APK") ($(du -h "$APK" | cut -f1))"
report+=$'\n'"$(grep -E "^(package:|sdkVersion:|targetSdkVersion:|compileSdkVersion)" "$WORK/badging.txt")"
report+=$'\n'"--- 권한 ---"$'\n'"$(grep -E "^uses-permission" "$WORK/badging.txt" | sed -E "s/uses-permission(-sdk-23)?: name='([^']*)'.*/\2/")"

fail=0
check() { # 찾을 글자, 설명
  if grep -q "$1" "$WORK/manifest.txt"; then
    report+=$'\n'"✅ $2"
  else
    report+=$'\n'"❌ 없음: $2 ($1)"
    fail=1
  fi
}
check 'com.google.android.gms.ads.APPLICATION_ID' 'AdMob 앱 ID (없으면 앱이 켜지자마자 꺼져요)'
check 'android.permission.INTERNET' '인터넷 권한'
check 'android.permission.POST_NOTIFICATIONS' '알림 권한'

# 푸시 알림(FCM)은 Firebase 설정이 들어간 빌드에서만 켜져요 (workflow 가 FCM_ENABLED 로 알려줘요).
if [ "${FCM_ENABLED:-false}" = "true" ]; then
  check 'com.google.firebase.MESSAGING_EVENT' '푸시 알림(FCM) 받는 서비스'
  check 'com.google.firebase.messaging.default_notification_channel_id' '푸시 알림 기본 채널'
  check 'firebase_messaging_auto_init_enabled' '푸시 기기 등록은 알림을 켠 뒤에만 (자동 등록 끔)'
  # 앱 화면(웹)이 푸시 부품을 쓰려면 안드로이드 쪽에 부품이 등록돼 있어야 해요 (Capacitor 가 cap sync 때 만드는 목록)
  if unzip -p "$APK" assets/capacitor.plugins.json 2>/dev/null | grep -q 'firebase.messaging'; then
    report+=$'\n'"✅ 푸시 부품이 앱에 등록됐어요 (capacitor.plugins.json)"
  else
    report+=$'\n'"❌ 푸시 부품이 capacitor.plugins.json 에 없어요 — 앱이 알림 설정을 쓰지 못해요"
    fail=1
  fi
  if "$BT/aapt2" dump resources "$APK" 2>/dev/null | grep -q 'string/google_app_id'; then
    report+=$'\n'"✅ Firebase 앱 ID(google_app_id)가 들어갔어요"
  else
    report+=$'\n'"❌ Firebase 앱 ID(google_app_id)가 없어요 — google-services 부품이 적용되지 않았을 수 있어요"
    fail=1
  fi
elif grep -q 'com.google.firebase.MESSAGING_EVENT' "$WORK/manifest.txt"; then
  report+=$'\n'"❌ 푸시 알림은 꺼져 있어야 하는데 FCM 받는 서비스가 들어 있어요"
  fail=1
else
  report+=$'\n'"ℹ️ 푸시 알림(FCM): 꺼짐 (Firebase 설정을 등록하기 전이라 기기 안 알림만 써요)"
fi

# 구글 플레이는 새 앱·업데이트에 목표 SDK 36 이상을 요구해요.
target="$(sed -n "s/^targetSdkVersion:'\([0-9]*\)'.*/\1/p" "$WORK/badging.txt" | head -n 1)"
if [ -n "$target" ] && [ "$target" -ge 36 ]; then
  report+=$'\n'"✅ targetSdkVersion=$target"
else
  report+=$'\n'"❌ targetSdkVersion 이 36 미만이거나 읽지 못했어요: '${target}'"
  fail=1
fi

# 정확한 알람 권한은 일부러 뺐어요. 알람·캘린더 앱이 아니면 구글 플레이가 이 권한이 든 앱을 올리지 못하게 해요.
# (app/scripts/patch-android.mjs 가 알림 부품이 끼워 넣는 이 권한을 지워요. 남아 있으면 거기부터 보세요.)
if grep -qE 'SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM' "$WORK/manifest.txt"; then
  report+=$'\n'"❌ 정확한 알람 권한이 남아 있어요 — 구글 플레이 심사에 걸릴 수 있어요"
  fail=1
else
  report+=$'\n'"✅ 정확한 알람 권한 없음"
fi

# 앱 안 영상 재생: 유튜브는 플레이어를 넣은 쪽이 누구인지(앱이면 앱 ID) Referer 로 알려주길 요구해요.
# 앱 화면의 주소가 https://<앱 ID>/ 가 되도록 capacitor.config.json 의 server.hostname 을 앱 ID 와 같게 두었는지 확인해요.
pkg="$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" "$WORK/badging.txt" | head -n 1)"
host="$(unzip -p "$APK" assets/capacitor.config.json 2>/dev/null | python3 -c 'import sys, json; print((json.load(sys.stdin).get("server") or {}).get("hostname", ""))' 2>/dev/null || true)"
if [ -z "$host" ]; then
  report+=$'\n'"⚠️ APK 안의 capacitor.config.json 에서 server.hostname 을 읽지 못했어요 (영상 재생이 막힐 수 있어요)"
  fail=1
elif [ "$host" = "$pkg" ]; then
  report+=$'\n'"✅ 앱 화면 주소 호스트 = 앱 ID ($host)"
else
  report+=$'\n'"❌ 앱 화면 주소 호스트($host)가 앱 ID($pkg)와 달라요 — 유튜브 영상이 재생되지 않을 수 있어요"
  fail=1
fi

# 앱 안에 같이 넣는 해설 사본: 인터넷이 없거나 서버가 느릴 때 이 사본을 보여줘요.
# (분야 목록 categories.json 이 없으면 처음 실행 때 '분야 고르기'를 못 보여주고, recent.json 이 없으면 '지난 며칠'이 비어요.)
apk_list="$(unzip -l "$APK" 2>/dev/null || true)"
if grep -q 'assets/public/index.html' <<<"$apk_list"; then
  missing=""
  for f in today terms categories recent; do
    grep -q "assets/public/data/$f.json" <<<"$apk_list" || missing+=" $f.json"
  done
  if [ -z "$missing" ]; then
    report+=$'\n'"✅ 앱 안 해설 사본: today · terms · categories · recent"
  else
    report+=$'\n'"❌ 앱 안 해설 사본이 빠졌어요:$missing"
    fail=1
  fi
else
  report+=$'\n'"⚠️ APK 안에서 웹 화면(assets/public)을 찾지 못해 해설 사본 점검을 건너뛰었어요"
fi

# 시험용 앱을 폰에서 덮어 설치하려면 빌드마다 서명 키가 같아야 해요. 같은 키인지 비교할 수 있게 지문을 적어 둬요.
case "${KEY_CACHE_HIT:-}" in
  true) report+=$'\n'"🔑 서명 키: 저장해 둔 키를 불러왔어요" ;;
  *)    report+=$'\n'"🔑 서명 키: 저장된 키가 없어 새로 만들었어요 (이번 빌드부터 저장해요)" ;;
esac
norm() { tr -d ': ' | tr 'A-F' 'a-f'; }
sig_out="$("$BT/apksigner" verify --print-certs "$APK" 2>&1)"
apk_cert="$(printf '%s\n' "$sig_out" | sed -n 's/^.*certificate SHA-256 digest: *//p' | head -n 1 | norm)"
ks="${WHYTTUJI_DEBUG_KEYSTORE:-}"
ks_cert=""
if [ -n "$ks" ] && [ -f "$ks" ] && command -v keytool >/dev/null 2>&1; then
  ks_cert="$(keytool -list -keystore "$ks" -storepass android -alias androiddebugkey 2>/dev/null | sed -n 's/^Certificate fingerprint (SHA-256): *//p' | head -n 1 | norm)"
fi
if [ -z "$apk_cert" ]; then
  report+=$'\n'"서명 인증서 지문을 APK 에서 읽지 못했어요: $(printf '%s' "$sig_out" | head -n 2 | tr '\n' ' ' | cut -c1-240)"
else
  report+=$'\n'"서명 인증서 지문(SHA-256): ${apk_cert}"
  if [ -z "$ks_cert" ]; then
    report+=$'\n'"(저장해 둔 키 파일의 지문은 읽지 못했어요)"
  elif [ "$ks_cert" = "$apk_cert" ]; then
    report+=$'\n'"✅ 저장해 둔 키로 서명됐어요"
  else
    report+=$'\n'"⚠️ 저장해 둔 키(${ks_cert})로 서명되지 않았어요 — 폰에서 덮어 설치가 안 될 수 있어요"
  fi
fi

printf '%s\n' "$report"
esc="$(printf '%s' "$report" | python3 -c 'import sys; t = sys.stdin.read(); print(t.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))')"
if [ "$fail" -eq 0 ]; then
  echo "::notice title=APK 점검 결과::${esc}"
else
  echo "::error title=APK 점검 실패::${esc}"
fi
rm -rf "$WORK"
exit "$fail"
