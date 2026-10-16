# 왜뜨지? (why-trending)

요즘 뜨는 밈·신조어가 **왜 뜨는지**를 출처와 함께 30초로 설명해 주는 앱이에요. 안드로이드 앱과 웹 화면이 같은 코드를 써요.

> 해설은 AI가 여러 출처를 확인해 정리한 요약이에요. 틀릴 수 있어서 모든 해설에 출처 링크를 달고, 앱 안에 '내용이 이상해요' 신고 버튼을 두었어요.

## 폴더

| 폴더 | 내용 |
| --- | --- |
| `site/` | 화면(HTML·CSS·JS)과 매일 바뀌는 해설 데이터(`site/data/`). GitHub Pages로 올라가요. |
| `app/` | 안드로이드 앱 껍데기(Capacitor) 설정. 빌드할 때 `site/`를 복사해 넣어요. |
| `scripts/` | 해설 데이터 검사·합치기 도구(`content.mjs`), 분야별 알림 보내기(`push.mjs`), 아이콘 생성기 등 |
| `.github/workflows/` | 자동 빌드(`android.yml`), 사이트 배포(`pages.yml`), 분야별 알림 보내기(`push.yml`) |
| `ops/` | 매일 해설을 갱신하는 담당이 읽는 지침(`daily-job.md`, `fallback-runner.md`). 사이트·앱에는 올라가지 않아요. |

## 해설 데이터 규칙

- 모든 카드는 **서로 다른 매체 2곳 이상**의 출처가 있어야 해요.
- 다루는 분야 7개: 밈·신조어, 연예·음악, 드라마·영화·웹툰, 스포츠, 게임, 소비·먹거리, IT·테크 (아래 '분야' 참고)
- 다루지 않는 것: 정치, 사건사고, 재판 중인 개인, 실명 의혹, 사망 소식
- `node scripts/content.mjs validate` 로 규칙을 검사해요. 어기면 사이트와 앱이 올라가지 않아요.

### 분야 (내 분야 고르기)

- 사용자는 처음 실행할 때 관심 분야를 고르고(여러 개), 오늘 화면에는 고른 분야마다 한 묶음씩 나와요. 한 묶음은 **오늘 + 최근 2주(14일)의 해설을 최신 순으로 최대 7개**예요(가장 최근 것은 큰 카드, 나머지는 날짜가 붙은 작은 카드). 선택은 그 기기 안에만 저장돼요(`localStorage` 의 `wt.cats`). 오늘 화면 위쪽 '바꾸기'나 알림 탭의 '분야 바꾸기'로 언제든 바꿀 수 있어요. 오늘 해설이 없는 날에도 지난 해설이 그대로 보여서, 분야를 골라도 비어 보이지 않아요.
- 분야 목록(id·이름·설명·아이콘 이름·색)은 `site/data/categories.json` **하나만** 기준이에요. 앱 화면과 `scripts/content.mjs` 검사가 같은 파일을 읽어요. 카드의 `group` 은 여기에 있는 `id` 여야 해요 (meme · ent · screen · sports · game · shop · tech).
- 분야를 더하려면 `categories.json` 에 항목을 넣고, 새 아이콘이면 `site/js/app.js` 의 `ICONS` 에 같은 이름의 그림을 더해요. (이름이 없으면 기본 그림이 나와요.)
- 하루 카드는 7~14개(목표 9~11개), 서로 다른 분야 5곳 이상, 한 분야 최대 4개예요 (`validate` 가 강제해요). 분야마다 하루 1~2개가 목표예요. 분야마다 최근 14일 해설이 5개 이상 있어야 앱에서 5~7개가 보여서, 5개 미만인 분야는 `validate` 가 알려줘요.
- `site/data/recent.json`(최근 14일 해설, 분야마다 최대 7개)은 사전(`terms.json`)에서 **올릴 때마다 만들어지는 파일**이에요(`node scripts/content.mjs recent`, `pages.yml`·`android.yml` 이 실행). 저장소에는 올리지 않아요(`.gitignore`). 앱은 오늘 해설(`today.json`)과 이 파일을 합쳐 분야별 목록을 만들어요.
- 후보 카드를 미리 검사하려면 `node scripts/content.mjs check <파일.json>`, 최근 14일 안의 지난 화제를 사전에만 더하려면 `node scripts/content.mjs add <파일.json>` 을 써요(자세한 규칙은 `ops/daily-job.md`).

### 분야별 알림 (푸시)

