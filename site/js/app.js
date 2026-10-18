/* 왜이슈 – 화면과 동작 (프레임워크 없이 작성) */
(() => {
  'use strict';

  const CFG = window.WT_CONFIG || {};
  const Cap = window.Capacitor;
  const NATIVE = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());

  /** 안드로이드 앱에서만 쓰는 플러그인 (웹에서는 null) */
  function plugin(name) {
    if (!NATIVE || !Cap) return null;
    return (Cap.Plugins && Cap.Plugins[name]) || (typeof Cap.registerPlugin === 'function' ? Cap.registerPlugin(name) : null);
  }

  // ---------- 저장소 (이 기기 안에만 저장돼요) ----------
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('wt.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    /** maxChars 보다 큰 값은 저장하지 않아요 (큰 데이터가 저장 공간을 다 차지해서 내 분야·알림 같은 설정이 저장 안 되는 일을 막아요) */
    set(key, value, maxChars) {
      try {
        const text = JSON.stringify(value);
        if (maxChars && text.length > maxChars) return;
        localStorage.setItem('wt.' + key, text);
      } catch (e) {
        /* 저장할 수 없어도 앱은 계속 동작해요 */
      }
    }
  };
  const CACHE_MAX_CHARS = 300000; // 받아 둔 해설 파일 하나당 저장 한도. 지난 이슈 보관함(archive.json)처럼 계속 커지는 파일이 이 한도를 넘으면 저장하지 않고, 앱에 들어 있는 사본·인터넷으로 대신해요

  // ---------- 상태 ----------
  // 분야 목록(이름·색·아이콘)은 data/categories.json 하나만 기준이에요. 거기서 고치면 앱을 새로 만들지 않아도 바뀌어요.
  const HOURS = [7, 8, 9];
  const AI_NOTE = 'AI가 출처를 확인해 정리한 요약이에요. 틀릴 수 있으니 내용이 이상하면 해설 화면에서 알려주세요.';

  const S = {
    today: null,
    terms: null,
    todayState: 'loading', // loading | ok | error
    termsState: 'idle', // idle | loading | ok | error
    q: '',
    groups: null, // 분야 목록 (categories.json 의 groups)
    groupsState: 'loading', // loading | ok | error
    cats: cleanCats(store.get('cats', null)), // 내가 고른 분야 id 목록. null 이면 아직 고르지 않은 거예요(첫 실행)
    rev: 0, // 지금 받은 분야 목록의 구성 번호 (categories.json 의 revision)
    revNotice: false, // 분야 구성이 새로 바뀐 직후 한 번, 옛 선택을 새 분야로 옮겼다고 알리고 다시 고르게 해요
    recent: null, // 최근 3일 해설 (recent.json)
    archive: null, // 지난 이슈 보관함 (archive.json). 3일보다 긴 기간을 보여줘야 할 때만 받아 와요
    archiveState: 'idle', // idle | loading | ok | error
    shown: {}, // 목록마다 지금까지 펼친 개수 ('더 보기'). 보던 목록으로 돌아와도 같은 길이로 그려요
    dictGroup: 'all', // 검색 화면에서 보고 있는 분야 ('all' = 전체)
    alertOn: store.get('alertOn', false) === true,
    hour: HOURS.includes(store.get('hour', 8)) ? store.get('hour', 8) : 8,
    alertMsg: '',
    alertBusy: 0, // 푸시 구독을 맞추는 중인 작업 수 (인터넷이 느릴 때 '설정하는 중' 표시용)
    reported: store.get('reported', {}),
    reportState: {},
    lastLoad: 0
  };

  function cleanCats(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : null;
  }

  // ---------- 작은 도구 ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const view = $('#view');

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach((c) => append(node, c));
      return;
    }
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }

  /** 요소 만들기: h('div', {class: 'a', onclick: fn}, 자식...) – 글자는 항상 textContent 로 들어가서 안전해요 */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      }
    }
    children.forEach((c) => append(el, c));
    return el;
  }

  const ICONS = {
    right: '<path d="M9 5l7 7-7 7"></path>',
    left: '<path d="M15 5l-7 7 7 7"></path>',
    share: '<path d="M12 3v12M7 8l5-5 5 5"></path><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"></path>',
    flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"></path>',
    search: '<circle cx="11" cy="11" r="6.5"></circle><path d="M20 20l-4-4"></path>',
    info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7.5v.01"></path>',
    out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"></path>',
    // 분야별 그림 카드에 쓰는 큰 아이콘
    // (이름은 categories.json 의 icon 과 같아요)
    meme: '<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"></path><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"></path>',
    ent: '<path d="M9 18V6.5l10-2V16"></path><circle cx="6.5" cy="18" r="2.5"></circle><circle cx="16.5" cy="16" r="2.5"></circle>',
    screen: '<rect x="3" y="4.5" width="18" height="12.5" rx="2.5"></rect><path d="M10.2 8.3v5.4l4.6-2.7z"></path><path d="M8 20.5h8M12 17v3.5"></path>',
    sports: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"></path><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3"></path><path d="M12 13v4M9 20h6M10 17h4"></path>',
    game: '<path d="M7 7h10a4.5 4.5 0 0 1 4.4 5.4l-.8 4a2.6 2.6 0 0 1-4.6.9L14.6 15H9.4l-1.4 2.3a2.6 2.6 0 0 1-4.6-.9l-.8-4A4.5 4.5 0 0 1 7 7z"></path><path d="M8 10v3M6.5 11.5h3"></path><path d="M15.5 10.5h.01M17.5 12.5h.01"></path>',
    shop: '<path d="M5.5 8h13l1 12h-15z"></path><path d="M9 8V7a3 3 0 0 1 6 0v1"></path>',
    tech: '<rect x="7" y="7" width="10" height="10" rx="2"></rect><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"></path>',
    econ: '<path d="M4 20h16M6.5 20v-5M11 20v-8M15.5 20v-11"></path><path d="M5 9.5l4-3.5 3 2 6.5-4.5"></path><path d="M15 3.5h3.5V7"></path>',
    life: '<path d="M5 9h11v5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"></path><path d="M16 10.5h1.2a2.3 2.3 0 0 1 0 4.6H16"></path><path d="M8.5 3.5v2.2M12 3.5v2.2"></path><path d="M6.5 21h9"></path>',
    world: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3c2.6 2.4 4 5.4 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.4-4-9s1.4-6.6 4-9z"></path>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"></path>'
  };
  function icon(name, size) {
    const s = size || 18;
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('width', s);
    el.setAttribute('height', s);
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '2');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = ICONS[name] || ICONS.meme; // 위에 적어 둔 고정 문자열만 쓰므로 안전해요 (모르는 이름이면 기본 그림)
    return el;
  }

  function setView(nodes, keepScroll) {
    view.removeAttribute('data-card-id');
    view.textContent = '';
    append(view, nodes);
    if (!keepScroll) view.scrollTop = 0;
  }

  let toastTimer = 0;
  function toast(msg) {
    const old = $('.toast');
    if (old) old.remove();
    const el = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2400);
  }

  // ---------- 날짜 ----------
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
  function parseYmd(s) {
    const m = YMD.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function koDate(s) {
    const d = parseYmd(s);
    return d ? `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일` : '';
  }
  function dotDate(s) {
    const m = YMD.exec(s || '');
    return m ? `${m[1]}.${m[2]}.${m[3]}` : '';
  }
  /** 한국 시간 기준 날짜 (해설의 날짜도 한국 시간으로 적어요) */
  function kstYmd(ms) {
    return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  /** 오늘 날짜(한국 시간). 기기 시계가 해설의 최신 날짜보다 뒤처져 있으면 해설의 최신 날짜를 오늘로 봐요 */
  function todayYmd() {
    const now = kstYmd(Date.now());
    const latest = S.today && typeof S.today.date === 'string' && YMD.test(S.today.date) ? S.today.date : '';
    return latest > now ? latest : now;
  }
  function daysApart(a, b) {
    const x = parseYmd(a);
    const y = parseYmd(b);
    return x && y ? Math.round((y - x) / 86400000) : 0;
  }
  /** 'YYYY-MM-DD' 날짜에서 n일 뒤(음수면 앞) 날짜 */
  function addDays(ymd, n) {
    const m = YMD.exec(ymd || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10) : '';
  }

  // ---------- 데이터 불러오기 ----------
  function getJson(url, ms) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms || 8000);
    return fetch(url, { cache: 'no-cache', signal: ctl.signal })
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .finally(() => clearTimeout(timer));
  }
  const okToday = (j) => !!j && j.schema === 1 && Array.isArray(j.cards);
  const okTerms = (j) => !!j && j.schema === 1 && Array.isArray(j.terms);
  const okRecent = (j) => !!j && j.schema === 1 && Array.isArray(j.cards);
  const okGroups = (j) =>
    !!j && j.schema === 1 && Array.isArray(j.groups) && j.groups.length > 0 && j.groups.every((g) => g && typeof g.id === 'string' && typeof g.label === 'string');

  /** 앱: 인터넷의 최신 파일 → 지난번에 받아 둔 파일 → 앱에 들어 있는 사본 순서. 웹: 같은 주소의 파일 */
  function loadFile(file, cacheKey, ok) {
    const first = NATIVE && CFG.remoteBase ? CFG.remoteBase + 'data/' + file : 'data/' + file;
    return getJson(first)
      .then((j) => {
        if (!ok(j)) throw new Error('bad data');
        store.set(cacheKey, j, CACHE_MAX_CHARS);
        return j;
      })
      .catch(() => {
        const cached = store.get(cacheKey, null);
        if (cached && ok(cached)) return cached;
        if (NATIVE) {
          return getJson('data/' + file).then((j) => {
            if (!ok(j)) throw new Error('bad data');
            return j;
          });
        }
        throw new Error('no data');
      });
  }

  /** 오늘 해설·분야 목록·최근 3일 해설을 한꺼번에 새로 받아요. 하나가 안 와도 나머지는 그대로 써요 */
  function refreshData(showLoading) {
    if (showLoading && !S.today) {
      S.todayState = 'loading';
      route();
    }
    const hadGroups = !!S.groups;
    const jobs = [
      loadFile('today.json', 'cache.today', okToday)
        .then((j) => {
          S.today = j;
          S.todayState = 'ok';
          S.lastLoad = Date.now();
        })
        .catch(() => {
          if (!S.today) S.todayState = 'error';
        }),
      loadFile('categories.json', 'cache.cats', okGroups)
        .then((j) => {
          S.groups = j.groups;
          S.groupsState = 'ok';
          applyRevision(j);
        })
        .catch(() => {
          if (!S.groups) S.groupsState = 'error'; // 분야를 못 받으면 분야 걸러내기 없이 전부 보여줘요
        }),
      loadFile('recent.json', 'cache.recent', okRecent)
        .then((j) => {
          S.recent = j;
        })
        .catch(() => {
          /* 지난 며칠 목록만 안 보일 뿐이에요 */
        })
    ];
    return Promise.all(jobs).then(() => {
      const r = parseRoute().name;
      if (S.archiveState === 'error') S.archiveState = 'idle'; // 지난 이슈를 못 받았었다면 이번 화면에서 다시 받아 봐요
      if (hadGroups && view.querySelector('.pickrow')) return; // 분야를 고르는 중이에요
      if (r === 'today' || r === 'detail') route(true);
      // 검색 화면은 글자를 치는 중이 아닐 때만 다시 그려요 (치는 도중에 화면이 바뀌지 않게)
      else if (r === 'dict') {
        if (!isTypingQuery()) route(true);
      }
      // 분야 목록을 처음 받았을 때만 다시 그려요 (분야를 고르는 중에 화면이 바뀌지 않게)
      else if (!hadGroups && S.groups && (r === 'pick' || r === 'alerts')) route(true);
    });
  }

  function isTypingQuery() {
    const a = document.activeElement;
    return !!(a && a.id === 'termq');
  }

  let termsPromise = null;
  /** 지난 해설 보관함(terms.json)을 한 번만 받아 와요. 최근 3일이 지나 목록에서 빠진 해설을 링크로 열 때만 써요. 여러 화면이 동시에 부탁해도 같은 약속(Promise)을 같이 기다려요 */
  function loadTerms() {
    if (termsPromise) return termsPromise;
    S.termsState = 'loading';
    termsPromise = loadFile('terms.json', 'cache.terms', okTerms)
      .then((j) => {
        S.terms = j;
        S.termsState = 'ok';
      })
      .catch(() => {
        S.termsState = S.terms ? 'ok' : 'error';
      })
      .then(() => {
        termsPromise = null;
      });
    return termsPromise;
  }

  let archivePromise = null;
  /**
   * 지난 이슈 보관함(archive.json)을 한 번만 받아 와요. 분야를 적게 골라서 3일보다 긴 기간을 보여줘야 하거나 글자로 검색할 때만 받아요.
   * 못 받으면 최근 3일 이슈만 보여주고(오류 안내만 달아요), 다음에 데이터를 새로 받을 때 다시 시도해요.
   */
  function loadArchive() {
    if (archivePromise) return archivePromise;
    S.archiveState = 'loading';
    archivePromise = loadFile('archive.json', 'cache.archive', okRecent)
      .then((j) => {
        S.archive = j;
        S.archiveState = 'ok';
      })
      .catch(() => {
        S.archiveState = S.archive ? 'ok' : 'error';
      })
      .then(() => {
        archivePromise = null;
        archiveArrived();
      });
    return archivePromise;
  }
  /** 3일보다 긴 기간이 필요한 화면에서 부르면, 보관함을 아직 안 받았을 때만 받기 시작해요 */
  function wantArchive(days) {
    if (days > FEED_DAYS && S.archiveState === 'idle') loadArchive();
  }
  /** 보관함이 도착(또는 실패)하면 보고 있는 목록을 다시 그려요 (글자를 치는 중이어도 입력칸은 건드리지 않아요) */
  function archiveArrived() {
    const r = parseRoute().name;
    if (r === 'dict') {
      if (dictRedraw) dictRedraw();
    } else if (r === 'today' && !view.querySelector('.pickrow')) {
      route(true);
    }
  }
  let dictRedraw = null; // 가장 최근에 그린 검색 화면의 목록만 다시 그리는 함수 (검색 화면을 보고 있을 때만 불러요)

  function findCard(id) {
    const a = S.today && S.today.cards.find((c) => c.id === id);
    if (a) return a;
    const b = S.recent && S.recent.cards.find((c) => c.id === id);
    if (b) return b;
    const c = S.archive && S.archive.cards.find((x) => x.id === id);
    if (c) return c;
    return (S.terms && S.terms.terms.find((x) => x.id === id)) || null;
  }

  // ---------- 분야 ----------
  const HEX = /^#[0-9A-Fa-f]{6}$/;
  /** 분야 정보. 목록에 없는 분야여도 화면이 깨지지 않게 기본값을 줘요 */
  function groupOf(id) {
    const g = S.groups && S.groups.find((x) => x.id === id);
    return g || { id: String(id || ''), label: '', hint: '', icon: 'meme' };
  }
  function groupColors(g) {
    const ok = (v, d) => (typeof v === 'string' && HEX.test(v) ? v : d);
    return { a1: ok(g.a1, '#3347FF'), a2: ok(g.a2, '#6F7DFF'), ink: ok(g.ink, '#FFFFFF') };
  }
  function groupIds() {
    return S.groups ? S.groups.map((g) => g.id) : [];
  }
  /** 내가 고른 분야 (분야 목록에 없는 id 는 빼요). 아직 안 골랐으면 null */
  function myCats() {
    if (!S.groups || !S.cats) return null;
    // 분야 목록(categories.json)의 지금 순서대로 보여줘요 (순서를 바꿔도 이미 고른 사람에게 바로 적용돼요)
    const mine = groupIds().filter((id) => S.cats.includes(id));
    return mine.length ? mine : null;
  }
  function needsPick() {
    return !!S.groups && !myCats();
  }
  function saveCats(ids) {
    const order = groupIds();
    S.cats = order.filter((id) => ids.includes(id));
    store.set('cats', S.cats);
    S.shown = {}; // 보는 분야가 바뀌었으니 '더 보기'로 펼친 길이도 처음부터
    onCatsChanged();
  }
  function onCatsChanged() {
    // 고른 분야가 바뀌면 푸시 알림 구독도 맞춰요 (푸시를 쓰는 앱이고 알림이 켜져 있을 때만)
    if (S.alertOn && fcm()) syncPush().catch(() => {});
  }
  /**
   * 분야 구성이 새로 바뀌면(categories.json 의 revision 이 올라가면) 옛 선택을 새 분야로 옮겨요.
   * 없어진 분야 id 는 새 분야의 replaces 에 적혀 있어요(예: screen → ent). 옮길 게 있으면 한 번 확인하도록 안내하고,
   * 옮길 게 하나도 없으면 처음 실행처럼 분야부터 고르게 돼요. 처음 쓰는 사람에게는 아무 일도 없어요.
   */
  function applyRevision(j) {
    const rev = j && Number.isInteger(j.revision) && j.revision >= 1 ? j.revision : 0;
    S.rev = rev;
    if (!rev || store.get('catsRev', 0) === rev) return;
    if (S.cats) {
      const ids = j.groups.map((g) => g.id);
      const next = new Set();
      S.cats.forEach((id) => {
        if (ids.includes(id)) next.add(id);
        else j.groups.forEach((g) => Array.isArray(g.replaces) && g.replaces.includes(id) && next.add(g.id));
      });
      S.cats = ids.filter((id) => next.has(id));
      store.set('cats', S.cats);
      if (S.cats.length) S.revNotice = true;
      onCatsChanged();
    }
    store.set('catsRev', rev);
  }
  /** '드라마·영화·웹툰' 처럼 가운뎃점이 든 이름은 점 뒤에서만 줄이 바뀌게 해요 */
  function labelNodes(label) {
    const out = [];
    String(label)
      .split('·')
      .forEach((part, i) => {
        if (i) out.push('·', h('wbr'));
        out.push(part);
      });
    return out;
  }
  /** 분야 색 점 + 글자 */
  function gdot(groupId) {
    return h('i', { class: 'gdot', style: `background:${groupColors(groupOf(groupId)).a1}` });
  }

  // ---------- 분야별 목록 ----------
  // 얼마나 오래된 이슈까지 보여줄지는 '고른 분야 수'에 따라 달라져요 (2026-10-19 사용자 요청).
  //  - 모든 분야를 고르면 오늘 기준 2일 전까지(오늘·어제·그저께, FEED_DAYS = 3일). scripts/content.mjs 의 RECENT_DAYS 와 같은 값이에요.
  //  - 분야를 적게 고를수록 화면에 보이는 양이 비슷하도록 더 오래전 이슈까지 보여줘요 (분야 수 × 일수가 거의 같아요: 8개 3일 → 4개 6일 → 2개 12일).
  //  - 딱 1개만 고르면 그 분야의 이슈를 모두 보여줘요.
  // 3일보다 긴 기간은 지난 이슈 보관함(archive.json)에서 가져와요. 분야마다 FEED_PAGE 개씩 보여주고 '더 보기'로 이어서 펼쳐요.
  const FEED_DAYS = 3;
  const FEED_PAGE = 20;

  /** 보고 있는 분야가 n 개일 때 보여줄 기간(일). 분야를 하나만 보면 Infinity(전부) */
  function windowDays(n) {
    const total = S.groups ? S.groups.length : 0;
    if (!total || n >= total) return FEED_DAYS; // 모든 분야(또는 분야 목록을 못 받은 때)는 기본 기간
    if (n <= 1) return Infinity;
    return Math.max(FEED_DAYS, Math.round((FEED_DAYS * total) / n));
  }

  /** 오늘 해설·최근 해설·지난 이슈 보관함을 합쳐서 (같은 id 는 먼저 온 쪽 하나만) 오늘 기준 days 일 안의 것만, 최신 날짜 순으로 */
  function feedCards(days) {
    const d = days === undefined ? FEED_DAYS : days;
    const seen = new Set();
    const out = [];
    const add = (c) => {
      if (!c || typeof c.id !== 'string' || seen.has(c.id)) return;
      seen.add(c.id);
      out.push(c);
    };
    if (S.today) S.today.cards.forEach(add);
    if (S.recent) S.recent.cards.forEach(add);
    if (S.archive && d > FEED_DAYS) S.archive.cards.forEach(add);
    const from = d === Infinity ? '' : addDays(todayYmd(), -(d - 1));
    return out.filter((c) => YMD.test(c.date || '') && c.date >= from).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  /** 오늘 화면의 내용: 보여줄 기간(days), 그 기간의 해설 전부(all), 내 분야마다 하나씩(secs). 분야 목록에 없는 분야의 해설은 '기타'로, 분야 목록을 못 받았으면 한 목록으로 */
  function feedView() {
    const mine = S.groups ? myCats() : null;
    const ids = groupIds();
    const days = windowDays(mine ? mine.length : ids.length);
    const all = feedCards(days);
    if (!S.groups) return { days, all, secs: [{ id: '', label: '최근 이슈', cards: all }] };
    const secs = (mine || ids).map((id) => ({ id, label: groupOf(id).label, cards: all.filter((c) => c.group === id) }));
    const other = all.filter((c) => !ids.includes(c.group));
    if (other.length) secs.push({ id: '', label: '기타', cards: other });
    return { days, all, secs };
  }

  /** 기간을 사람이 읽는 말로: 최근 8일 / 전체 */
  function spanText(days) {
    return days === Infinity ? '모든 기간' : `최근 ${days}일`;
  }
  /** 내 분야 줄 밑의 한 줄 설명 (n = 고른 분야 수) */
  function windowNote(days, n) {
    if (days === Infinity) return '고른 분야가 하나라서 이 분야의 이슈를 모두 보여드려요.';
    return `${spanText(days)} 이슈를 보여드려요.` + (n > 1 ? ' 분야를 적게 고를수록 더 오래된 이슈까지 보여드려요.' : '');
  }
  /** 해당 기간에 이슈가 없을 때의 말 */
  function noneText(days) {
    return days === Infinity ? '아직 올라온 이슈가 없어요.' : `${spanText(days)} 동안 올라온 이슈가 아직 없어요.`;
  }

  /** 해설 날짜를 짧게: 오늘 / 어제 / 그저께 / 10월 14일 */
  function dayText(s) {
    const now = todayYmd();
    if (s === now) return '오늘';
    if (daysApart(s, now) === 1) return '어제';
    if (daysApart(s, now) === 2) return '그저께';
    const d = parseYmd(s);
    if (!d) return '';
    // 해가 다른 오래된 해설은 연도도 같이 (예: 2025년 12월 30일)
    const yr = parseYmd(now);
    return `${yr && d.getFullYear() !== yr.getFullYear() ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  function dayTag(s) {
    const t = dayText(s);
    return t ? h('span', { class: t === '오늘' ? 'dtag now' : 'dtag' }, t) : null;
  }

  // ---------- 길 찾기(라우터) ----------
  function parseRoute() {
    const parts = (location.hash || '#/').replace(/^#/, '').split('/').filter(Boolean);
    if (parts[0] === 't' && parts[1]) return { name: 'detail', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'dict') return { name: 'dict' };
    if (parts[0] === 'alerts') return { name: 'alerts' };
    if (parts[0] === 'pick') return { name: 'pick' };
    return { name: 'today' };
  }
  function go(path, replace) {
    const target = '#' + path;
    if (replace) {
      history.replaceState(null, '', target);
      route();
    } else if (location.hash === target || (!location.hash && target === '#/')) {
      route();
    } else {
      location.hash = target; // hashchange → route()
    }
  }

  function updateTabs(r) {
    const active = r.name === 'detail' || r.name === 'pick' ? 'today' : r.name;
    document.querySelectorAll('.tab').forEach((b) => {
      if (b.dataset.tab === active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  // ---------- 보던 자리 기억하기 ----------
  // 오늘·검색 목록에서 해설을 열었다가 뒤로 오면, 떠나기 전에 보던 자리로 돌아와요.
  // 해설을 열기 직전의 스크롤 위치를 화면 이름별로 기억해 두었다가, 그 화면으로 돌아올 때 되돌려요.
  // 다른 탭으로 가거나 이미 보고 있는 탭을 다시 누르는 건 새로 시작이라 맨 위에서 보여줘요.
  const savedScroll = {}; // 화면 이름 → 해설을 열기 직전의 스크롤 위치
  let shownName = ''; // 지금 화면에 그려져 있는 화면 이름 (today | detail | dict | alerts | pick)
  let detailFrom = ''; // 지금 열려 있는 해설을 연 화면

  function restoreScroll(y) {
    view.scrollTop = y;
    // 글꼴 등이 늦게 자리를 잡아 높이가 바뀌어도 한 번 더 맞춰요 (그 사이 다른 화면으로 가지는 않았을 때만)
    requestAnimationFrame(() => {
      if (shownName !== 'detail' && Math.abs(view.scrollTop - y) > 1) view.scrollTop = y;
    });
  }

  function route(keepScroll) {
    const r = parseRoute();
    updateTabs(r);
    let restoreTo = 0;
    if (!keepScroll) {
      if (r.name === 'detail' && shownName && shownName !== 'detail') {
        // 목록에서 해설로 들어가요. 아직 이전 화면이 그대로 있어서 지금 보던 자리를 읽을 수 있어요
        savedScroll[shownName] = view.scrollTop;
        detailFrom = shownName;
      } else if (r.name !== 'detail' && shownName === 'detail' && r.name === detailFrom) {
        // 해설을 열었던 화면으로 돌아와요
        restoreTo = savedScroll[r.name] || 0;
      }
    }
    if (r.name === 'today') renderToday(keepScroll);
    else if (r.name === 'detail') renderDetail(r.id, keepScroll);
    else if (r.name === 'dict') renderDict();
    else if (r.name === 'pick') renderPicker(false);
    else renderAlerts();
    shownName = r.name;
    if (!keepScroll) {
      try {
        view.focus({ preventScroll: true });
      } catch (e) {
        /* 무시 */
      }
      if (restoreTo > 0) restoreScroll(restoreTo);
    }
  }

  // ---------- 오늘 ----------
  function brandRow(dateText) {
    return h(
      'div',
      { class: 'brandrow' },
      h('div', { class: 'brand' }, '왜이슈', h('span', null, '?')),
      h('div', { class: 'date' }, dateText || '')
    );
  }

  function errorBox(title, text, onRetry) {
    return h('div', { class: 'box', role: 'alert' }, h('h2', null, title), h('p', null, text), onRetry && h('button', { class: 'btn primary', type: 'button', onclick: onRetry }, '다시 시도'));
  }

  function catPill(c) {
    return h('span', { class: 'pill' }, gdot(c.group), c.cat);
  }

  function cardButton(c) {
    return h(
      'button',
      { class: 'card', type: 'button', onclick: () => go('/t/' + encodeURIComponent(c.id)) },
      h('span', { class: 'ctop' }, catPill(c), dayTag(c.date)),
      h('span', { class: 'kw' }, h('span', { class: 'hl' }, c.keyword)),
      h('span', { class: 'ln' }, c.line),
      h('span', { class: 'more' }, h('span', null, '왜 화제인지 보기'), icon('right'))
    );
  }

  /** 목록용 작은 카드. 분야별 목록에서는 세부 분류 + 날짜, 검색 화면에서는 분야 점(withDot)도 같이 */
  function termRow(c, withDate, withDot) {
    return h(
      'button',
      { class: 'term', type: 'button', onclick: () => go('/t/' + encodeURIComponent(c.id)) },
      h('span', { class: 'row' }, h('span', { class: 'nm' }, c.keyword), withDate ? h('span', { class: 'tg' }, withDot ? gdot(c.group) : null, h('span', { class: 'tcat' }, c.cat), dayTag(c.date)) : h('span', { class: 'tg' }, gdot(c.group), c.cat)),
      h('span', { class: 'ml', style: 'display:block' }, c.line)
    );
  }

  /**
   * 작은 카드 목록을 FEED_PAGE 개씩 보여주고, 남았으면 '더 보기' 버튼을 달아요. 누르면 화면을 다시 그리지 않고 같은 자리에 이어서 붙어요.
   * 펼친 개수는 key 별로 기억해서(S.shown), 해설을 열었다가 뒤로 와도 같은 길이로 그려요.
   */
  function pagedRows(items, key, makeRow) {
    if (!items.length) return [];
    const box = h('div', { class: 'tlist' });
    const btn = h('button', { class: 'btn ghost morebtn', type: 'button' });
    let shown = 0;
    const fill = (upTo) => {
      const end = Math.min(items.length, upTo);
      for (; shown < end; shown++) box.appendChild(makeRow(items[shown]));
      S.shown[key] = shown;
      const left = items.length - shown;
      if (left > 0) btn.textContent = `이슈 더 보기 (${left}개 남음)`;
      else btn.remove();
    };
    btn.addEventListener('click', () => fill(shown + FEED_PAGE));
    fill(Math.max(FEED_PAGE, S.shown[key] || 0));
    return items.length > shown ? [box, btn] : [box];
  }

  /** 분야 하나: 제목 + 가장 최근 해설은 큰 카드로, 나머지는 작은 카드로 (days = 보여주는 기간) */
  function sectionNode(sec, days) {
    const items = sec.cards;
    return h(
      'section',
      { class: 'sec', 'aria-label': sec.label },
      h('div', { class: 'sechead' }, h('h2', { class: 'sech' }, sec.id ? gdot(sec.id) : null, h('span', null, labelNodes(sec.label))), items.length ? h('span', { class: 'secn' }, items.length + '개') : null),
      items.length ? [cardButton(items[0]), pagedRows(items.slice(1), 's:' + (sec.id || '_'), (c) => termRow(c, true))] : h('p', { class: 'secnone' }, noneText(days))
    );
  }

  function myCatsRow(days) {
    const mine = myCats();
    if (!mine) return null;
    const all = mine.length === S.groups.length;
    const pills = all
      ? [h('span', { class: 'pill g' }, '모든 분야')]
      : mine.map((id) => h('span', { class: 'pill g' }, gdot(id), labelNodes(groupOf(id).label)));
    return h(
      'div',
      { class: 'mycats' },
      h('div', { class: 'mytop' }, h('span', { class: 'mylabel' }, '내 분야'), h('button', { class: 'linkbtn', type: 'button', 'aria-label': '내 분야 바꾸기', onclick: () => go('/pick') }, '바꾸기')),
      h('div', { class: 'mypills' }, pills),
      h('p', { class: 'mywin' }, windowNote(days, mine.length))
    );
  }

  function renderToday(keepScroll) {
    document.title = '왜이슈? – 지금 화제인 이슈, 30초 해설';
    if (S.today && needsPick()) return renderPicker(true); // 처음 실행하면 관심 분야부터 골라요
    if (S.today && S.revNotice && myCats()) {
      S.revNotice = false; // 분야가 바뀐 걸 알리는 화면은 한 번만 보여줘요
      return renderPicker(false, true);
    }
    const nodes = [brandRow(S.today ? koDate(S.today.date) : ''), h('h1', { class: 'hero' }, '지금 화제인 이슈,', h('br'), h('span', { class: 'hl' }, '30초 해설'))];

    if (!S.today) {
      if (S.todayState === 'error') nodes.push(errorBox('해설을 불러오지 못했어요', '인터넷 연결을 확인하고 다시 시도해 주세요.', () => refreshData(true)));
      else nodes.push(h('p', { class: 'note', role: 'status' }, '해설을 불러오고 있어요…'));
    } else if (S.groupsState === 'loading' && !S.groups) {
      // 분야 목록이 와야 '내 분야'를 걸러낼 수 있어요. 잠깐이라 안내만 보여줘요 (못 받으면 전부 보여줘요)
      nodes.push(h('p', { class: 'note', role: 'status' }, '해설을 불러오고 있어요…'));
    } else {
      const fv = feedView();
      wantArchive(fv.days); // 3일보다 긴 기간이면 지난 이슈 보관함을 받아 와요 (도착하면 이 화면을 다시 그려요)
      const late = daysApart(S.today.date, todayYmd()) >= 2;
      if (late) nodes.push(h('p', { class: 'stale', role: 'status' }, '업데이트가 조금 늦어지고 있어요. 새 이슈가 올라오면 바로 보여드릴게요.'));
      nodes.push(myCatsRow(fv.days));
      if (fv.secs.some((s) => s.cards.length)) {
        fv.secs.forEach((s) => nodes.push(sectionNode(s, fv.days)));
      } else if (!fv.all.length) {
        // 보여줄 기간 안의 이슈가 하나도 없어요 (갱신이 며칠 멈춘 경우). 기간 밖의 이슈를 대신 보여주지 않아요
        nodes.push(
          h(
            'div',
            { class: 'box' },
            h('h2', null, fv.days === Infinity ? '아직 이슈가 없어요' : `${spanText(fv.days)} 이슈가 아직 없어요`),
            h('p', null, '새 이슈가 올라오면 여기에 바로 보여요.' + (fv.days <= FEED_DAYS ? ' 분야를 적게 고르면 더 오래된 이슈도 볼 수 있어요.' : ''))
          )
        );
      } else {
        nodes.push(
          h(
            'div',
            { class: 'box' },
            h('h2', null, '내 분야의 이슈가 아직 없어요'),
            h('p', null, '새 이슈가 올라오면 여기에 보여요. 분야를 바꾸면 다른 이슈도 볼 수 있어요.'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => go('/pick') }, '분야 바꾸기')
          )
        );
      }
      if (fv.days > FEED_DAYS && S.archiveState === 'loading') nodes.push(h('p', { class: 'note', role: 'status' }, '지난 이슈를 더 불러오고 있어요…'));
      else if (fv.days > FEED_DAYS && S.archiveState === 'error') nodes.push(h('p', { class: 'note', role: 'status' }, `지난 이슈를 불러오지 못해서 최근 ${FEED_DAYS}일 이슈만 보여드려요. 인터넷 연결을 확인해 주세요.`));
      nodes.push(h('p', { class: 'note' }, AI_NOTE));
    }
    setView(nodes, keepScroll);
  }

  // ---------- 관심 분야 고르기 ----------
  // first=true: 처음 실행했을 때 오늘 화면 자리에서 보여줘요. false: '바꾸기'를 눌러 들어온 화면(#/pick)
  // revised=true: 분야 구성이 새로 바뀐 뒤 처음 열 때(옛 선택을 새 분야로 옮겨 두었고, 새로 생긴 분야에 '새 분야' 표시를 달아요)
  function renderPicker(first, revised) {
    document.title = first ? '왜이슈? – 관심 분야 고르기' : '내 분야 – 왜이슈?';
    if (!S.groups) {
      setView([
        h('div', { class: 'topbar' }, h('button', { class: 'back', type: 'button', onclick: backToList }, icon('left', 22), '뒤로')),
        S.groupsState === 'loading'
          ? h('p', { class: 'note', role: 'status' }, '분야 목록을 불러오고 있어요…')
          : errorBox('분야 목록을 불러오지 못했어요', '인터넷 연결을 확인하고 다시 시도해 주세요.', () => refreshData(true).then(() => route()))
      ]);
      return;
    }
    const groups = S.groups;
    const chosen = new Set(myCats() || (first ? [] : groups.map((g) => g.id)));

    const rows = groups.map((g) => {
      const col = groupColors(g);
      const btn = h(
        'button',
        {
          class: 'pickrow',
          type: 'button',
          'data-group': g.id,
          'aria-pressed': chosen.has(g.id) ? 'true' : 'false',
          onclick: () => {
            if (chosen.has(g.id)) chosen.delete(g.id);
            else chosen.add(g.id);
            btn.setAttribute('aria-pressed', chosen.has(g.id) ? 'true' : 'false');
            sync();
          }
        },
        h('span', { class: 'pico', style: `background:linear-gradient(135deg,${col.a1},${col.a2});color:${col.ink}`, 'aria-hidden': 'true' }, icon(g.icon, 24)),
        h('span', { class: 'ptxt' }, h('span', { class: 'pl1' }, labelNodes(g.label), revised && S.rev && g.since === S.rev ? h('span', { class: 'pnew' }, '새 분야') : null), h('span', { class: 'pl2' }, g.hint)),
        h('span', { class: 'pcheck', 'aria-hidden': 'true' }, icon('check', 16))
      );
      return btn;
    });

    // 분야가 새로 바뀐 안내(revised)는 오늘 화면 자리에서 보여주니, 끝나면 history 를 되돌리지 않고 오늘 화면으로 바로 가요
    const leave = revised ? () => go('/', true) : backToList;
    const finish = () => {
      if (first) renderToday(false);
      else {
        toast('내 분야를 저장했어요');
        leave();
      }
    };
    const hint = h('p', { class: 'pickhint', role: 'status' });
    const save = h(
      'button',
      {
        class: 'btn primary',
        type: 'button',
        onclick: () => {
          if (!chosen.size) return;
          saveCats([...chosen]);
          finish();
        }
      },
      first ? '시작하기' : '저장'
    );
    const allBtn = h('button', {
      class: 'linkbtn',
      type: 'button',
      onclick: () => {
        const everything = chosen.size === groups.length;
        chosen.clear();
        if (!everything) groups.forEach((g) => chosen.add(g.id));
        rows.forEach((r) => r.setAttribute('aria-pressed', chosen.has(r.getAttribute('data-group')) ? 'true' : 'false'));
        sync();
      }
    });
    function sync() {
      const n = chosen.size;
      save.disabled = n === 0;
      hint.textContent = '';
      append(hint, n === 0 ? '하나 이상 골라 주세요' : n === groups.length ? '모든 분야를 볼게요' : `${n}개 분야를 골랐어요`);
      // 고른 분야 수에 따라 보여주는 기간이 달라져요 (windowDays)
      if (n > 0) append(hint, h('span', { class: 'pickwin' }, windowDays(n) === Infinity ? '이 분야의 이슈를 모두 보여드려요' : `${spanText(windowDays(n))} 이슈를 보여드려요`));
      allBtn.textContent = n === groups.length ? '전체 해제' : '전체 선택';
    }
    sync();

    const head = first
      ? [brandRow(''), h('h1', { class: 'h2big pickh' }, '어떤 얘기가 궁금하세요?'), h('p', { class: 'sub' }, '관심 있는 분야를 고르면 그 분야의 새 이슈를 먼저 보여드려요. 나중에 언제든 바꿀 수 있어요.')]
      : [
          h('div', { class: 'topbar' }, h('button', { class: 'back', type: 'button', onclick: leave }, icon('left', 22), '뒤로')),
          h('h1', { class: 'h2big' }, revised ? '분야가 새로 바뀌었어요' : '내 분야'),
          h('p', { class: 'sub' }, revised ? `포털 뉴스처럼 ${groups.length}개 분야로 정리했어요. 지난번에 고른 분야는 새 분야로 옮겨 뒀어요. 확인하고 저장해 주세요.` : '고른 분야의 이슈만 오늘 화면에 보여드려요. 적게 고를수록 더 오래된 이슈까지 보여드려요.')
        ];
    setView(
      [
        head,
        h('div', { class: 'mytop' }, h('span', { class: 'mylabel' }, '여러 개 골라도 돼요'), allBtn),
        h('div', { class: 'picklist', role: 'group', 'aria-label': '관심 분야' }, rows),
        h('div', { class: 'pickbar' }, hint, save)
      ],
      false
    );
  }

  // ---------- 해설 ----------
  function shareCard(c) {
    const url = (CFG.siteUrl || '') + '#/t/' + encodeURIComponent(c.id);
    const text = `'${c.keyword}' 왜 화제일까요? ${c.line}`;
    const Share = plugin('Share');
    const run = Share
      ? Share.share({ title: c.keyword, text, url, dialogTitle: '친구에게 공유하기' })
      : navigator.share
        ? navigator.share({ title: c.keyword, text, url })
        : (navigator.clipboard ? navigator.clipboard.writeText(text + '\n' + url) : Promise.reject(new Error('no clipboard'))).then(() => toast('링크를 복사했어요'));
    Promise.resolve(run).catch(() => {
      /* 공유 창을 닫은 경우 등은 조용히 넘어가요 */
    });
  }

  function sendReport(c, redraw) {
    const rep = CFG.report || {};
    if (!rep.endpoint && rep.email) {
      // 접수 폼이 없으면 메일 앱을 열어 신고 내용을 미리 적어 줘요.
      // 실제로 보냈는지는 알 수 없어서 '완료'로 표시하지는 않아요.
      const subject = `[왜이슈 신고] ${c.keyword}`;
      const body = [`해설: ${c.keyword} (${c.id})`, `날짜: ${c.date}`, `버전: v${CFG.appVersion || ''} ${NATIVE ? 'app' : 'web'}`, '', '어느 부분이 이상한가요?', ''].join('\n');
      S.reportState[c.id] = 'mail';
      redraw();
      window.location.href = `mailto:${rep.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return;
    }
    if (!rep.endpoint) {
      S.reportState[c.id] = 'unavailable';
      redraw();
      return;
    }
    S.reportState[c.id] = 'sending';
    redraw();
    const f = rep.fields || {};
    const body = new URLSearchParams();
    if (f.id) body.set(f.id, c.id);
    if (f.keyword) body.set(f.keyword, c.keyword);
    if (f.note) body.set(f.note, `v${CFG.appVersion || ''} ${NATIVE ? 'app' : 'web'} ${c.date}`);
    fetch(rep.endpoint, { method: 'POST', mode: 'no-cors', body })
      .then(() => {
        S.reported[c.id] = true;
        store.set('reported', S.reported);
        S.reportState[c.id] = 'done';
      })
      .catch(() => {
        S.reportState[c.id] = 'failed';
      })
      .then(redraw);
  }

  function reportArea(c) {
    const box = h('div', { class: 'actions', style: 'margin-top:0' });
    const redraw = () => {
      box.textContent = '';
      const st = S.reportState[c.id] || (S.reported[c.id] ? 'done' : 'idle');
      if (st === 'done') {
        box.appendChild(h('div', { class: 'status', role: 'status' }, '알려주셔서 고마워요. 확인 후 해설을 고칠게요.'));
        return;
      }
      box.appendChild(h('button', { class: 'btn ghost', type: 'button', disabled: st === 'sending', onclick: () => sendReport(c, redraw) }, icon('flag'), st === 'sending' ? '보내는 중…' : '내용이 이상해요'));
      if (st === 'mail') box.appendChild(h('div', { class: 'status', role: 'status' }, '메일 앱을 열었어요. 어느 부분이 이상한지 적어서 보내 주세요.'));
      if (st === 'unavailable') box.appendChild(h('div', { class: 'status', role: 'status' }, '신고 접수를 준비하고 있어요. 조금만 기다려 주세요.'));
      if (st === 'failed') box.appendChild(h('div', { class: 'status warn', role: 'status' }, '전송하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.'));
    };
    redraw();
    return box;
  }

  // ---------- 사진·영상 ----------
  // 기사에 실린 사진은 저작권 때문에 쓰지 않아요. 소식의 당사자나 방송·언론사가 직접 올린 유튜브 영상은 미리보기(썸네일)와
  // 재생으로 보여주고, 영상이 없는 해설에는 분야별 그림 카드를 보여줘요.
  // 데이터에서 온 값은 믿지 않고, 영상 주소는 11글자 번호로 우리가 직접 만들어요.
  const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

  /** 영상 정보: id, 화면에 쓸 제목(title), 올린 곳을 알리는 글(credit). 데이터가 어긋나 있으면 null */
  function videoOf(c) {
    const list = Array.isArray(c.media) ? c.media : [];
    const m = list.find((x) => x && x.type === 'video' && x.provider === 'youtube' && YOUTUBE_ID.test(String(x.id)));
    if (!m) return null;
    const id = String(m.id);
    const channel = typeof m.channel === 'string' ? m.channel.trim().slice(0, 40) : '';
    if (channel) {
      // 소식의 당사자(공식 채널)나 방송·언론사가 올린 영상
      const title = typeof m.title === 'string' && m.title.trim() ? m.title.trim().slice(0, 120) : c.keyword;
      return { id, title, credit: `${m.kind === 'news' ? '뉴스 영상' : '공식 채널 영상'} · ${channel}` };
    }
    // 예전 형식: 출처로 단 기사에 실린 영상
    const src = (c.sources || []).find((s) => s && s.url === m.from);
    return { id, title: src ? String(src.title || '') : c.keyword, credit: src && src.name ? `${src.name} 기사에 실린 영상` : '관련 영상' };
  }

  /** 조회수를 '○○만 회'로 바꿔요. 앞 두 자리만 남기고 내려서(734만 → 730만) 실제보다 크게 보이지 않아요 */
  function viewsText(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 10000) return '';
    if (n >= 100000000) return `${Math.floor(n / 10000000) / 10}억 회`;
    const man = n / 10000;
    const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(man)) - 1));
    return `${(Math.floor(man / p) * p).toLocaleString('en-US')}만 회`;
  }

  /**
   * 유튜브에서 많이 본 관련 영상(밈·신조어 카드의 clips). 뉴스·공식 채널 영상이 없는 말에 그 말로 검색해 고른 영상이에요.
   * 데이터가 어긋난 항목은 건너뛰고, 최대 3개까지만 보여줘요. 올린 곳이 일반 채널일 수 있어서 '왜이슈?와 관계없어요'라고 알려줘요.
   */
  function clipsOf(c) {
    const list = Array.isArray(c.clips) ? c.clips : [];
    const out = [];
    const seen = new Set();
    for (const m of list) {
      if (out.length >= 3) break;
      if (!m || m.type !== 'video' || m.provider !== 'youtube' || !YOUTUBE_ID.test(String(m.id)) || seen.has(String(m.id))) continue;
      const channel = typeof m.channel === 'string' ? m.channel.trim().slice(0, 40) : '';
      if (!channel) continue;
      seen.add(String(m.id));
      const title = typeof m.title === 'string' && m.title.trim() ? m.title.trim().slice(0, 120) : c.keyword;
      const views = viewsText(m.views);
      out.push({
        id: String(m.id),
        title,
        credit: `유튜브 영상 · ${channel}${views ? ` · 조회수 ${views} 이상` : ''}`,
        note: '유튜브에 올라온 영상이에요. 내용은 왜이슈?와 관계없어요.'
      });
    }
    return out;
  }

  /** 큰 미리보기 → 보통 미리보기 순서로 시도해요. 둘 다 안 되면 onFail */
  function loadThumb(img, id, onFail) {
    const urls = [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`];
    let i = 0;
    const next = () => {
      if (i < urls.length) img.src = urls[i++];
      else onFail();
    };
    img.addEventListener('error', next);
    img.addEventListener('load', () => {
      // 큰 미리보기가 없는 영상은 유튜브가 아주 작은 대체 그림을 주기도 해서, 그럴 땐 다음 크기를 써요
      if (img.naturalWidth > 0 && img.naturalWidth < 200 && i < urls.length) next();
    });
    next();
  }

  // ----- 장면 그림 (scene) -----
  // 영상이 없는 해설에는 이모지로 만든 '한 장면'을 분야별 그림 카드 위에 보여줘요. 사진·짤·캡처는 출처를 달아도 저작권 문제가 있어서
  // 쓰지 않고, 우리가 고른 이모지로 뜻을 바로 떠올리게 해요. 데이터에서 온 값은 믿지 않고, 이모지 한 개 또는 영문·숫자 1~3자인 칸만
  // 2~4개(이모지 1개 이상) 받아요. 하나라도 어긋나면 장면 없이 그림 카드만 보여줘요.
  const SCENE_EMOJI = /^\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*$/u;
  const SCENE_CHIP = /^[A-Za-z0-9?!]{1,3}$/;

  function sceneOf(c) {
    const list = Array.isArray(c.scene) ? c.scene : null;
    if (!list || list.length < 2 || list.length > 4) return null;
    if (!list.every((x) => typeof x === 'string' && (SCENE_EMOJI.test(x) || SCENE_CHIP.test(x)))) return null;
    return list.some((x) => SCENE_EMOJI.test(x)) ? list : null;
  }

  function artBlock(c) {
    const g = groupOf(c.group);
    const col = groupColors(g);
    const style = `--a1:${col.a1};--a2:${col.a2};color:${col.ink}`;
    const scene = sceneOf(c);
    if (!scene) return h('div', { class: 'art', style, 'aria-hidden': 'true' }, icon(g.icon, 64));
    const cells = [];
    scene.forEach((x, i) => {
      if (i) cells.push(h('span', { class: 'ar', 'aria-hidden': 'true' }, '→'));
      cells.push(h('span', { class: SCENE_EMOJI.test(x) ? 'se' : 'sc' }, x));
    });
    return h('div', { class: 'art scene', style, role: 'img', 'aria-label': `장면: ${c.line}` }, h('div', { class: 'strip' }, cells));
  }

  /** "A: …\nB: …" 모양의 예시를 대화 말풍선으로 바꿔요. 모양이 다르면 null (원래 글 그대로 보여줘요) */
  function chatOf(example) {
    const lines = String(example || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length || lines.length > 6) return null;
    const out = [];
    for (const ln of lines) {
      const m = /^([AB])\s*[:：]\s*(.+)$/.exec(ln);
      if (!m) return null;
      out.push({ who: m[1], text: m[2] });
    }
    return out;
  }

  function exampleBlock(c) {
    const chat = chatOf(c.example);
    if (!chat) return h('div', { class: 'bubble' }, c.example);
    return h(
      'div',
      { class: 'chat', role: 'group', 'aria-label': '대화 예시' },
      chat.map((m) => h('div', { class: 'msg ' + (m.who === 'A' ? 'a' : 'b') }, h('span', { class: 'who' }, m.who), h('p', { class: 'tx' }, m.text)))
    );
  }

  /** 영상·이미지를 직접 보고 싶을 때를 위한 바깥 검색 링크예요. 사진·짤을 우리가 가져다 쓰지 않고, 사용자가 검색 서비스에서 직접 찾게 해요. */
  function findBlock(c) {
    const q = encodeURIComponent(String(c.keyword) + (c.group === 'meme' ? ' 밈' : ''));
    const link = (href, label) => h('a', { class: 'btn ghost', href, target: '_blank', rel: 'noopener noreferrer' }, label, icon('out', 14));
    return section(
      '더 찾아보기',
      h('div', { class: 'finds' }, link(`https://www.youtube.com/results?search_query=${q}`, '유튜브에서 찾기'), link(`https://www.google.com/search?tbm=isch&safe=active&q=${q}`, '이미지로 찾기')),
      h('p', { class: 'note', style: 'margin:8px 4px 0' }, '바깥 서비스의 검색 결과예요. 거기에 보이는 영상·이미지는 왜이슈?와 관계없어요.')
    );
  }

  // ----- 영상 재생 (웹·앱 모두 그 자리에서 재생해요) -----
  // 유튜브는 플레이어를 넣은 쪽이 '누구인지' Referer 로 알려주길 요구해요(앱이면 앱 ID).
  // 앱은 app/capacitor.config.json 의 server.hostname 을 앱 ID 로 두어서, 앱 화면의 주소가 https://<앱 ID>/ 가 돼요.
  // 앱 안에서 재생이 막힌 기기(유튜브가 오류를 알려준 경우)는 기억해 두었다가 다음부터 곧바로 유튜브로 열어요.
  const WIDGET_ORIGINS = ['https://www.youtube-nocookie.com', 'https://www.youtube.com'];

  function inlineAllowed() {
    if (!NATIVE) return true;
    return !!(CFG.media && CFG.media.inlineInApp === true) && store.get('yt.inlineBroken', false) !== true;
  }

  function embedUrl(id) {
    const q = ['autoplay=1', 'rel=0', 'playsinline=1', 'enablejsapi=1'];
    if (NATIVE) q.push('fs=0'); // 앱 화면은 전체 화면 전환을 지원하지 않아서 그 버튼을 숨겨요
    if (/^https?:\/\//.test(location.origin)) q.push('origin=' + encodeURIComponent(location.origin));
    return `https://www.youtube-nocookie.com/embed/${id}?${q.join('&')}`;
  }

  /** 플레이어가 보내주는 오류 소식을 듣고, 화면이 숨겨지면 일시정지해요. 돌려주는 함수를 부르면 듣기를 멈춰요. */
  function watchPlayer(iframe, onError) {
    let alive = true;
    let heard = false;
    let tries = 0;
    const send = (msg) => {
      try {
        iframe.contentWindow.postMessage(JSON.stringify(msg), '*');
      } catch (e) {
        /* 보낼 수 없으면 그냥 넘어가요 */
      }
    };
    const stop = () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    const onMessage = (ev) => {
      if (!alive) return;
      if (!iframe.isConnected) return stop();
      if (ev.source !== iframe.contentWindow || !WIDGET_ORIGINS.includes(ev.origin)) return;
      heard = true;
      let d = ev.data;
      if (typeof d === 'string') {
        try {
          d = JSON.parse(d);
        } catch (e) {
          return;
        }
      }
      if (d && d.event === 'onError') {
        stop();
        onError(Number(d.info));
      }
    };
    const onVisibility = () => {
      if (!alive) return;
      if (!iframe.isConnected) return stop();
      if (document.hidden) send({ event: 'command', func: 'pauseVideo', args: '' }); // 앱을 나가도 소리가 이어지지 않게
    };
    // 플레이어가 소식을 보내기 시작하게 '듣고 있어요' 신호를 보내요 (준비될 때까지 몇 번 반복)
    const hello = () => {
      if (heard || !alive || !iframe.isConnected || ++tries > 20) return clearInterval(timer);
      send({ event: 'listening', id: 1, channel: 'widget' });
    };
    const timer = setInterval(hello, 500);
    window.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onVisibility);
    iframe.addEventListener('load', hello);
    return stop;
  }

  /** 영상 한 칸: 미리보기를 누르면 그 자리에서 재생해요. v 는 videoOf·clipsOf 가 돌려준 값이에요 */
  function videoFigure(v) {
    const watch = `https://www.youtube.com/watch?v=${v.id}`;
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    const play = h(
      'a',
      { class: 'vplay', href: watch, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `영상 보기: ${v.title}` },
      img,
      h('span', { class: 'pb', 'aria-hidden': 'true' }, icon('play', 28))
    );
    const frame = h('div', { class: 'vframe' }, play);
    loadThumb(img, v.id, () => {
      img.remove();
      play.classList.add('nothumb');
    });
    if (inlineAllowed()) {
      play.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // 한 화면에 영상이 여러 개일 때, 다른 영상이 재생 중이면 멈춰요
        view.querySelectorAll('.vframe iframe').forEach((f) => {
          try {
            f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
          } catch (err) {
            /* 보낼 수 없으면 그냥 넘어가요 */
          }
        });
        const iframe = h('iframe', {
          src: embedUrl(v.id),
          title: v.title,
          allow: NATIVE ? 'autoplay; encrypted-media; picture-in-picture' : 'autoplay; encrypted-media; picture-in-picture; fullscreen',
          allowfullscreen: NATIVE ? null : true,
          referrerpolicy: 'strict-origin-when-cross-origin'
        });
        frame.textContent = '';
        frame.appendChild(iframe);
        watchPlayer(iframe, (code) => {
          // 2·5·153: 이 기기/환경에서 플레이어를 못 띄우는 경우예요. 100·101·150 은 그 영상만 막힌 경우라서 기억하지 않아요.
          if (NATIVE && (code === 2 || code === 5 || code === 153)) store.set('yt.inlineBroken', true);
          frame.textContent = '';
          frame.appendChild(
            h(
              'div',
              { class: 'vfail', role: 'status' },
              h('p', null, '이 영상은 여기서 재생되지 않아요.'),
              h('a', { class: 'btn primary', href: watch, target: '_blank', rel: 'noopener noreferrer' }, icon('play', 16), 'YouTube에서 보기')
            )
          );
        });
      });
    }
    return h(
      'figure',
      { class: 'media' },
      frame,
      h(
        'figcaption',
        { class: 'vcap' },
        h('span', null, v.credit),
        h('a', { href: watch, target: '_blank', rel: 'noopener noreferrer' }, 'YouTube에서 보기', icon('out', 14))
      ),
      v.note ? h('p', { class: 'vnote' }, v.note) : null
    );
  }

  /** 해설 위쪽 큰 칸: 뉴스·공식 영상 → (없으면) 많이 본 관련 영상 → (없으면) 장면·분야 그림 카드 순서로 보여줘요 */
  function heroVideo(c) {
    return videoOf(c) || clipsOf(c)[0] || null;
  }

  function mediaBlock(c) {
    const v = heroVideo(c);
    return v ? videoFigure(v) : artBlock(c);
  }

  /** 위쪽 큰 칸에 쓰고 남은 '많이 본 관련 영상'. 없으면 null */
  function clipsBlock(c) {
    const hero = heroVideo(c);
    const rest = clipsOf(c).filter((v) => !hero || v.id !== hero.id);
    return rest.length ? section('많이 본 관련 영상', rest.map(videoFigure)) : null;
  }

  function sourceList(c) {
    return h(
      'ul',
      { class: 'srcs' },
      c.sources.map((s) =>
        h(
          'li',
          null,
          h(
            'a',
            { href: s.url, target: '_blank', rel: 'noopener noreferrer' },
            h('span', { class: 'sn' }, `${s.name} · ${dotDate(s.published)}`, icon('out', 14)),
            h('span', { class: 'st' }, s.title)
          )
        )
      )
    );
  }

  function section(title, ...children) {
    return h('section', { class: 'sec' }, h('h2', null, title), ...children);
  }

  let navigatedInApp = false; // 앱 안에서 화면을 한 번이라도 앞으로 넘겼는지
  function backToList() {
    // 해설을 연 화면(오늘/검색)으로 돌아가요. 링크로 바로 들어왔다면 오늘 화면으로 가요.
    if (navigatedInApp) history.back();
    else go('/', true);
  }

  function renderDetail(id, keepScroll) {
    const c = findCard(id);
    if (!c) {
      if (S.termsState !== 'ok' && S.termsState !== 'error') {
        loadTerms().then(() => parseRoute().name === 'detail' && route());
        setView([h('p', { class: 'note', role: 'status' }, '해설을 찾고 있어요…')]);
        return;
      }
      const top = h('div', { class: 'topbar' }, h('button', { class: 'back', type: 'button', onclick: () => go('/', true) }, icon('left', 22), '오늘'));
      if (S.termsState === 'error') {
        S.termsState = 'idle';
        setView([top, errorBox('해설을 불러오지 못했어요', '인터넷 연결을 확인하고 다시 시도해 주세요.', () => route())]);
        return;
      }
      setView([top, h('div', { class: 'box' }, h('h2', null, '해설을 찾지 못했어요'), h('p', null, '지워졌거나 아직 올라오지 않은 해설이에요.'), h('button', { class: 'btn primary', type: 'button', onclick: () => go('/', true) }, '오늘 화면으로'))]);
      return;
    }
    // 데이터를 새로 받아 화면을 다시 그릴 때, 같은 해설에서 영상이 재생 중이면 그대로 두어요
    if (keepScroll && view.getAttribute('data-card-id') === c.id && view.querySelector('.vframe iframe')) return;
    document.title = `${c.keyword} – 왜이슈?`;
    const nodes = [
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'back', type: 'button', onclick: backToList }, icon('left', 22), '뒤로'),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': '공유', onclick: () => shareCard(c) }, icon('share', 22))
      ),
      catPill(c),
      h('h1', { class: 'dh1' }, h('span', { class: 'hl' }, c.keyword)),
      h('p', { class: 'dline' }, c.line),
      // 3일이 지난 해설(분야를 적게 골라 지난 이슈까지 보거나, 링크·검색으로 연 경우): 열어 주되 지난 소식이라고 알려줘요
      daysApart(c.date, todayYmd()) >= FEED_DAYS ? h('p', { class: 'stale', role: 'status' }, `${daysApart(c.date, todayYmd())}일 전 소식이에요. 지금은 내용이 달라졌을 수 있어요.`) : null,
      mediaBlock(c),
      section(c.group === 'meme' ? '뜻' : '무슨 일이에요?', h('p', null, c.meaning)),
      section('왜 화제일까요?', c.why.map((t, i) => h('div', { class: 'why' }, h('span', { class: 'n' }, String(i + 1)), h('span', { class: 't' }, t))))
    ];
    if (c.example) nodes.push(section('이렇게 써요 (예시)', exampleBlock(c)));
    const moreClips = clipsBlock(c);
    if (moreClips) nodes.push(moreClips);
    nodes.push(findBlock(c));
    nodes.push(section('출처', sourceList(c), h('p', { class: 'note', style: 'margin:10px 4px 0' }, AI_NOTE)));
    nodes.push(h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => shareCard(c) }, '친구에게 공유하기'), reportArea(c)));
    setView(nodes, keepScroll);
    view.setAttribute('data-card-id', c.id);
  }

  // ---------- 검색 ----------
  // 분야를 걸러 보거나 글자로 찾아요. 기간은 첫 화면과 같은 규칙이에요: 전체(모든 분야)는 최근 3일, 분야를 하나 고르면 그 분야의 모든 이슈.
  // 글자를 치면 기간과 상관없이 보관함에 있는 이슈를 모두 찾아요 (오래된 이슈도 아예 못 찾게 되지는 않게).
  function matchTerm(c, needle) {
    if (!needle) return true;
    return [c.keyword, c.line, c.cat, c.meaning].some((t) => String(t).toLowerCase().includes(needle));
  }

  /** 검색 화면에서 보여줄 기간. 글자를 치면 전부, 분야 하나를 고르면 그 분야 전부(분야 1개와 같아요), 전체는 모든 분야를 고른 것과 같아요 */
  function searchDays(needle, only) {
    if (needle) return Infinity;
    return windowDays(only !== 'all' ? 1 : groupIds().length);
  }

  function renderDict() {
    document.title = '검색 – 왜이슈?';

    const listHost = h('div');
    const empty = h('p', { class: 'note', role: 'status' });
    const sub = h('p', { class: 'sub' });
    const input = h('input', {
      id: 'termq',
      type: 'search',
      placeholder: '궁금한 이슈를 검색해 보세요',
      value: S.q,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      oninput: (e) => {
        S.q = e.target.value;
        S.shown.q = 0; // 찾는 말이 바뀌면 '더 보기'도 처음부터
        drawList();
      }
    });
    input.value = S.q;

    function drawList() {
      listHost.textContent = '';
      empty.textContent = '';
      const needle = S.q.trim().toLowerCase();
      const only = S.groups && S.dictGroup !== 'all' && groupIds().includes(S.dictGroup) ? S.dictGroup : 'all';
      const days = searchDays(needle, only);
      sub.textContent = needle
        ? '지난 이슈까지 모두 찾아봐요'
        : only !== 'all'
          ? `${groupOf(only).label} 분야의 이슈를 모두 모아뒀어요`
          : `${spanText(days)} 이슈를 모아뒀어요. 분야를 누르면 그 분야의 이슈를 모두 볼 수 있어요`;
      if (!S.today && !S.recent) {
        empty.textContent = S.todayState === 'error' ? '이슈를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 들어와 주세요.' : '이슈를 불러오고 있어요…';
        return;
      }
      wantArchive(days); // 3일보다 긴 기간이면 지난 이슈 보관함을 받아 와요 (도착하면 이 목록만 다시 그려요)
      const hits = feedCards(days).filter((c) => (only === 'all' || c.group === only) && matchTerm(c, needle));
      append(listHost, pagedRows(hits, 'q', (c) => termRow(c, true, true)));
      const waiting = days > FEED_DAYS && S.archiveState === 'loading';
      if (waiting) empty.textContent = '지난 이슈를 불러오고 있어요…';
      else if (!hits.length) empty.textContent = needle ? '검색 결과가 없어요. 다른 말로 찾아보세요.' : only !== 'all' ? '이 분야는 아직 올라온 이슈가 없어요.' : noneText(days);
      if (days > FEED_DAYS && S.archiveState === 'error') empty.textContent = (empty.textContent ? empty.textContent + ' ' : '') + `지난 이슈를 불러오지 못해서 최근 ${FEED_DAYS}일 이슈만 찾았어요. 인터넷 연결을 확인해 주세요.`;
    }
    dictRedraw = drawList;

    const filterBtns = S.groups
      ? [{ id: 'all', label: '전체' }, ...S.groups].map((g) =>
          h(
            'button',
            {
              class: 'chip',
              type: 'button',
              'data-group': g.id,
              'aria-pressed': S.dictGroup === g.id ? 'true' : 'false',
              onclick: () => {
                S.dictGroup = g.id;
                S.shown.q = 0; // 보는 분야가 바뀌면 '더 보기'도 처음부터
                filterBtns.forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-group') === g.id ? 'true' : 'false'));
                drawList();
              }
            },
            g.id === 'all' ? g.label : labelNodes(g.label)
          )
        )
      : [];

    setView([
      h('h1', { class: 'h2big' }, '검색'),
      sub,
      h('label', { for: 'termq', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap' }, '이슈 검색'),
      h('div', { class: 'field' }, icon('search', 20), input),
      filterBtns.length ? h('div', { class: 'fchips', role: 'group', 'aria-label': '분야로 걸러 보기' }, filterBtns) : null,
      listHost,
      empty
    ]);
    drawList();
  }

  // ---------- 알림 ----------
  function saveAlert() {
    store.set('alertOn', S.alertOn);
    store.set('hour', S.hour);
  }

  // ---------- 푸시 알림 (Firebase, 안드로이드 앱에서만) ----------
  // Firebase 설정이 들어간 앱에서만 켜져요. 아니면 fcm() 이 null 이라서 알림은 예전처럼 기기 안 예약(매일 같은 글)만 써요.
  // 알림을 켜면 '고른 분야'(cat_<분야>)와 '받는 시각'(h<시각>)을 FCM 주제로 구독해요.
  // 서버(scripts/push.mjs)는 시각 주제(h<시각>)로 하루 한 번, 알림 1개만 보내요 (분야별로 나누지 않아요).
  // 분야 주제는 지금은 알림에 쓰지 않지만 그대로 구독해 둬요. 알림을 끄면 구독을 모두 풀고 이 기기의 등록도 지워요.
  const PUSH_TIMEOUT = 15000;
  const TOPIC_RE = /^[a-z0-9_]{1,30}$/;

  function fcm() {
    if (!NATIVE || !Cap || typeof Cap.isPluginAvailable !== 'function') return null;
    try {
      return Cap.isPluginAvailable('FirebaseMessaging') ? plugin('FirebaseMessaging') : null;
    } catch (e) {
      return null;
    }
  }

  /** 지금 구독하고 있어야 하는 주제들 (알림이 꺼져 있거나 분야를 안 골랐으면 없어요) */
  function wantedTopics() {
    if (!S.alertOn) return [];
    const cats = (S.cats || []).filter((id) => TOPIC_RE.test(id)).map((id) => 'cat_' + id);
    return cats.length ? cats.concat('h' + S.hour) : [];
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      Promise.resolve(promise).then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }

  let pushRun = null; // 진행 중인 맞추기
  let pushAgain = false; // 맞추는 동안 또 바뀌었는지
  /** 이 기기의 구독을 '지금 원하는 주제'에 맞춰요. 몇 번을 불러도 안전하고, 바뀐 것만 보내요. */
  function syncPush() {
    if (pushRun) {
      pushAgain = true;
      return pushRun;
    }
    pushRun = (async () => {
      try {
        do {
          pushAgain = false;
          await syncPushOnce();
        } while (pushAgain);
      } finally {
        pushRun = null;
      }
    })();
    return pushRun;
  }

  async function syncPushOnce() {
    const FM = fcm();
    if (!FM) return;
    const want = wantedTopics();
    const have = (store.get('subs', []) || []).filter((t) => typeof t === 'string');
    const registered = store.get('fcmOn', false) === true;
    if (want.length) {
      if (!registered) {
        await withTimeout(FM.getToken(), PUSH_TIMEOUT); // 알림을 켠 뒤에야 이 기기를 등록해요
        store.set('fcmOn', true);
      }
      for (const t of want) {
        if (have.includes(t)) continue;
        await withTimeout(FM.subscribeToTopic({ topic: t }), PUSH_TIMEOUT);
        have.push(t);
        store.set('subs', have);
      }
      for (const t of have.slice()) {
        if (want.includes(t)) continue;
        await withTimeout(FM.unsubscribeFromTopic({ topic: t }), PUSH_TIMEOUT);
        have.splice(have.indexOf(t), 1);
        store.set('subs', have);
      }
    } else if (registered || have.length) {
      for (const t of have.slice()) {
        await withTimeout(FM.unsubscribeFromTopic({ topic: t }), PUSH_TIMEOUT);
        have.splice(have.indexOf(t), 1);
        store.set('subs', have);
      }
      try {
        await withTimeout(FM.deleteToken(), PUSH_TIMEOUT);
      } catch (e) {
        /* 이미 지워졌으면 넘어가요 */
      }
      store.set('fcmOn', false);
    }
  }

  /** 알림 설정을 바꿀 때 불러요. 푸시를 쓰는 앱에서는 서버에 구독을 맞추는 동안 '설정하는 중' 을 보여줘요. */
  async function runAlert() {
    if (!fcm()) {
      await applyAlert();
      return;
    }
    S.alertBusy++;
    if (parseRoute().name === 'alerts') renderAlerts();
    try {
      await applyAlert();
    } finally {
      S.alertBusy--;
    }
  }

  /** 알림을 눌러 앱이 열리면 그 해설로 가요 */
  function initPushTap() {
    const FM = fcm();
    if (!FM || typeof FM.addListener !== 'function') return;
    FM.addListener('notificationActionPerformed', (ev) => {
      const data = ev && ev.notification && ev.notification.data;
      const r = data && typeof data.route === 'string' ? data.route : '';
      go(/^\/t\/[A-Za-z0-9._~%-]{1,90}$/.test(r) ? r : '/');
    });
  }

  /** 알림을 다시 맞춰요: 푸시를 쓰는 앱이면 구독을, 아니면 매일 정한 시각의 기기 안 알림 예약을 (앱에서만) */
  async function applyAlert() {
    const LN = plugin('LocalNotifications');
    if (!LN) return;
    const ID = 1001;
    const FM = fcm();
    try {
      await LN.cancel({ notifications: [{ id: ID }] }); // 푸시를 쓸 때도 예전 예약은 지워서 알림이 겹치지 않게 해요
      if (!S.alertOn) {
        if (FM) await syncPush().catch(() => {}); // 인터넷이 없어 구독을 못 풀면 다음에 앱을 열 때 다시 시도해요
        return;
      }
      const perm = await LN.requestPermissions();
      if (!perm || perm.display !== 'granted') {
        S.alertOn = false;
        S.alertMsg = '알림 권한을 허용해야 받을 수 있어요. 휴대폰 설정에서 허용해 주세요.';
        saveAlert();
        if (FM) await syncPush().catch(() => {});
        return;
      }
      try {
        await LN.createChannel({ id: 'daily', name: '아침 알림', description: '매일 아침 오늘의 해설을 알려드려요', importance: 3, visibility: 1 });
      } catch (e) {
        /* 채널이 이미 있으면 넘어가요 */
      }
      if (FM) {
        try {
          await syncPush();
          S.alertMsg = '';
        } catch (e) {
          S.alertMsg = '알림 설정을 저장하지 못했어요. 인터넷에 연결된 뒤 앱을 다시 열면 자동으로 다시 시도해요.';
        }
        return;
      }
      await LN.schedule({
        notifications: [
          {
            id: ID,
            title: '오늘의 화제 이슈',
            body: '오늘의 30초 해설이 도착했어요',
            channelId: 'daily',
            schedule: { on: { hour: S.hour, minute: 0 }, allowWhileIdle: true }
          }
        ]
      });
      S.alertMsg = '';
    } catch (e) {
      S.alertMsg = '알림을 예약하지 못했어요. 잠시 뒤에 다시 시도해 주세요.';
    }
  }

  function renderAlerts() {
    document.title = '알림 – 왜이슈?';
    const canNotify = !!plugin('LocalNotifications');
    const push = !!fcm();

    const sw = h('span', { class: S.alertOn ? 'sw on' : 'sw' }, h('span', { class: 'knob' }));
    const toggle = h(
      'button',
      {
        class: 'switchrow',
        type: 'button',
        role: 'switch',
        'aria-checked': S.alertOn ? 'true' : 'false',
        onclick: async () => {
          if (!canNotify) {
            S.alertMsg = '아침 알림은 안드로이드 앱에서만 받을 수 있어요.';
            renderAlerts();
            return;
          }
          S.alertOn = !S.alertOn;
          S.alertMsg = '';
          saveAlert();
          await runAlert();
          renderAlerts();
        }
      },
      h('span', { style: 'display:block' }, h('span', { class: 'l1' }, '아침 알림'), h('span', { class: 'l2' }, push ? '오늘의 화제 이슈를 하루 한 번 알려드려요' : '오늘의 화제 이슈가 준비되면 알려드려요')),
      sw
    );

    const hourChips = HOURS.map((hr) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': S.hour === hr ? 'true' : 'false',
          disabled: !canNotify,
          onclick: async () => {
            S.hour = hr;
            saveAlert();
            if (S.alertOn) await runAlert();
            renderAlerts();
          }
        },
        hr + '시'
      )
    );

    const mine = myCats();
    const myPills = mine
      ? mine.length === S.groups.length
        ? [h('span', { class: 'pill g' }, '모든 분야')]
        : mine.map((id) => h('span', { class: 'pill g' }, gdot(id), labelNodes(groupOf(id).label)))
      : [];

    setView(
      [
        h('h1', { class: 'h2big' }, '알림'),
        h('p', { class: 'sub' }, push ? '오늘 새로 올라온 화제 이슈를 아침에 한 번에 알려드려요' : '매일 아침 오늘의 이슈 해설이 나왔다고 알려드려요'),
        h('div', { class: 'panel' }, toggle, h('div', { class: 'label' }, '받는 시간'), h('div', { class: 'chips' }, hourChips), S.alertBusy > 0 && h('div', { class: 'status', role: 'status', style: 'margin-top:14px' }, '알림을 설정하는 중이에요…'), S.alertBusy === 0 && S.alertMsg && h('div', { class: 'status warn', role: 'status', style: 'margin-top:14px' }, S.alertMsg)),
        h(
          'div',
          { class: 'panel' },
          h('div', { class: 'ptitle' }, '내 분야'),
          myPills.length ? h('div', { class: 'mypills', style: 'margin-top:12px' }, myPills) : h('p', { class: 'sub', style: 'margin:8px 0 0' }, S.groups ? '아직 고르지 않았어요.' : '분야 목록을 불러오지 못했어요.'),
          S.groups ? h('button', { class: 'btn ghost', type: 'button', style: 'margin-top:14px', onclick: () => go('/pick') }, '분야 바꾸기') : null,
          h('div', { class: 'info' }, icon('info', 16), h('span', null, push ? '앱 화면에는 고른 분야의 이슈만 보여드려요. 알림은 분야와 상관없이 하루 한 번, 오늘 새로 올라온 이슈를 한꺼번에 알려드려요. 정한 시각보다 몇 분 늦게 올 수 있어요. 확인된 사실만 전하고, 정치 공방과 범죄·사고, 확인되지 않은 의혹은 다루지 않아요.' : '고른 분야의 이슈만 오늘 화면에 보여요. 확인된 사실만 전하고, 정치 공방과 범죄·사고, 확인되지 않은 의혹은 다루지 않아요.'))
        ),
        h('div', { class: 'info' }, icon('info', 16), h('span', null, AI_NOTE)),
        h('p', { class: 'legal' }, h('a', { href: 'privacy.html' }, '개인정보처리방침'))
      ],
      false
    );
  }

  // ---------- 광고 (안드로이드 앱에서만) ----------
  function setAdHeight(px) {
    document.documentElement.style.setProperty('--ad-h', Math.max(0, Math.round(px || 0)) + 'px');
  }

  async function initAds() {
    const Ad = plugin('AdMob');
    const ads = CFG.ads || {};
    if (!Ad || !ads.bannerAdId) return;
    try {
      await Ad.initialize({ initializeForTesting: !!ads.test });
      try {
        // 유럽 등 동의가 필요한 지역에서만 동의 창이 떠요
        const info = await Ad.requestConsentInfo();
        if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') await Ad.showConsentForm();
      } catch (e) {
        /* 동의 정보를 못 받아도 광고 없이 앱은 계속 동작해요 */
      }
      Ad.addListener('bannerAdSizeChanged', (size) => setAdHeight(size && size.height));
      Ad.addListener('bannerAdFailedToLoad', () => setAdHeight(0));
      await Ad.showBanner({ adId: ads.bannerAdId, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: !!ads.test });
    } catch (e) {
      setAdHeight(0);
    }
  }

  function initNative() {
    if (!NATIVE) return;
    const App = plugin('App');
    if (App && App.addListener) {
      App.addListener('backButton', () => {
        const r = parseRoute();
        if (r.name === 'detail' || r.name === 'pick') backToList();
        else if (r.name !== 'today') go('/', true);
        else if (App.exitApp) App.exitApp();
      });
    }
    initAds();
    initPushTap();
    // 시간대·재부팅 뒤에도 예약이 살아 있게 다시 걸어 둬요. 알림이 꺼져 있어도, 못 풀었던 푸시 구독이 남아 있으면 마저 풀어요.
    if (S.alertOn) applyAlert();
    else if (fcm()) syncPush().catch(() => {});
  }

  // ---------- 시작 ----------
  function start() {
    document.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => go(b.dataset.tab === 'today' ? '/' : '/' + b.dataset.tab, true));
    });
    window.addEventListener('hashchange', () => {
      navigatedInApp = true;
      route();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - S.lastLoad > 30 * 60 * 1000) refreshData(false);
    });

    const cached = store.get('cache.today', null);
    if (okToday(cached)) {
      S.today = cached;
      S.todayState = 'ok';
    }
    const cachedGroups = store.get('cache.cats', null);
    if (okGroups(cachedGroups)) {
      S.groups = cachedGroups.groups;
      S.groupsState = 'ok';
    }
    const cachedRecent = store.get('cache.recent', null);
    if (okRecent(cachedRecent)) S.recent = cachedRecent;
    route();
    refreshData(false);
    initNative();
  }

  start();
})();
