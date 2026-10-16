# 왜뜨지? (why-trending)

요즘 뜨는 밈·신조어가 **왜 뜨는지**를 출처와 함께 30초로 설명해 주는 앱이에요. 안드로이드 앱과 웹 화면이 같은 코드를 써요.

> 해설은 AI가 여러 출처를 확인해 정리한 요약이에요. 틀릴 수 있어서 모든 해설에 출처 링크를 달고, 앱 안에 '내용이 이상해요' 신고 버튼을 두었어요.

## 폴더

| 폴더 | 내용 |
| --- | --- |
| `site/` | 화면(HTML·CSS·JS)과 매일 바뀌는 해설 데이터(`site/data/`). GitHub Pages로 올라가요. |
| `app/` | 안드로이드 앱 껍데기(Capacitor) 설정. 빌드할 때 `site/`를 복사해 넣어요. |
| `scripts/` | 해설 데이터 검사·합치기 도구(`content.mjs`), 아이콘 생성기 등 |
| `.github/workflows/` | 자동 빌드(`android.yml`)와 사이트 배포(`pages.yml`) |

## 해설 데이터 규칙

- 모든 카드는 **서로 다른 매체 2곳 이상**의 출처가 있어야 해요.
- 다루는 분야: 밈·신조어, 문화·연예, 스포츠, 경제·제품 트렌드
- 다루지 않는 것: 정치, 사건사고, 재판 중인 개인, 실명 의혹, 사망 소식
- `node scripts/content.mjs validate` 로 규칙을 검사해요. 어기면 사이트와 앱이 올라가지 않아요.

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
| 사이트 올리기 (`pages.yml`) | `site/` 가 바뀔 때 | GitHub Pages 에 웹 화면과 최신 해설을 올려요. 앱도 여기서 최신 해설을 받아가요 |
| 앱 만들기 (`android.yml`) | 화면·앱 설정이 바뀔 때 (해설 데이터만 바뀔 때는 안 돌아요) | 시험용 APK 를 만들어 릴리스 `test-latest` 에 올려요. 서명 키를 등록하면 출시용 AAB 도 만들어요 |

- 시험용 앱(폰에서 바로 설치): https://github.com/dodasifamily/why-trending/releases/download/test-latest/whyttuji-test.apk
- 처음 한 번만: 저장소 Settings → Pages → Source 를 `GitHub Actions` 로 바꿔요.
- 출시용 서명 키: Settings → Secrets and variables → Actions 에 `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` 를 등록해요.
- 광고: `site/js/config.js` 의 `ads` 와 `app/app.config.json` 의 AdMob 앱 ID 는 지금 구글 테스트 값이에요. 출시 전에 실제 값으로 바꿔요.
- '내용이 이상해요' 신고: `site/js/config.js` 의 `report.endpoint`(폼) 또는 `report.email`(메일)을 채우면 켜져요.

## 비밀 정보

비밀번호·서명 키·API 키는 이 저장소에 올리지 않아요 (`.gitignore`로 막아 두었어요). 필요한 값은 GitHub Secrets에만 넣어요.
