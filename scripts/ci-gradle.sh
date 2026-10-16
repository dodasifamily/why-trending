#!/usr/bin/env bash
# Gradle 로 앱 파일을 만들어요. (app/android 폴더에서 실행해요: ../../scripts/ci-gradle.sh [작업 이름])
# 작업 이름을 안 주면 시험용 APK(assembleDebug)를, 출시용 AAB 는 bundleRelease 를 줘요.
# 구글·메이븐 부품(라이브러리) 서버가 잠깐 안 될 때 생기는 실패에만, 잠시 기다렸다가 한 번 더 시도해요.
# 우리 코드의 오류(컴파일 실패 등)는 다시 시도하지 않고 바로 실패로 알려요.
set -uo pipefail

task="${1:-assembleDebug}"
log="$(mktemp)"
run() {
  ./gradlew "$task" --no-daemon --stacktrace "$@" 2>&1 | tee "$log"
  return "${PIPESTATUS[0]}"
}

run
code=$?

# 부품을 받지 못했을 때 나오는 말들 (서버 오류·시간 초과·연결 끊김·'찾을 수 없음')
net='Could not (resolve|find|GET|HEAD|download)|Received status code (429|5[0-9][0-9])|Read timed out|Connection (reset|timed out|refused)|Remote host terminated|Premature end of Content-Length|SSLHandshakeException|Unable to tunnel|UnknownHostException|Network is unreachable|Could not install Gradle distribution'
if [ "$code" -ne 0 ] && grep -Eqi "$net" "$log"; then
  echo "::warning title=APK 빌드를 한 번 더 시도해요::부품(라이브러리) 서버에서 받는 데 실패한 것 같아요. 잠시 뒤 한 번만 더 시도해요. (우리 코드 문제가 아니면 이번엔 통과해요)"
  sleep "${RETRY_DELAY:-30}"
  # 못 찾았다는 결과를 Gradle 이 잠시 기억해 두기 때문에, 다시 받아 오도록 해요
  run --refresh-dependencies
  code=$?
fi
exit "$code"
