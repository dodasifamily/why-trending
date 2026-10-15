#!/usr/bin/env bash
# 사용법: scripts/ci-run.sh "단계 이름" -- 명령 [인자...]
# 명령을 그대로 실행하고, 실패하면 마지막 60줄을 GitHub 의 '오류 알림'으로 남겨요.
# (전체 로그를 열지 않아도 실패 원인을 바로 볼 수 있어요)
name="$1"
shift
[ "$1" = "--" ] && shift

log="$(mktemp)"
set -o pipefail
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}

if [ "$code" -ne 0 ]; then
  msg="$(tail -n 60 "$log" | sed 's/\r$//' | python3 -c '
import sys
t = sys.stdin.read()
print(t.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
')"
  echo "::error title=${name} 실패 (종료 코드 ${code})::${msg}"
fi
exit "$code"