- 알림을 켜면 앱이 **고른 분야**(`cat_meme`, `cat_sports` …)와 **받는 시각**(`h7`·`h8`·`h9`)을 FCM 주제로 구독해요. 끄면 구독을 모두 풀고 이 기기의 알림 등록도 지워요(`deleteToken`). 알림을 켜기 전에는 앱이 기기 등록을 요청하지 않아요(매니페스트의 `firebase_messaging_auto_init_enabled=false`. 한 번 켠 뒤에는 플러그인의 `getToken()` 이 자동 등록을 다시 켜서, 끈 뒤에도 Google 서비스가 등록 값을 다시 만들 수 있어요. 주제 구독이 없으니 알림은 오지 않아요). 앱 쪽 코드는 `site/js/app.js` 의 `syncPush()`·`wantedTopics()` 예요.
- 보내는 쪽은 `scripts/push.mjs`(`push.yml`)예요. 오늘 해설이 있는 분야마다 "그 분야 **그리고** 그 시각" 조건(`'cat_sports' in topics && 'h8' in topics`)으로 한 번씩 보내요. 오늘 해설이 아직 안 올라왔으면 최대 25분 기다리고, 그래도 없으면 보내지 않아요(지난 해설로 '새 해설' 알림을 보내지 않아요). 알림을 누르면 그 분야의 첫 해설(`#/t/<id>`)이 열려요.
- **켜지는 조건**: GitHub Secrets 에 Firebase 설정이 있어야 해요. 없으면 앱은 지금처럼 기기 안 알림(매일 같은 글)만 쓰고, `push.yml` 은 아무것도 보내지 않고 끝나요.
  - `GOOGLE_SERVICES_JSON`: Firebase 콘솔에서 안드로이드 앱(패키지 이름 `io.github.dodasifamily.issuewhy`)을 등록하고 받은 `google-services.json` 의 내용 전체. 앱을 만들 때(`android.yml` → `app/scripts/prepare-fcm.mjs`) 써요. 패키지 이름이 다르면 빌드가 이유를 알려 주며 멈춰요.
  - `FCM_SERVICE_ACCOUNT_JSON`: Firebase 프로젝트 설정 → 서비스 계정 → '새 비공개 키 생성'으로 받은 JSON 의 내용 전체. 알림을 보낼 때(`push.yml`) 써요. **비밀 키예요.** 채팅·이슈·저장소에 올리지 말고 Secrets 에만 넣어요.
- 직접 해 보기: Actions 탭 → '분야별 알림 보내기' → Run workflow. 처음에는 '보내지 않고 내용만 보기'를 `true` 로 두고 로그에서 보낼 내용을 확인해요.
- 개인정보: 알림을 켜면 Google(Firebase Cloud Messaging)이 기기의 알림 등록 값·설치 ID·IP 등을 처리해요. 운영자는 이 값을 받지 않아요. 개인정보처리방침 6번에 적어 두었어요. 구글 플레이 '데이터 보안' 양식에는 '기기 또는 기타 ID'(앱 기능 목적, 알림을 켠 경우에만)를 적어야 해요. 양식을 쓸 때 구글 안내를 다시 확인해요.

### 사진·영상 (`media`)

- 해설 화면 위쪽에 영상 미리보기가 나오고, 영상이 없는 해설에는 분야별 그림 카드가 나와요.
- **기사 사진은 쓰지 않아요.** 저작권이 매체에 있어서예요. 위키미디어 등 자유 이용 사진도 라이선스를 기계로 확인할 수 없어서 넣지 않아요.
- 영상은 카드의 `sources` 로 단 **기사 페이지가 직접 싣고 있는 유튜브 영상**만 허용해요. 형식은 `"media": [{"type":"video","provider":"youtube","id":"<11글자>","from":"<sources 에 있는 그 기사 주소>"}]` 이고, 영상은 카드당 1개예요.
- `from` 의 주소는 `scripts/content.mjs` 의 `VIDEO_FROM_HOSTS` (YTN·연합뉴스·연합뉴스TV·SBS·MBC·KBS·JTBC) 에 있어야 하고, 검사(`validate`)가 이걸 확인해요. 기사에서 영상 번호를 확실히 확인하지 못했다면 `media` 를 빼요.
- 영상은 웹·앱 모두 그 자리에서 재생해요. 유튜브는 플레이어를 넣은 쪽이 누구인지 Referer 로 알려주길 요구하고 앱이면 앱 ID 여야 해서, `app/capacitor.config.json` 의 `server.hostname` 을 앱 ID 와 같게 두었어요(앱 화면 주소가 `https://<앱 ID>/` 가 돼요). **패키지 이름(appId)을 바꾸면 hostname 도 같이 바꿔요.** 빌드(`scripts/ci-apk-check.sh`)가 이 둘이 같은지 확인해요.
- 앱 안에서 재생이 막히면(유튜브가 오류 2·5·153 을 알려줄 때) 그 기기는 기억해 두었다가 다음부터 곧바로 유튜브 앱·브라우저로 열어요. 앱 화면은 전체 화면 전환을 지원하지 않아서 전체 화면 버튼은 숨겨요. 그 자리 재생을 끄려면 `site/js/config.js` 의 `media.inlineInApp` 을 `false` 로 바꿔요.

