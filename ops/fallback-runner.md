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
   - 해외 뉴스와 소셜도 같이 봐요(사용자 요청): X 한국 화제(getdaytrends.com/korea)·구글 급상승 미국/일본·틱톡/유튜브 순위는 **단서로만** 쓰고, 소재마다 K(한국 매체 수) + G(해외 매체 수)÷2 + S(소셜·순위 목록 수)로 점수를 매겨 높은 순으로 골라요. 분야 안 첫 카드가 '탑 토픽'(푸시 알림의 대표 키워드)이에요. 한국 매체가 하나도 안 다룬 해외 소식과 기사 없는 소셜 화제는 카드로 만들지 않고 보고에만 적어요. 자세한 규칙은 `ops/daily-job.md` 1-1, 1-2.
   - 유행어·밈 표현도 따로 봐요(사용자 요청, 'L을 가져가' 같은 말): 기사가 거의 없어서 위 점수로는 빠지는 말이 많아요. 캐릿 '요즘 뜨는 밈' 목록·마이크로 트렌드 전광판, Trend A Word 같은 단서에서 후보를 찾고, 해설 매체 2곳(언론사나 트렌드 전문 매체 1곳 이상)과 최근 2주 안 '뜻·유래' 글 3곳 이상이면 카드로 만들어요. 욕설·비하 표현, 유튜버·일반인 이름은 쓰지 않아요. 자세한 규칙과 안전 조건은 `ops/daily-job.md` 1-1, 1-2 '표현·밈 트랙'.
   - 밈·신조어 카드는 글만으로 상황이 안 그려지면 `scene`(이모지 2~4칸 '장면 그림')을 달고, `example` 은 "A: …\nB: …" 말풍선 모양으로 써요. 짤·캡처·기사 사진은 출처를 달아도 쓰지 않아요(출처 표시는 허락이 아니에요). 쓰는 법은 `ops/daily-job.md` 3, 3-1.
   - 소재가 괜찮고 기사에 가격·주가·프로모션·논란이 섞여 있을 때는 버리지 말고 그 부분만 빼고 써요.
   - 분야별 푸시 알림이 07:07(7시)·08:07·09:07 에 '오늘 카드'를 읽어 가요. 07:32 까지 못 올리면 7시 알림은 그날 건너뛰고, 08:07·09:07 알림이 그 해설을 보내요. 그러니 확인(출처 대조)은 줄이지 말고, 군더더기만 줄여 서둘러요.
   - 카드마다 서로 다른 매체 2곳 이상, 모든 문장은 읽은 기사 본문에서 확인된 것만. 점검 단계에서는 날짜·숫자 문장을 기사를 새로 열어 한 번 더 대조해요.
   - 커밋 메시지 끝에 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` 와 `Claude-Session: https://claude.ai/code/session_018cPXAmvqMeMN4nGr9XXJ8g` 두 줄을 붙여요.

   올린 뒤 직접 확인해요:
   - `git fetch origin main` 뒤 'Daily cards for TODAY' 커밋이 origin/main 에 있는지
   - `node scripts/content.mjs validate` 통과 (오늘 카드 7개 이상·분야 5곳 이상)
   - `git show --stat origin/main` 에 `site/data/today.json`, `site/data/terms.json` 두 파일만 있는지
   - 올린 카드의 분야 분포와 '최근 14일 해설이 5개 미만인 분야' 안내(validate 출력)를 봐 두고, 같은 분야가 며칠째 5개 아래면 찰리 님께 한 줄로 알려요.
   - (선택) 사이트에 반영됐는지 볼 때는 `gh run list --repo dodasifamily/why-trending --workflow pages.yml --limit 2` 로 배포가 성공(보통 2~3분)했는지 본 다음, `https://dodasifamily.github.io/why-trending/data/today.json?cb=<아무 숫자>` 를 WebFetch 로 열어요. **주소 뒤에 `?cb=숫자` 를 꼭 붙여요.** 안 붙이면 WebFetch 가 예전 내용(몇 시간 전 것)을 돌려줘서 배포가 안 된 것처럼 보여요. 큰 파일(`recent.json`)은 앞쪽 4만 6천 자쯤까지만 보여서 카드 맨 끝 몇 개는 안 보일 수 있어요(배포 실패가 아니에요).

   작업이 실패하면(오류·시간 초과) 한 번만 다시 해요. 그래도 안 되면 올리지 않고 이유를 찰리 님께 알려요. (앱은 갱신이 2일 넘게 없을 때만 '업데이트가 조금 늦어지고 있어요'를 보여줘서, 하루 빠지는 건 괜찮아요.)
4. **내일을 걸어 두기 (꼭 마지막에 해요)** — `mcp__claude-code-remote__send_later` 로 내일 06:40 KST 에 같은 일을 하라는 메시지를 걸어요. (도구가 안 보이면 ToolSearch 로 불러와요.)
   - at: **오늘(한국 시간) 날짜** + `T21:40:00Z`. 한국 시간 내일 06:40 은 UTC 로 오늘 21:40 이에요. 예: 한국 시간 10월 17일에 걸면 `2026-10-17T21:40:00Z` (= 10월 18일 06:40 KST). 오늘 날짜는 `TZ=Asia/Seoul date +%F`.
   - name: `왜뜨지 해설 갱신 확인 (매일 06:40)`
   - message: `[매일 06:40 KST 해설 갱신 확인] /home/claude/why-trending 의 ops/fallback-runner.md 를 읽고 그 순서대로 해 줘. 폴더가 없으면 add_repo 로 다시 연결해서 clone 해. 끝에는 같은 메시지로 내일 06:40 KST send_later 를 다시 걸어.`
   - 걸고 나서 `list_triggers` 로 보이는지 확인하면 더 좋아요 (출력이 길어서 꼭 필요할 때만).
5. **알리기** — 찰리 님께는 **문제가 있을 때만** `SendUserMessage` 로 한국어 해요체 한두 줄로 알려요. 평소 성공에는 알리지 않아요.
