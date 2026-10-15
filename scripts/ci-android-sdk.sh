#!/usr/bin/env bash
# GitHub 빌드 컴퓨터에 미리 깔려 있는 안드로이드 SDK(앱 만드는 도구 모음)를 점검해요.
# 빠진 게 있으면 그것만 채워 넣고, 실패하면 이유를 그대로 출력해요.
set -uo pipefail

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}"
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
echo "SDK 위치: $SDK"
[ -d "$SDK" ] || { echo "SDK 폴더가 없어요: $SDK"; exit 1; }

echo "--- 깔려 있는 것 ---"
for d in cmdline-tools platform-tools platforms build-tools; do
  printf '%s: ' "$d"
  ls "$SDK/$d" 2>/dev/null | tr '\n' ' '
  echo
done
echo "java: $(java -version 2>&1 | grep -m 1 'version "')"

SDKMANAGER="$(ls -d "$SDK"/cmdline-tools/*/bin/sdkmanager 2>/dev/null | sort -V | tail -n 1)"
[ -n "$SDKMANAGER" ] || SDKMANAGER="$(command -v sdkmanager || true)"
[ -n "$SDKMANAGER" ] || { echo "sdkmanager(도구 설치기)를 찾지 못했어요"; exit 1; }
echo "sdkmanager: $SDKMANAGER"

# 라이선스 동의: Gradle 이 모자란 도구를 스스로 받아오려면 필요해요.
yes | "$SDKMANAGER" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true

# Capacitor 8 은 SDK 36 으로 빌드해요. 없는 것만 채워요.
need=()
[ -d "$SDK/platforms/android-36" ] || need+=("platforms;android-36")
compgen -G "$SDK/build-tools/36.*" >/dev/null || need+=("build-tools;36.0.0")
[ -d "$SDK/platform-tools" ] || need+=("platform-tools")

if [ "${#need[@]}" -gt 0 ]; then
  echo "빠진 도구를 설치해요: ${need[*]}"
  yes | "$SDKMANAGER" --sdk_root="$SDK" "${need[@]}"
  code=${PIPESTATUS[1]}
  if [ "$code" -ne 0 ]; then
    echo "도구 설치에 실패했어요 (종료 코드 $code)"
    exit "$code"
  fi
fi

echo "✅ 안드로이드 도구 준비 완료"