## 어떻게 돌아가나요 (운영 메모)

| 무엇 | 언제 | 하는 일 |
| --- | --- | --- |
| 해설 갱신 (예약 작업 '왜뜨지 매일 해설 갱신') | 매일 05:50 (한국 시간) | 오늘 화제를 찾아 기사로 확인하고 `site/data/` 의 두 파일(`today.json`, `terms.json`)만 고쳐 올려요 |
| 해설 갱신 확인 (Claude 대화) | 매일 06:40 (한국 시간) | 예약 작업이 실제로 도는지 확인되지 않아서, 대화가 직접 확인하고 오늘 분량이 없으면 `ops/daily-job.md` 대로 올려요 (`ops/fallback-runner.md`) |
| 사이트 올리기 (`pages.yml`) | `site/` 가 바뀔 때, 매일 06:30 | 해설 검사 → 최근 14일 목록(`recent.json`) 만들기 → GitHub Pages 에 웹 화면과 최신 해설을 올려요. 앱도 여기서 최신 해설을 받아가요 |
| 앱 만들기 (`android.yml`) | 화면·앱 설정이 바뀔 때 (해설 데이터만 바뀔 때는 안 돌아요) | 시험용 APK 를 만들어 릴리스 `test-latest` 에 올려요. 서명 키를 등록하면 출시용 AAB 도 만들어요. Firebase 설정을 등록해 두었다면 푸시 알림도 켜서 만들어요 |
| 분야별 알림 보내기 (`push.yml`) | 매일 07:07·08:07·09:07 (한국 시간) | 오늘 해설이 있는 분야마다, 그 분야와 그 시각을 고른 기기에만 푸시 알림을 보내요. Firebase 키가 없으면 아무것도 안 하고 끝나요 |

- 시험용 앱(폰에서 바로 설치): https://github.com/dodasifamily/why-trending/releases/download/test-latest/whyttuji-test.apk
- 시험용 앱의 서명 키(디버그 키) 파일은 Actions 캐시(`debug-keystore-v2`)에 두고 계속 같은 키로 서명해요 (`app/scripts/patch-android.mjs` 가 Gradle 에 그 경로를 알려줘요). 그래서 새 시험용 앱을 폰에 **덮어 설치**할 수 있어요. 캐시가 7일 넘게 안 쓰여 지워지면 키가 바뀌어서, 그때는 한 번 앱을 지우고 다시 설치해야 해요. 이 키는 비밀 키가 아니고 출시에는 쓰지 않아요 (출시용 키는 GitHub Secrets 에만 둬요).
- 앱의 영구 ID(패키지 이름): `io.github.dodasifamily.issuewhy` (2026-10-16 확정, `app/capacitor.config.json` 의 `appId` 와 `server.hostname`). 구글 플레이에 처음 올리면 바꿀 수 없어요. 문의 이메일은 `issuewhyhelp@gmail.com` (`site/js/config.js` 의 `report.email`, 개인정보처리방침).
- GitHub Pages 는 켜져 있어요 (Source = GitHub Actions). 사이트 주소: https://dodasifamily.github.io/why-trending/
- 출시용 서명 키: Settings → Secrets and variables → Actions 에 `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` 를 등록해요.
- 광고: `site/js/config.js` 의 `ads` 와 `app/app.config.json` 의 AdMob 앱 ID 는 지금 구글 테스트 값이에요. 출시 전에 실제 값으로 바꿔요.
- '내용이 이상해요' 신고: `site/js/config.js` 의 `report.endpoint`(폼) 또는 `report.email`(메일)을 채우면 켜져요.

## 비밀 정보

비밀번호·서명 키·API 키는 이 저장소에 올리지 않아요 (`.gitignore`로 막아 두었어요. `google-services.json` 도 포함해요). 필요한 값은 GitHub Secrets에만 넣어요: 출시용 서명(`KEYSTORE_BASE64` 등), Firebase(`GOOGLE_SERVICES_JSON`, `FCM_SERVICE_ACCOUNT_JSON`).
