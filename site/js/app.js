/* 왜뜨지 – 화면과 동작 (프레임워크 없이 작성) */
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
    set(key, value) {
      try {
        localStorage.setItem('wt.' + key, JSON.stringify(value));
      } catch (e) {
        /* 저장할 수 없어도 앱은 계속 동작해요 */
      }
    }
  };

  // ---------- 상태 ----------
  const GROUPS = [
    { id: 'meme', label: '밈·신조어' },
    { id: 'culture', label: '문화·연예' },
    { id: 'sports', label: '스포츠' },
    { id: 'biz', label: '경제·제품' }
  ];
  const HOURS = [7, 8, 9];
  const AI_NOTE = 'AI가 출처를 확인해 정리한 요약이에요. 틀릴 수 있으니 내용이 이상하면 해설 화면에서 알려주세요.';

  const S = {
    today: null,
    terms: null,
    todayState: 'loading', // loading | ok | error
    termsState: 'idle', // idle | loading | ok | error
    q: '',
    picks: Object.assign({ meme: true, culture: true, sports: true, biz: true }, store.get('picks', {})),
    alertOn: store.get('alertOn', false) === true,
    hour: HOURS.includes(store.get('hour', 8)) ? store.get('hour', 8) : 8,
    alertMsg: '',
    reported: store.get('reported', {}),
    reportState: {},
    lastLoad: 0
  };

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
    out: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>'
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
    el.innerHTML = ICONS[name]; // 위에 적어 둔 고정 문자열만 쓰므로 안전해요
    return el;
  }

  function setView(nodes, keepScroll) {
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
  function localYmd() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function daysApart(a, b) {
    const x = parseYmd(a);
    const y = parseYmd(b);
    return x && y ? Math.round((y - x) / 86400000) : 0;
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

  /** 앱: 인터넷의 최신 파일 → 지난번에 받아 둔 파일 → 앱에 들어 있는 사본 순서. 웹: 같은 주소의 파일 */
  function loadFile(file, cacheKey, ok) {
    const first = NATIVE && CFG.remoteBase ? CFG.remoteBase + 'data/' + file : 'data/' + file;
    return getJson(first)
      .then((j) => {
        if (!ok(j)) throw new Error('bad data');
        store.set(cacheKey, j);
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

  function refreshToday(showLoading) {
    if (showLoading && !S.today) {
      S.todayState = 'loading';
      route();
    }
    return loadFile('today.json', 'cache.today', okToday)
      .then((j) => {
        S.today = j;
        S.todayState = 'ok';
        S.lastLoad = Date.now();
      })
      .catch(() => {
        if (!S.today) S.todayState = 'error';
      })
      .then(() => {
        const r = parseRoute().name;
        if (r === 'today' || r === 'detail') route(true);
      });
  }

  let termsPromise = null;
  /** 사전 파일을 한 번만 받아 와요. 여러 화면이 동시에 부탁해도 같은 약속(Promise)을 같이 기다려요 */
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

  function findCard(id) {
    const a = S.today && S.today.cards.find((c) => c.id === id);
    if (a) return a;
    return (S.terms && S.terms.terms.find((c) => c.id === id)) || null;
  }

  function visibleCards() {
    const list = (S.today && S.today.cards) || [];
    return list.filter((c) => !c.group || S.picks[c.group] !== false);
  }

  // ---------- 길 찾기(라우터) ----------
  function parseRoute() {
    const parts = (location.hash || '#/').replace(/^#/, '').split('/').filter(Boolean);
    if (parts[0] === 't' && parts[1]) return { name: 'detail', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'dict') return { name: 'dict' };
    if (parts[0] === 'alerts') return { name: 'alerts' };
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
    const active = r.name === 'detail' ? 'today' : r.name;
    document.querySelectorAll('.tab').forEach((b) => {
      if (b.dataset.tab === active) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  function route(keepScroll) {
    const r = parseRoute();
    updateTabs(r);
    if (r.name === 'today') renderToday(keepScroll);
    else if (r.name === 'detail') renderDetail(r.id, keepScroll);
    else if (r.name === 'dict') renderDict();
    else renderAlerts();
    if (!keepScroll) {
      try {
        view.focus({ preventScroll: true });
      } catch (e) {
        /* 무시 */
      }
    }
  }

  // ---------- 오늘 ----------
  function brandRow(dateText) {
    return h(
      'div',
      { class: 'brandrow' },
      h('div', { class: 'brand' }, '왜뜨지', h('span', null, '?')),
      h('div', { class: 'date' }, dateText || '')
    );
  }

  function errorBox(title, text, onRetry) {
    return h('div', { class: 'box', role: 'alert' }, h('h2', null, title), h('p', null, text), onRetry && h('button', { class: 'btn primary', type: 'button', onclick: onRetry }, '다시 시도'));
  }

  function cardButton(c) {
    return h(
      'button',
      { class: 'card', type: 'button', onclick: () => go('/t/' + encodeURIComponent(c.id)) },
      h('span', { class: 'pill' }, c.cat),
      h('span', { class: 'kw' }, h('span', { class: 'hl' }, c.keyword)),
      h('span', { class: 'ln' }, c.line),
      h('span', { class: 'more' }, h('span', null, '왜 뜨지? 보기'), icon('right'))
    );
  }

  function renderToday(keepScroll) {
    document.title = '왜뜨지? – 요즘 뜨는 말, 30초 해설';
    const nodes = [brandRow(S.today ? koDate(S.today.date) : ''), h('h1', { class: 'hero' }, '요즘 뜨는 말,', h('br'), h('span', { class: 'hl' }, '30초 해설'))];

    if (!S.today) {
      if (S.todayState === 'error') nodes.push(errorBox('해설을 불러오지 못했어요', '인터넷 연결을 확인하고 다시 시도해 주세요.', () => refreshToday(true)));
      else nodes.push(h('p', { class: 'note', role: 'status' }, '해설을 불러오고 있어요…'));
    } else {
      const cards = visibleCards();
      if (daysApart(S.today.date, localYmd()) >= 2) nodes.push(h('p', { class: 'stale', role: 'status' }, '업데이트가 조금 늦어지고 있어요. 지난 해설을 보여드려요.'));
      if (cards.length) {
        nodes.push(h('div', { class: 'cards' }, cards.map(cardButton)));
      } else {
        nodes.push(
          h(
            'div',
            { class: 'box' },
            h('h2', null, '고른 분야의 해설이 아직 없어요'),
            h('p', null, '알림 탭에서 받아볼 분야를 바꿔 보세요.'),
            h('button', { class: 'btn ghost', type: 'button', onclick: () => go('/alerts') }, '분야 바꾸기')
          )
        );
      }
      nodes.push(h('p', { class: 'note' }, AI_NOTE));
    }
    setView(nodes, keepScroll);
  }

  // ---------- 해설 ----------
  function shareCard(c) {
    const url = (CFG.siteUrl || '') + '#/t/' + encodeURIComponent(c.id);
    const text = `'${c.keyword}' 왜 뜨지? ${c.line}`;
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
      const subject = `[왜뜨지 신고] ${c.keyword}`;
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
    // 해설을 연 화면(오늘/사전)으로 돌아가요. 링크로 바로 들어왔다면 오늘 화면으로 가요.
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
    document.title = `${c.keyword} – 왜뜨지?`;
    const nodes = [
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'back', type: 'button', onclick: backToList }, icon('left', 22), '뒤로'),
        h('button', { class: 'iconbtn', type: 'button', 'aria-label': '공유', onclick: () => shareCard(c) }, icon('share', 22))
      ),
      h('span', { class: 'pill' }, c.cat),
      h('h1', { class: 'dh1' }, h('span', { class: 'hl' }, c.keyword)),
      h('p', { class: 'dline' }, c.line),
      section('뜻', h('p', null, c.meaning)),
      section('왜 뜨지?', c.why.map((t, i) => h('div', { class: 'why' }, h('span', { class: 'n' }, String(i + 1)), h('span', { class: 't' }, t))))
    ];
    if (c.example) nodes.push(section('이렇게 써요 (예시)', h('div', { class: 'bubble' }, c.example)));
    nodes.push(section('출처', sourceList(c), h('p', { class: 'note', style: 'margin:10px 4px 0' }, AI_NOTE)));
    nodes.push(h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => shareCard(c) }, '친구에게 공유하기'), reportArea(c)));
    setView(nodes, keepScroll);
  }

  // ---------- 사전 ----------
  function matchTerm(c, needle) {
    if (!needle) return true;
    return [c.keyword, c.line, c.cat, c.meaning].some((t) => String(t).toLowerCase().includes(needle));
  }

  function renderDict() {
    document.title = '사전 – 왜뜨지?';
    if (S.termsState !== 'ok') {
      if (S.termsState === 'error') S.termsState = 'idle'; // 다시 들어오면 한 번 더 시도해요
      loadTerms().then(() => view.contains(list) && drawList());
    }

    const list = h('div', { class: 'tlist' });
    const empty = h('p', { class: 'note', role: 'status' });
    const input = h('input', {
      id: 'termq',
      type: 'search',
      placeholder: '모르는 말을 검색해 보세요',
      value: S.q,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      oninput: (e) => {
        S.q = e.target.value;
        drawList();
      }
    });
    input.value = S.q;

    function drawList() {
      list.textContent = '';
      empty.textContent = '';
      if (S.termsState === 'loading' || S.termsState === 'idle') {
        empty.textContent = '사전을 불러오고 있어요…';
        return;
      }
      if (S.termsState === 'error' && !S.terms) {
        empty.textContent = '사전을 불러오지 못했어요. 인터넷 연결을 확인하고 다시 들어와 주세요.';
        return;
      }
      const needle = S.q.trim().toLowerCase();
      const hits = S.terms.terms.filter((c) => matchTerm(c, needle));
      hits.forEach((c) =>
        list.appendChild(
          h(
            'button',
            { class: 'term', type: 'button', onclick: () => go('/t/' + encodeURIComponent(c.id)) },
            h('span', { class: 'row' }, h('span', { class: 'nm' }, c.keyword), h('span', { class: 'tg' }, c.cat)),
            h('span', { class: 'ml', style: 'display:block' }, c.line)
          )
        )
      );
      if (!hits.length) empty.textContent = needle ? '검색 결과가 없어요. 다른 말로 찾아보세요.' : '아직 해설한 말이 없어요.';
    }

    setView([
      h('h1', { class: 'h2big' }, '사전'),
      h('p', { class: 'sub' }, '지금까지 해설한 말을 모아뒀어요'),
      h('label', { for: 'termq', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap' }, '모르는 말 검색'),
      h('div', { class: 'field' }, icon('search', 20), input),
      list,
      empty
    ]);
    drawList();
  }

  // ---------- 알림 ----------
  function saveAlert() {
    store.set('alertOn', S.alertOn);
    store.set('hour', S.hour);
  }

  /** 매일 정한 시각에 알림을 다시 예약해요 (앱에서만) */
  async function applyAlert() {
    const LN = plugin('LocalNotifications');
    if (!LN) return;
    const ID = 1001;
    try {
      await LN.cancel({ notifications: [{ id: ID }] });
      if (!S.alertOn) return;
      const perm = await LN.requestPermissions();
      if (!perm || perm.display !== 'granted') {
        S.alertOn = false;
        S.alertMsg = '알림 권한을 허용해야 받을 수 있어요. 휴대폰 설정에서 허용해 주세요.';
        saveAlert();
        return;
      }
      try {
        await LN.createChannel({ id: 'daily', name: '아침 알림', description: '매일 아침 오늘의 해설을 알려드려요', importance: 3, visibility: 1 });
      } catch (e) {
        /* 채널이 이미 있으면 넘어가요 */
      }
      await LN.schedule({
        notifications: [
          {
            id: ID,
            title: '오늘 뜨는 말',
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
    document.title = '알림 – 왜뜨지?';
    const canNotify = !!plugin('LocalNotifications');

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
          await applyAlert();
          renderAlerts();
        }
      },
      h('span', { style: 'display:block' }, h('span', { class: 'l1' }, '아침 알림'), h('span', { class: 'l2' }, '오늘 뜨는 말이 준비되면 알려드려요')),
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
            if (S.alertOn) await applyAlert();
            renderAlerts();
          }
        },
        hr + '시'
      )
    );

    const groupChips = GROUPS.map((g) =>
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          'aria-pressed': S.picks[g.id] ? 'true' : 'false',
          onclick: () => {
            S.picks[g.id] = !S.picks[g.id];
            store.set('picks', S.picks);
            renderAlerts();
          }
        },
        g.label
      )
    );

    setView(
      [
        h('h1', { class: 'h2big' }, '알림'),
        h('p', { class: 'sub' }, '매일 아침 오늘의 해설이 나왔다고 알려드려요'),
        h('div', { class: 'panel' }, toggle, h('div', { class: 'label' }, '받는 시간'), h('div', { class: 'chips' }, hourChips), S.alertMsg && h('div', { class: 'status warn', role: 'status', style: 'margin-top:14px' }, S.alertMsg)),
        h(
          'div',
          { class: 'panel' },
          h('div', { class: 'ptitle' }, '보고 싶은 분야'),
          h('div', { class: 'chips', style: 'margin-top:12px' }, groupChips),
          h('div', { class: 'info' }, icon('info', 16), h('span', null, '고른 분야만 오늘 화면에 보여요. 정치, 사건사고, 실명 의혹은 다루지 않아요.'))
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
        if (r.name === 'detail') backToList();
        else if (r.name !== 'today') go('/', true);
        else if (App.exitApp) App.exitApp();
      });
    }
    initAds();
    if (S.alertOn) applyAlert(); // 시간대·재부팅 뒤에도 예약이 살아 있게 다시 걸어 둬요
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
      if (document.visibilityState === 'visible' && Date.now() - S.lastLoad > 30 * 60 * 1000) refreshToday(false);
    });

    const cached = store.get('cache.today', null);
    if (okToday(cached)) {
      S.today = cached;
      S.todayState = 'ok';
    }
    route();
    refreshToday(false);
    initNative();
  }

  start();
})();
