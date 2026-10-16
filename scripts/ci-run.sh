#!/usr/bin/env bash
# 사용법: scripts/ci-run.sh "단계 이름" -- 명령 [인자...]
# 명령을 그대로 실행하고, 실패하면 (Gradle 이면 '무엇이 잘못됐나' 부분과) 마지막 60줄을 GitHub 의 '오류 알림'으로 남겨요.
# (전체 로그를 열지 않아도 실패 원인을 바로 볼 수 있어요)
name="$1"
shift
[ "$1" = "--" ] && shift

log="$(mktemp)"
set -o pipefail
"$@" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}

if [ "$code" -ne 0 ]; then
  # 알림은 4000자쯤에서 잘려요. 그래서 Gradle 의 '무엇이 잘못됐나' 부분을 맨 앞에 두고, 그 뒤에 로그 끝부분을 붙여요.
  msg="$(python3 - "$log" <<'PY'
import sys
t = open(sys.argv[1], encoding="utf-8", errors="replace").read().replace("\r", "")
lines = t.split("\n")
head = ""
for i, l in enumerate(lines):
    if l.startswith("* What went wrong:"):
        head = "\n".join(lines[i:i + 8]).strip() + "\n--- 로그 끝부분 ---\n"
        break
msg = (head + "\n".join(lines[-60:]))[:3900]
print(msg.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
PY
)"
  echo "::error title=${name} 실패 (종료 코드 ${code})::${msg}"
fi
exit "$code"
