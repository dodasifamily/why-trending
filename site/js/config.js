// 앱 설정. 공개 저장소에 올라가므로 비밀 값은 절대 넣지 않아요.
window.WT_CONFIG = {
  appVersion: '0.4.2',

  // 공유 링크와 앱의 최신 해설을 받아오는 주소 (GitHub Pages)
  siteUrl: 'https://dodasifamily.github.io/why-trending/',
  remoteBase: 'https://dodasifamily.github.io/why-trending/',

  // 광고 (안드로이드 앱에서만 보여요)
  ads: {
    // 2026-10-20: AdMob 에서 만든 실제 배너 광고 단위 ID 로 바꿨어요. 개발·시험 중 내 기기에서 광고를 누르지 않도록 주의해요(AdMob 정책).
    test: false,
    bannerAdId: 'ca-app-pub-5198471293233425/2821677755'
  },

  // 해설 화면의 영상. 눌러서 그 자리에서 재생해요(웹·앱 모두).
  // inlineInApp: 안드로이드 앱 안에서 그 자리 재생을 켤지. 유튜브가 앱 안 재생을 막는 기기에서는
  // 오류를 알려주면 그 기기에서만 자동으로 유튜브 앱·브라우저로 열도록 바뀌어요. 끄려면 false.
  media: {
    inlineInApp: true
  },

  // '내용이 이상해요' 접수 방법. 위에서부터 먼저 채워진 것을 써요.
  //  1) endpoint: 구글 폼 등의 접수 주소 (fields 에 폼 칸 이름을 적어요)
  //  2) email: 누르면 메일 앱이 열려요 (신고 내용이 미리 적혀 있어요)
  //  둘 다 비어 있으면 '준비 중' 안내만 보여요.
  report: {
    endpoint: '',
    fields: { id: '', keyword: '', note: '' },
    email: 'issuewhyhelp@gmail.com'
  }
};
