# 매일 06:40 확인 담당 (Claude 대화용)

예약 작업('왜뜨지 매일 해설 갱신', 매일 05:50 KST)이 실제로 도는지 확인되지 않았어요(시험 작업이 아무 흔적도 남기지 않았어요).
그래서 Claude 대화가 매일 06:40 (한국 시간)에 스스로 깨어나 오늘 분량이 올라와 있는지 보고, 없으면 직접 올려요.
이 파일은 그때 따라 할 순서예요. 해설을 만드는 규칙은 `ops/daily-job.md` 에 있어요.

## 순서

1. **최신 main 가져오기** — `cd /home/claude/why-trending && git fetch origin main && git checkout main && git merge --ff-only origin/main`
   - 폴더가 없거나 깨졌으면 `mcp__claude-code-remote__add_repo`(owner=dodasifamily, repo=why-trending, access=push)로 연결해서 clone 하고 `register_repo_root` 를 호출해요. 도구가 안 보이면 ToolSearch 로 불러와요.
   - git 명령은 한 번에 하나씩 차례로 실행해요 (git 프록시가 동시 작업을 2개까지만 받아요).
   - `TODAY=$(TZ=Asia/Seoul date +%F)`
2. **이미 올라왔는지 보기** — `site/data/today.json` 의 `date` 가 TODAY 이고 카드가 3개 이상이면 이미 올라간 거예요(예약 작업이 했어요). 3번은 건너뛰고 4번으로 가요.
3. **직접 올리기** — `Agent`(general-purpose) 한 명에게 맡겨서 이 대화의 맥락을 아껴요. 이렇게 시켜요:
   > "/home/claude/why-trending 에서 ops/daily-job.md 를 읽고 그 지침 그대로 오늘(한국 시간 TODAY) 분량을 만들어 main 에 올려라. 질문하지 말고 끝까지 해라. 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 와 `Claude-Session: https://claude.ai/code/session_018cPXAmvqMeMN4nGr9XXJ8g` 두 줄을 붙여라. 마지막 보고: 올린 keyword 들과 group, 영상을 넣은 카드, 커밋 해시, 버린 후보와 이유."

   끝나면 내가 직접 확인해요:
   - `git fetch origin main` 뒤 'Daily cards for TODAY' 커밋이 origin/main 에 있는지
   - `node scripts/content.mjs validate` 통과
   - `git show --stat origin/main` 에 `site/data/today.json`, `site/data/terms.json` 두 파일만 있는지
   - 새 카드 1~2개를 골라 출처 기사와 대조 (WebFetch). 틀린 사실이 있으면 그 카드를 빼고 다시 올려요.

   Agent 가 실패하면(오류·시간 초과) 한 번만 다시 시켜요. 그래도 안 되면 올리지 않고 이유를 찰리 님께 알려요. (앱은 갱신이 2일 넘게 없을 때만 '업데이트가 조금 늦어지고 있어요'를 보여줘서, 하루 빠지는 건 괜찮아요.)
4. **내일을 걸어 두기 (꼭 마지막에 해요)** — `mcp__claude-code-remote__send_later` 로 내일 06:40 KST 에 같은 일을 하라는 메시지를 걸어요. (도구가 안 보이면 ToolSearch 로 불러와요.)
   - at: **오늘(한국 시간) 날짜** + `T21:40:00Z`. 한국 시간 내일 06:40 은 UTC 로 오늘 21:40 이에요. 예: 한국 시간 10월 17일에 걸면 `2026-10-17T21:40:00Z` (= 10월 18일 06:40 KST). 오늘 날짜는 `TZ=Asia/Seoul date +%F`.
   - name: `왜뜨지 해설 갱신 확인 (매일 06:40)`
   - message: `[매일 06:40 KST 해설 갱신 확인] /home/claude/why-trending 의 ops/fallback-runner.md 를 읽고 그 순서대로 해 줘. 폴더가 없으면 add_repo 로 다시 연결해서 clone 해. 끝에는 같은 메시지로 내일 06:40 KST send_later 를 다시 걸어.`
   - 걸고 나서 `list_triggers` 로 보이는지 확인하면 더 좋아요 (출력이 길어서 꼭 필요할 때만).
5. **알리기** — 찰리 님께는 **문제가 있을 때만** `SendUserMessage` 로 한국어 해요체 한두 줄로 알려요. 평소 성공에는 알리지 않아요.
