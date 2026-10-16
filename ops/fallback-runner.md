# 매일 06:40 확인 담당 (Claude 대화용)

예약 작업('왜뜨지 매일 해설 갱신', 매일 05:50 KST)이 실제로 도는지 확인되지 않았어요(시험 작업이 아무 흔적도 남기지 않았어요).
그래서 Claude 대화가 매일 06:40 (한국 시간)에 스스로 깨어나 오늘 분량이 올라와 있는지 보고, 없으면 직접 올려요.
이 파일은 그때 따라 할 순서예요. 해설을 만드는 규칙은 `ops/daily-job.md` 에 있어요.

## 순서

1. **최신 main 가져오기** — `cd /home/claude/why-trending && git fetch origin main && git checkout main && git merge --ff-only origin/main`
   - 폴더가 없거나 깨졌으면 `mcp__claude-code-remote__add_repo`(owner=dodasifamily, repo=why-trending, access=push)로 연결해서 clone 하고 `register_repo_root` 를 호출해요. 도구가 안 보이면 ToolSearch 로 불러와요.
   - git 명령은 한 번에 하나씩 차례로 실행해요 (git 프록시가 동시 작업을 2개까지만 받아요).
   - `TODAY=$(TZ=Asia/Seoul date +%F)`
2. **이미 올라왔는지 보기** — `site/data/today.json` 의 `date` 가 TODAY 이고 카드가 7개 이상이면 이미 올라간 거예요(예약 작업이 했어요). 3번은 건너뛰고 4번으로 가요.
3. **직접 올리기** — 이 대화에서 **직접** 해요(사용자가 시키기 전에는 Agent 를 띄우지 않아요). `ops/daily-job.md` 를 처음부터 끝까지 읽고 그 지침 그대로 따라요. 지침의 핵심만 다시 적으면:
   - 오늘 카드 **8~14개(검사 기준 7~14개, 분야 5곳 이상, 분야당 4개까지)**, 분야마다 하루 1~2개. 최근 14일 해설이 5개 미만인 분야(`node scripts/content.mjs validate` 가 알려줘요)부터 채워요.
   - 소재는 '분야별 큰 소식 훑기'(7개 분야 모두 WebSearch, 서로 다른 매체 수로 점수)로 찾고, **06:40 에는 한국 시간 어제 18시 이후 ~ 오늘 새벽에 끝난 해외 행사·경기·공개**를 꼭 봐요. 오늘·이번 주 예정된 공개·출시·개막도 찾아요.
   - 소재가 괜찮고 기사에 가격·주가·프로모션·논란이 섞여 있을 때는 버리지 말고 그 부분만 빼고 써요.
   - 카드마다 서로 다른 매체 2곳 이상, 모든 문장은 읽은 기사 본문에서 확인된 것만. 점검 단계에서는 날짜·숫자 문장을 기사를 새로 열어 한 번 더 대조해요.
   - 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 와 `Claude-Session: https://claude.ai/code/session_018cPXAmvqMeMN4nGr9XXJ8g` 두 줄을 붙여요.

   올린 뒤 직접 확인해요:
   - `git fetch origin main` 뒤 'Daily cards for TODAY' 커밋이 origin/main 에 있는지
   - `node scripts/content.mjs validate` 통과 (오늘 카드 7개 이상·분야 5곳 이상)
   - `git show --stat origin/main` 에 `site/data/today.json`, `site/data/terms.json` 두 파일만 있는지
   - 올린 카드의 분야 분포와 '최근 14일 해설이 5개 미만인 분야' 안내(validate 출력)를 봐 두고, 같은 분야가 며칠째 5개 아래면 찰리 님께 한 줄로 알려요.

   작업이 실패하면(오류·시간 초과) 한 번만 다시 해요. 그래도 안 되면 올리지 않고 이유를 찰리 님께 알려요. (앱은 갱신이 2일 넘게 없을 때만 '업데이트가 조금 늦어지고 있어요'를 보여줘서, 하루 빠지는 건 괜찮아요.)
4. **내일을 걸어 두기 (꼭 마지막에 해요)** — `mcp__claude-code-remote__send_later` 로 내일 06:40 KST 에 같은 일을 하라는 메시지를 걸어요. (도구가 안 보이면 ToolSearch 로 불러와요.)
   - at: **오늘(한국 시간) 날짜** + `T21:40:00Z`. 한국 시간 내일 06:40 은 UTC 로 오늘 21:40 이에요. 예: 한국 시간 10월 17일에 걸면 `2026-10-17T21:40:00Z` (= 10월 18일 06:40 KST). 오늘 날짜는 `TZ=Asia/Seoul date +%F`.
   - name: `왜뜨지 해설 갱신 확인 (매일 06:40)`
   - message: `[매일 06:40 KST 해설 갱신 확인] /home/claude/why-trending 의 ops/fallback-runner.md 를 읽고 그 순서대로 해 줘. 폴더가 없으면 add_repo 로 다시 연결해서 clone 해. 끝에는 같은 메시지로 내일 06:40 KST send_later 를 다시 걸어.`
   - 걸고 나서 `list_triggers` 로 보이는지 확인하면 더 좋아요 (출력이 길어서 꼭 필요할 때만).
5. **알리기** — 찰리 님께는 **문제가 있을 때만** `SendUserMessage` 로 한국어 해요체 한두 줄로 알려요. 평소 성공에는 알리지 않아요.
