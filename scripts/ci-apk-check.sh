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

printf '%s\n' "$report"
esc="$(printf '%s' "$report" | python3 -c 'import sys; t = sys.stdin.read(); print(t.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))')"
if [ "$fail" -eq 0 ]; then
  echo "::notice title=APK 점검 결과::${esc}"
else
  echo "::error title=APK 점검 실패::${esc}"
fi
rm -rf "$WORK"
exit "$fail"
