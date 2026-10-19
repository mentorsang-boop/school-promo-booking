// 화면: 첫 화면, 로그인, 내 페이지(열린 시간·예약·공유·설정), 관리, 신청자 페이지, 신청 완료
(function () {
  const API = window.API;
  const T = API.T;
  const CFG = window.APP_CONFIG || {};
  const ASSET = Object.assign({
    logo: "assets/logo.svg",
    logoWhite: "assets/logo-white.svg",
    emblem: "assets/emblem.svg",
    emblemWhite: "assets/emblem-white.svg",
  }, window.APP_ASSETS || {});
  const SCHOOL = "인천산업정보학교";
  const MAX_BOOK_MIN = 240; // 신청자가 한 번에 고를 수 있는 최대 시간

  const $app = document.getElementById("app");
  const $modal = document.getElementById("modal-root");
  const $toast = document.getElementById("toast");

  const state = {
    me: null,
    month: null, // 내 페이지 달력의 달
    day: null, // 내 페이지에서 고른 날
    bookDay: null, // 예약 목록에서 고른 날 (없으면 달 전체)
    settingsTab: "basic",
    pubMonth: null,
    lastBooking: null,
  };

  // ---------- 날짜 도구 ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const pad = (n) => String(n).padStart(2, "0");
  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addMin = (d, n) => new Date(T.ms(d) + n * 60000);
  const monthStart = (d) => { const x = dayStart(d); x.setDate(1); return x; };
  const addMonths = (d, n) => { const x = monthStart(d); x.setMonth(x.getMonth() + n); return x; };
  const atTime = (d, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const x = dayStart(d); x.setHours(h, m, 0, 0); return x; };
  const fmtDay = (d) => { d = new Date(d); return `${d.getMonth() + 1}월 ${d.getDate()}일(${WD[d.getDay()]})`; };
  const fmtMonth = (d) => { d = new Date(d); return `${d.getFullYear()}년 ${d.getMonth() + 1}월`; };
  const fmtTime = (d) => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtRange = (s, e) => `${fmtDay(s)} ${fmtTime(s)}~${fmtTime(e)}`;
  const fmtLen = (min) => (min >= 60 ? `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ""}` : `${min}분`);
  const sameDay = (a, b) => dayStart(a).getTime() === dayStart(b).getTime();
  const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
  const pageUrl = (slug) => `${location.origin}${location.pathname}#/r/${encodeURIComponent(slug)}`;

  function toast(msg) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { $toast.hidden = true; }, 2400);
  }

  async function copyText(text, okMsg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(okMsg || "복사했어요.");
      return true;
    } catch (e) {
      openModal(`<div class="card-body"><h2 class="section-title">직접 복사해 주세요</h2>
        <p class="small muted">아래 내용을 길게 눌러 전체 선택한 뒤 복사해 주세요.</p>
        <div class="field"><textarea id="copy-fallback" rows="9">${esc(text)}</textarea></div>
        <div class="form-actions"><button class="btn" data-close>닫기</button></div></div>`);
      const ta = document.getElementById("copy-fallback");
      ta.focus(); ta.select();
      return false;
    }
  }

  // 휴대폰 공유창(카카오톡 선택 가능). 공유창이 없으면 복사로 대신합니다.
  async function shareText(text, title) {
    if (navigator.share) {
      try { await navigator.share({ title: title || `${SCHOOL} 홍보 방문 안내`, text }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    await copyText(text, "복사했어요. 카카오톡 대화창에 붙여넣어 주세요.");
  }

  const VARS = ["학교명", "담당자", "일시", "장소", "대상", "요청사항", "사용자", "연락처", "링크", "페이지제목"];
  function fillTemplate(tpl, vars) {
    return String(tpl || "").replace(new RegExp(`\\{(${VARS.join("|")})\\}`, "g"), (_, k) => (vars[k] == null || vars[k] === "" ? "-" : vars[k]));
  }
  function confirmMessage(page, b) {
    return fillTemplate(page.confirm_template || API.DEFAULT_CONFIRM, {
      학교명: b.school, 담당자: b.contact_name, 일시: fmtRange(b.start_at, b.end_at), 장소: b.place || page.default_place,
      대상: b.target, 사용자: page.name, 연락처: page.contact_phone, 링크: pageUrl(page.slug), 페이지제목: page.page_title, 요청사항: b.request,
    });
  }
  function inviteMessage(p) {
    return fillTemplate(p.invite_template || API.DEFAULT_INVITE, {
      사용자: p.name, 연락처: p.contact_phone, 링크: pageUrl(p.slug), 페이지제목: p.page_title,
    });
  }

  function openModal(html) {
    $modal.innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const back = $modal.firstElementChild;
    back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-close]")) closeModal(); });
    const first = $modal.querySelector("button, input, textarea, select");
    if (first) first.focus();
  }
  function closeModal() { $modal.innerHTML = ""; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // 하루의 시간 칸
  function rowsFor(p) {
    const unit = Number(p.slot_minutes) || 30;
    const [sh, sm] = (p.day_start || "09:00").split(":").map(Number);
    const [eh, em] = (p.day_end || "18:00").split(":").map(Number);
    const out = [];
    for (let m = sh * 60 + sm; m + unit <= eh * 60 + em; m += unit) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    return out;
  }

  // 월 달력. dayFn(d) → { disabled, cls, sub, dots }
  function monthCal(month, dayFn, selected) {
    const first = monthStart(month);
    const lead = first.getDay();
    const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const today = new Date();
    let html = WD.map((w, i) => `<div class="dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("");
    for (let i = 0; i < lead; i++) html += `<div class="day blank" aria-hidden="true"></div>`;
    for (let i = 1; i <= daysIn; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), i);
      const o = dayFn(d) || {};
      const cls = ["day", o.cls || "", d.getDay() === 0 ? "sun" : d.getDay() === 6 ? "sat" : "", sameDay(d, today) ? "today" : "", selected && sameDay(d, selected) ? "selected" : ""].join(" ");
      html += `<button type="button" class="${cls}" data-day="${d.toISOString()}" ${o.disabled ? "disabled" : ""} aria-label="${fmtDay(d)}${o.aria ? " " + o.aria : ""}" ${selected && sameDay(d, selected) ? 'aria-pressed="true"' : ""}>
        <span class="d">${i}</span><span class="dots">${o.dots || ""}</span>${o.sub ? `<span class="sub">${o.sub}</span>` : ""}</button>`;
    }
    return `<div class="cal">${html}</div>`;
  }
  function calHead(month, id, canPrev, canNext) {
    return `<div class="cal-head"><button type="button" class="btn icon-btn" id="${id}-prev" aria-label="이전 달" ${canPrev ? "" : "disabled"}>‹</button>
      <strong>${fmtMonth(month)}</strong><button type="button" class="btn icon-btn" id="${id}-next" aria-label="다음 달" ${canNext ? "" : "disabled"}>›</button></div>`;
  }

  // ---------- 공통 틀 ----------
  function chrome(inner, opts = {}) {
    const me = state.me;
    const demoBar = API.demo
      ? `<div class="demo-bar"><div class="wrap"><span>체험 모드예요. 데이터는 이 브라우저에만 저장됩니다.</span><button type="button" id="demo-reset">예시 데이터로 되돌리기</button></div></div>`
      : "";
    const right = opts.publicView
      ? ""
      : me
        ? `<span class="who">${esc(me.name || me.login_id)} 선생님</span>
           ${me.role === "admin" ? `<a class="btn btn-sm btn-ghost" href="#/admin">관리</a>` : ""}
           <a class="btn btn-sm" href="#/app">내 페이지</a>
           <button class="btn btn-sm btn-ghost" id="logout">로그아웃</button>`
        : `<a class="btn btn-sm btn-ghost" href="#/signup">계정 만들기</a><a class="btn btn-sm" href="#/login">로그인</a>`;
    $app.innerHTML = `${demoBar}
      <header class="topbar" ${opts.publicView ? "hidden" : ""}><div class="wrap">
        <a class="brand" href="${opts.publicView ? "javascript:void(0)" : "#/"}"><img src="${ASSET.logo}" alt="${SCHOOL} Incheon Polytechnic School"><span class="svc">고교 방문 홍보 예약</span></a>
        <div class="top-actions">${right}</div>
      </div></header>
      <main>${inner}</main>
      <footer class="footer"><div class="wrap"><span>${SCHOOL} · 고교 방문 홍보 예약</span><span class="ver" title="배포일 ${esc(CFG.RELEASED || "")}">v${esc(CFG.VERSION || "")}</span></div></footer>`;
    const lo = document.getElementById("logout");
    if (lo) lo.onclick = async () => { await API.signOut(); state.me = null; location.hash = "#/"; route(); };
    const rs = document.getElementById("demo-reset");
    if (rs) rs.onclick = async () => { await API.resetDemo(); toast("예시 데이터로 되돌렸어요."); route(); };
  }
  const simpleCard = (title, body, opts) => chrome(`<div class="wrap"><div class="center-card card"><div class="card-body"><h1 class="section-title">${title}</h1>${body}</div></div></div>`, opts);

  // ---------- 첫 화면 ----------
  function viewHome() {
    chrome(`
      <section class="hero"><img class="mark" src="${ASSET.emblemWhite}" alt="">
        <div class="wrap">
          <span class="eyebrow">${SCHOOL} · 고교 방문 홍보</span>
          <h1>고교 방문 홍보 일정, 링크 하나로 받으세요</h1>
          <p>선생님이 열어 둔 시간 안에서 고등학교 담당 선생님이 직접 날짜와 시간을 고릅니다. 이미 예약된 시간은 자동으로 막히고, 확정되면 안내문자가 바로 만들어져요.</p>
          <div class="hero-actions">
            <a class="btn btn-white btn-lg" href="${state.me ? "#/app" : "#/login"}">${state.me ? "내 페이지 열기" : "시작하기"}</a>
            ${API.demo ? `<a class="btn btn-outline-white btn-lg" href="#/r/kim">신청 화면 미리보기</a>` : ""}
          </div>
          <ul class="checks"><li>예약 겹침 자동 방지</li><li>30분 단위 신청</li><li>안내문자 복사·카카오톡 공유</li></ul>
        </div>
      </section>
      <section class="steps"><div class="wrap"><div class="steps-grid">
        <div class="step"><span class="num">1</span><h3>방문 가능한 시간 열기</h3><p>달력에서 날짜를 골라 방문할 수 있는 시간만 엽니다. 열어 둔 시간에만 신청이 들어와요.</p></div>
        <div class="step"><span class="num">2</span><h3>링크·QR 보내기</h3><p>내 신청 페이지 링크와 QR을 안내문자와 함께 고등학교에 보냅니다.</p></div>
        <div class="step"><span class="num">3</span><h3>확정 안내 보내기</h3><p>담당 선생님이 시간을 고르면 바로 확정되고, 안내문자를 복사하거나 카카오톡으로 보냅니다.</p></div>
      </div></div></section>`);
  }

  // ---------- 로그인 ----------
  async function viewLogin(asAdmin) {
    const next = () => { location.hash = state.me && state.me.role === "admin" && asAdmin ? "#/admin" : "#/app"; };
    let setup = null;
    if (!API.demo) { try { setup = await API.setupStatus(); } catch (e) { setup = null; } }
    if (setup && setup.needs_setup) {
      simpleCard("처음 관리자 계정 만들기", `<p class="muted">아직 관리자 계정이 없어요. 관리자로 쓸 아이디와 비밀번호를 정해 주세요. 이 화면은 처음 한 번만 나와요.</p>
        <form id="setup-form" class="stack">
          <div class="field"><label for="s-name">이름</label><input id="s-name" required autocomplete="name"></div>
          <div class="field"><label for="s-id">아이디</label><input id="s-id" required autocomplete="username" autocapitalize="none" placeholder="영어 소문자·숫자 3~20자"></div>
          <div class="field"><label for="s-pw">비밀번호</label><input id="s-pw" type="password" required minlength="6" autocomplete="new-password" placeholder="6자 이상"></div>
          <p class="error" id="login-err" hidden></p>
          <button class="btn btn-primary" type="submit">관리자 계정 만들기</button>
        </form>`);
      const err = document.getElementById("login-err");
      document.getElementById("setup-form").onsubmit = async (e) => {
        e.preventDefault(); err.hidden = true;
        const v = (id) => document.getElementById(id).value;
        try {
          state.me = await API.setupAdmin({ name: v("s-name").trim(), login_id: v("s-id").trim().toLowerCase(), password: v("s-pw") });
          location.hash = "#/admin";
        } catch (e2) { err.textContent = e2.message; err.hidden = false; }
      };
      return;
    }
    simpleCard("로그인", `
      ${API.demo ? `<p class="muted">체험용 계정: 선생님 <b>kim</b> / <b>1234</b>, 관리자 <b>admin</b> / <b>1234</b></p>` : `<p class="muted">관리자에게 받은 아이디와 비밀번호를 입력해 주세요.</p>`}
      <form id="login-form" class="stack">
        <div class="field"><label for="l-id">아이디</label><input id="l-id" required autocomplete="username" autocapitalize="none" value="${API.demo ? (asAdmin ? "admin" : "kim") : ""}"></div>
        <div class="field"><label for="l-pw">비밀번호</label><input id="l-pw" type="password" required autocomplete="current-password" value="${API.demo ? "1234" : ""}"></div>
        <p class="error" id="login-err" hidden></p>
        <button class="btn btn-primary" type="submit">로그인</button>
      </form>
      <p class="small muted">처음이면 <a href="#/signup">계정 만들기</a> · 비밀번호를 잊었으면 관리자에게 초기화를 요청해 주세요.</p>`);
    const err = document.getElementById("login-err");
    document.getElementById("login-form").onsubmit = async (e) => {
      e.preventDefault(); err.hidden = true;
      try {
        state.me = await API.signIn(document.getElementById("l-id").value, document.getElementById("l-pw").value);
        if (state.me) next();
        else { err.textContent = "사용할 수 없는 계정이에요. 관리자에게 문의해 주세요."; err.hidden = false; await API.signOut(); }
      } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    };
  }

  function viewSignup() {
    simpleCard("계정 만들기", `<p class="muted">홍보 방문을 다니는 선생님이면 누구나 만들 수 있어요. 아이디와 비밀번호는 잊지 않게 적어 두세요.</p>
      <form id="signup-form" class="stack">
        <div class="field"><label for="u-name">이름</label><input id="u-name" required autocomplete="name" placeholder="홍길동"><span class="hint">안내문자에 "인천산업정보학교 ○○○" 으로 들어가요.</span></div>
        <div class="field"><label for="u-id">아이디</label><input id="u-id" required autocomplete="username" autocapitalize="none" placeholder="영어 소문자·숫자 3~20자"><span class="hint">신청 페이지 주소에도 쓰여요.</span></div>
        <div class="field"><label for="u-pw">비밀번호</label><input id="u-pw" type="password" required minlength="6" autocomplete="new-password" placeholder="6자 이상"></div>
        <div class="field"><label for="u-pw2">비밀번호 확인</label><input id="u-pw2" type="password" required autocomplete="new-password"></div>
        <p class="error" id="login-err" hidden></p>
        <button class="btn btn-primary" type="submit">계정 만들기</button>
      </form>
      <p class="small muted">이미 계정이 있으면 <a href="#/login">로그인</a></p>`);
    const err = document.getElementById("login-err");
    document.getElementById("signup-form").onsubmit = async (e) => {
      e.preventDefault(); err.hidden = true;
      const v = (id) => document.getElementById(id).value;
      const show = (m) => { err.textContent = m; err.hidden = false; };
      if (!/^[a-z0-9._-]{3,20}$/.test(v("u-id").trim().toLowerCase())) return show("아이디는 영어 소문자, 숫자, . _ - 로 3~20자여야 해요.");
      if (v("u-pw").length < 6) return show("비밀번호는 6자 이상이어야 해요.");
      if (v("u-pw") !== v("u-pw2")) return show("두 비밀번호가 서로 달라요.");
      try {
        state.me = await API.signUp({ name: v("u-name").trim(), login_id: v("u-id").trim().toLowerCase(), password: v("u-pw") });
        toast("계정을 만들었어요. 먼저 방문 가능한 시간을 열어 주세요.");
        location.hash = "#/app";
      } catch (e2) { show(e2.message); }
    };
  }

  async function viewNotRegistered() {
    simpleCard("사용할 수 없는 계정이에요",
      `<p class="muted">관리자가 만든 계정으로 로그인해 주세요.</p>
       <div class="row"><button class="btn" id="out">다른 계정으로 로그인</button></div>`);
    document.getElementById("out").onclick = async () => { await API.signOut(); location.hash = "#/login"; };
  }

  // ---------- 내 페이지 ----------
  const TABS = [["open", "열린 시간"], ["bookings", "예약 목록"], ["share", "공유"], ["settings", "페이지 설정"]];

  async function viewApp(tab) {
    if (!state.me) { location.hash = "#/login"; return; }
    if (!state.me.active) { simpleCard("사용이 멈춘 계정이에요", `<p class="muted">홍보 담당 부서에 문의해 주세요.</p>`); return; }
    const cur = TABS.some(([k]) => k === tab) ? tab : "open";
    chrome(`<div class="wrap page">
      <div class="page-head"><div><h1>${esc(state.me.name)} 선생님의 홍보 예약</h1><p>신청 페이지: <a href="#/r/${esc(state.me.slug)}">/r/${esc(state.me.slug)}</a></p></div></div>
      <div class="card"><nav class="tabs" role="tablist" aria-label="내 페이지 메뉴" style="padding:0 12px">
        ${TABS.map(([k, l]) => `<button role="tab" aria-selected="${k === cur}" data-tab="${k}">${l}</button>`).join("")}
      </nav><div class="card-body" id="pane"></div></div></div>`);
    document.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => { location.hash = "#/app/" + b.dataset.tab; }; });
    const pane = document.getElementById("pane");
    try {
      if (cur === "open") await paneOpen(pane);
      else if (cur === "bookings") await paneBookings(pane);
      else if (cur === "share") paneShare(pane);
      else paneSettings(pane);
    } catch (e) {
      pane.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  }

  // 열린 시간 (월 달력 → 날짜 선택 → 시간 칩)
  async function paneOpen(pane) {
    const p = state.me;
    const unit = Number(p.slot_minutes) || 30;
    const rows = rowsFor(p);
    if (!state.month) state.month = monthStart(new Date());
    const m0 = state.month, m1 = addMonths(m0, 1);
    if (!state.day || state.day < m0 || state.day >= m1) {
      const t = dayStart(new Date());
      state.day = t >= m0 && t < m1 ? t : m0;
    }
    pane.innerHTML = `<p class="muted">불러오는 중…</p>`;
    const [open, busy, bookings] = await Promise.all([
      API.listOpen(m0.toISOString(), m1.toISOString()),
      API.myBusy(m0.toISOString(), m1.toISOString()).catch(() => []),
      API.listBookings(),
    ]);
    let openSet = T.merge(open);
    const live = bookings.filter((b) => b.status === "confirmed");

    const cell = (d, r) => {
      const s = atTime(d, r), e = addMin(s, unit);
      const bk = live.find((b) => T.overlaps(b.start_at, b.end_at, s, e));
      if (bk) return { s, e, kind: "booked", label: bk.school };
      if (T.ms(s) <= Date.now()) return { s, e, kind: "past" };
      const isBusy = busy.some((b) => T.overlaps(b.start_at, b.end_at, s, e));
      const isOpen = T.covered(openSet, s, e);
      if (isBusy) return { s, e, kind: isOpen ? "busy-open" : "busy" };
      return { s, e, kind: isOpen ? "open" : "closed" };
    };
    const daySummary = (d) => {
      let openMin = 0;
      for (const r of rows) { const c = cell(d, r); if (c.kind === "open") openMin += unit; }
      const bk = live.filter((b) => sameDay(b.start_at, d)).length;
      const bz = busy.some((b) => T.overlaps(b.start_at, b.end_at, d, addDays(d, 1)));
      return { openMin, bk, bz };
    };

    pane.innerHTML = `
      <div class="list-head"><div><h2 class="section-title">열린 시간</h2><p class="hint-line">날짜를 고른 뒤, 방문할 수 있는 시간을 눌러 열어 주세요. 다시 누르면 닫힙니다.</p></div>
        <div class="row"><button class="btn btn-sm btn-soft" id="open-month">이번 달 평일 모두 열기</button><button class="btn btn-sm" id="close-month">이번 달 모두 닫기</button></div></div>
      <div class="cal-wrap">
        <div><div id="cal"></div>
          <div class="legend" style="margin-top:10px"><span><i class="dot" style="width:8px;height:8px;border-radius:50%;background:var(--ok);border:0"></i>열린 시간 있음</span><span><i style="width:8px;height:8px;border-radius:50%;background:var(--brand);border:0"></i>예약</span></div></div>
        <div class="slots-panel" id="panel"></div>
      </div>
      <p class="hint-line">시간 칸은 ${unit}분 단위예요. 단위는 페이지 설정에서 바꿀 수 있어요.</p>`;

    const $cal = pane.querySelector("#cal");
    const $panel = pane.querySelector("#panel");
    const today = dayStart(new Date());

    const drawCal = () => {
      $cal.innerHTML = calHead(m0, "om", true, true) + monthCal(m0, (d) => {
        const past = d < today;
        const s = daySummary(d);
        const dots = (s.openMin ? `<i class="dot open"></i>` : "") + `<i class="dot"></i>`.repeat(Math.min(s.bk, 3)) + (s.bz ? `<i class="dot busy"></i>` : "");
        return { disabled: past, sub: s.openMin ? fmtLen(s.openMin) : "", dots, cls: s.openMin ? "avail" : "" };
      }, state.day);
      $cal.querySelector("#om-prev").onclick = () => { state.month = addMonths(m0, -1); state.day = null; paneOpen(pane); };
      $cal.querySelector("#om-next").onclick = () => { state.month = addMonths(m0, 1); state.day = null; paneOpen(pane); };
      $cal.querySelectorAll(".day[data-day]").forEach((b) => { b.onclick = () => { state.day = new Date(b.dataset.day); drawCal(); drawPanel(); }; });
    };

    const label = { open: "열림", closed: "닫힘", busy: "다른 일정", "busy-open": "다른 일정", booked: "", past: "" };
    const drawPanel = () => {
      const d = state.day;
      const past = d < today;
      $panel.innerHTML = `<div class="list-head"><h3>${fmtDay(d)}</h3>
          ${past ? "" : `<div class="row"><button class="btn btn-sm btn-soft" id="day-open">이 날 모두 열기</button><button class="btn btn-sm" id="day-close">모두 닫기</button></div>`}</div>
        <div class="chips" id="chips">${rows.map((r) => {
          const c = cell(d, r);
          const dis = c.kind === "past" || c.kind === "busy" || c.kind === "booked";
          const sub = c.kind === "booked" ? esc(c.label) : label[c.kind];
          return `<button type="button" class="chip st-${c.kind}" data-r="${r}" ${dis ? "disabled" : ""} aria-label="${r} ${sub || "지난 시간"}">${r}${sub ? `<small>${sub}</small>` : ""}</button>`;
        }).join("")}</div>
        <div class="legend"><span><i class="lg-open"></i>열림</span><span><i class="lg-closed"></i>닫힘</span><span><i class="lg-booked"></i>예약됨</span></div>`;
      const $chips = $panel.querySelector("#chips");
      let paint = null;
      const apply = (el) => {
        const s = atTime(d, el.dataset.r);
        setCell(s, addMin(s, unit), paint);
        const c = cell(d, el.dataset.r);
        el.className = `chip st-${c.kind}`;
        el.innerHTML = `${el.dataset.r}<small>${label[c.kind]}</small>`;
      };
      const chipOf = (t) => { const el = t && t.closest ? t.closest(".chip") : null; return el && !el.disabled ? el : null; };
      $chips.addEventListener("pointerdown", (e) => {
        const el = chipOf(e.target); if (!el) return;
        e.preventDefault();
        const k = cell(d, el.dataset.r).kind;
        paint = !(k === "open" || k === "busy-open");
        apply(el);
      });
      $chips.addEventListener("pointerover", (e) => { if (paint === null) return; const el = chipOf(e.target); if (el) apply(el); });
      $chips.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const el = chipOf(e.target); if (!el) return;
        e.preventDefault();
        const k = cell(d, el.dataset.r).kind; paint = !(k === "open" || k === "busy-open"); apply(el); endPaint();
      });
      const o = $panel.querySelector("#day-open"), c = $panel.querySelector("#day-close");
      if (o) o.onclick = () => { setDay(d, true); drawPanel(); drawCal(); persist(); };
      if (c) c.onclick = () => { setDay(d, false); drawPanel(); drawCal(); persist(); };
      function endPaint() { if (paint !== null) { paint = null; drawCal(); persist(); } }
      window.onpointerup = endPaint;
    };

    function setCell(s, e, makeOpen) {
      if (makeOpen) { openSet = T.merge(openSet.concat([{ start_at: s.toISOString(), end_at: e.toISOString() }])); return; }
      const S = T.ms(s), E = T.ms(e), next = [];
      for (const x of openSet) {
        const a = T.ms(x.start_at), b = T.ms(x.end_at);
        if (b <= S || a >= E) { next.push(x); continue; }
        if (a < S) next.push({ start_at: x.start_at, end_at: new Date(S).toISOString() });
        if (b > E) next.push({ start_at: new Date(E).toISOString(), end_at: x.end_at });
      }
      openSet = T.merge(next);
    }
    function setDay(d, makeOpen) {
      rows.forEach((r) => { const s = atTime(d, r); if (T.ms(s) > Date.now()) setCell(s, addMin(s, unit), makeOpen); });
    }
    let saveTimer = null;
    function persist() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try { await API.saveOpen(m0.toISOString(), m1.toISOString(), openSet); toast("저장했어요."); }
        catch (e) { toast(e.message); }
      }, 500);
    }

    pane.querySelector("#open-month").onclick = () => {
      for (let d = new Date(m0); d < m1; d = addDays(d, 1)) if (!isWeekend(d)) setDay(d, true);
      drawCal(); drawPanel(); persist();
    };
    pane.querySelector("#close-month").onclick = () => {
      for (let d = new Date(m0); d < m1; d = addDays(d, 1)) setDay(d, false);
      drawCal(); drawPanel(); persist();
    };
    drawCal();
    drawPanel();
  }

  // 예약 목록 (월 달력 + 그 달 목록)
  async function paneBookings(pane) {
    if (!state.month) state.month = monthStart(new Date());
    const m0 = state.month, m1 = addMonths(m0, 1);
    const all = await API.listBookings();
    const inMonth = all.filter((b) => T.ms(b.start_at) >= T.ms(m0) && T.ms(b.start_at) < T.ms(m1));
    const confirmed = inMonth.filter((b) => b.status === "confirmed");
    const upcoming = confirmed.filter((b) => T.ms(b.end_at) >= Date.now());
    if (state.bookDay && (state.bookDay < m0 || state.bookDay >= m1)) state.bookDay = null;
    const shown = state.bookDay ? inMonth.filter((b) => sameDay(b.start_at, state.bookDay)) : inMonth;

    const item = (b) => `<div class="item ${b.status === "cancelled" ? "cancelled" : ""}">
        <div class="when"><b>${fmtDay(b.start_at)}</b><span>${fmtTime(b.start_at)}~${fmtTime(b.end_at)}</span></div>
        <div class="meta"><strong>${esc(b.school)}</strong> ${b.status === "cancelled" ? `<span class="badge off">취소됨</span>` : T.ms(b.end_at) < Date.now() ? `<span class="badge off">방문 완료</span>` : `<span class="badge ok">확정</span>`}
          <p>${esc(b.contact_name)} 선생님 · <span style="white-space:nowrap">${esc(b.phone)}</span> · ${esc(b.target || "대상 미입력")} · ${esc(b.place || state.me.default_place || "장소 미입력")}</p>
          ${b.request ? `<p>요청: ${esc(b.request)}</p>` : ""}</div>
        <div class="acts">${b.status === "confirmed" ? `<button class="btn btn-sm btn-soft" data-msg="${b.id}">안내문자</button><button class="btn btn-sm btn-danger" data-cancel="${b.id}">취소</button>` : ""}</div>
      </div>`;

    pane.innerHTML = `
      <div class="list-head"><h2 class="section-title">예약 목록</h2>
        <div class="month-summary"><div class="stat"><b>${confirmed.length}건</b><span>이번 달 확정</span></div><div class="stat"><b>${upcoming.length}건</b><span>남은 방문</span></div><div class="stat"><b>${inMonth.length - confirmed.length}건</b><span>취소</span></div></div></div>
      <div class="stack">
        <div id="bcal" class="bcal"></div>
        <div class="stack">
          <div class="list-head"><h3>${state.bookDay ? fmtDay(state.bookDay) : `${m0.getMonth() + 1}월 전체`} 예약 ${shown.length}건</h3>${state.bookDay ? `<button class="btn btn-sm" id="all-month">${m0.getMonth() + 1}월 전체 보기</button>` : ""}</div>
          ${shown.length ? `<div class="list">${shown.map(item).join("")}</div>` : `<div class="empty-pane">${state.bookDay ? "이 날은 예약이 없어요." : "이 달에는 아직 예약이 없어요. 공유 탭에서 링크나 QR을 보내 보세요."}</div>`}
        </div>
      </div>`;
    const $cal = pane.querySelector("#bcal");
    $cal.innerHTML = calHead(m0, "bm", true, true) + monthCal(m0, (d) => {
      const n = confirmed.filter((b) => sameDay(b.start_at, d)).length;
      return { cls: n ? "avail" : "", dots: `<i class="dot"></i>`.repeat(Math.min(n, 4)), sub: n ? `${n}건` : "", aria: n ? `예약 ${n}건` : "" };
    }, state.bookDay);
    $cal.querySelector("#bm-prev").onclick = () => { state.month = addMonths(m0, -1); state.bookDay = null; paneBookings(pane); };
    $cal.querySelector("#bm-next").onclick = () => { state.month = addMonths(m0, 1); state.bookDay = null; paneBookings(pane); };
    $cal.querySelectorAll(".day[data-day]").forEach((b) => {
      b.onclick = () => { const d = new Date(b.dataset.day); state.bookDay = state.bookDay && sameDay(state.bookDay, d) ? null : d; paneBookings(pane); };
    });
    const am = pane.querySelector("#all-month");
    if (am) am.onclick = () => { state.bookDay = null; paneBookings(pane); };

    pane.querySelectorAll("[data-msg]").forEach((btn) => {
      btn.onclick = () => {
        const b = all.find((x) => x.id === btn.dataset.msg);
        openModal(`<div class="card-body"><h2 class="section-title">${esc(b.school)} 안내문자</h2>
          <div class="field"><label for="msg-edit">보내기 전에 고칠 수 있어요</label><textarea id="msg-edit" rows="12">${esc(confirmMessage(state.me, b))}</textarea></div>
          <div class="form-actions"><button class="btn" data-close>닫기</button><button class="btn" id="m-copy">복사</button><button class="btn btn-kakao" id="m-share">카카오톡으로 보내기</button></div></div>`);
        document.getElementById("m-copy").onclick = () => copyText(document.getElementById("msg-edit").value);
        document.getElementById("m-share").onclick = () => shareText(document.getElementById("msg-edit").value);
      };
    });
    pane.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.onclick = () => {
        const b = all.find((x) => x.id === btn.dataset.cancel);
        openModal(`<div class="card-body"><h2 class="section-title">이 예약을 취소할까요?</h2>
          <p>${esc(b.school)} · ${fmtRange(b.start_at, b.end_at)}</p><p class="small muted">취소하면 그 시간은 다시 신청할 수 있게 열려요. 학교에는 따로 연락해 주세요.</p>
          <div class="form-actions"><button class="btn" data-close>그대로 두기</button><button class="btn btn-primary" id="do-cancel">예약 취소</button></div></div>`);
        document.getElementById("do-cancel").onclick = async () => {
          try { await API.cancelBooking(b.id); closeModal(); toast("예약을 취소했어요."); paneBookings(pane); }
          catch (e) { toast(e.message); }
        };
      };
    });
  }

  // 공유
  function paneShare(pane) {
    const p = state.me;
    const url = pageUrl(p.slug);
    const invite = inviteMessage(p);
    pane.innerHTML = `<div><h2 class="section-title">신청 페이지 공유</h2><p class="hint-line">이 링크나 QR로 들어온 선생님은 내가 열어 둔 시간 안에서만 신청할 수 있어요.</p></div>
      <div class="share">
        <div class="qr-box"><div id="qr" aria-label="신청 페이지 QR 코드"></div><span class="cap">휴대폰 카메라로 찍으면 바로 열려요</span><button class="btn btn-sm" id="qr-save">QR 이미지 저장</button></div>
        <div class="stack">
          <div class="field"><label for="share-url">내 신청 페이지 주소</label>
            <div class="link-row"><input id="share-url" readonly value="${esc(url)}"><button class="btn btn-sm" id="copy-url">링크 복사</button><a class="btn btn-sm" href="#/r/${esc(p.slug)}">열어 보기</a></div></div>
          <div class="field"><span class="label">고등학교에 보낼 안내문자</span><pre class="msg-preview">${esc(invite)}</pre>
            <span class="hint">문구는 페이지 설정 › 안내문자에서 바꿀 수 있어요.</span></div>
          <div class="row"><button class="btn" id="copy-invite">안내문자 복사</button><button class="btn btn-kakao" id="share-invite">카카오톡으로 보내기</button></div>
        </div>
      </div>`;
    const box = pane.querySelector("#qr");
    let ok = false;
    if (window.QRCode) {
      try { new window.QRCode(box, { text: url, width: 392, height: 392, colorDark: "#17254f", correctLevel: window.QRCode.CorrectLevel.M }); ok = true; }
      catch (e) { ok = false; }
    }
    if (!ok) box.innerHTML = `<p class="small muted">QR을 만들지 못했어요. 링크를 대신 보내 주세요.</p>`;
    pane.querySelector("#copy-url").onclick = () => copyText(url, "링크를 복사했어요.");
    pane.querySelector("#copy-invite").onclick = () => copyText(invite, "안내문자를 복사했어요.");
    pane.querySelector("#share-invite").onclick = () => shareText(invite, p.page_title);
    pane.querySelector("#qr-save").onclick = () => {
      const c = box.querySelector("canvas"), img = box.querySelector("img");
      const src = c ? c.toDataURL("image/png") : img ? img.src : "";
      if (!src) return;
      const a = document.createElement("a");
      a.href = src; a.download = `${p.slug}_신청QR.png`;
      document.body.appendChild(a); a.click(); a.remove();
      toast("QR 이미지를 저장했어요.");
    };
  }

  // 페이지 설정 (탭으로 분류)
  const SET_TABS = [["basic", "기본 정보"], ["time", "신청 시간"], ["message", "안내문자"], ["address", "신청 주소"], ["account", "내 계정"]];
  function paneSettings(pane) {
    const p = state.me;
    const opt = (vals, cur, fmt) => vals.map((v) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${fmt(v)}</option>`).join("");
    const times = [];
    for (let h = 6; h <= 22; h++) for (const m of [0, 30]) times.push(`${pad(h)}:${pad(m)}`);
    const helper = (target) => `<div class="chips-help" data-target="${target}">${VARS.map((v) => `<button type="button" data-v="{${v}}">{${v}}</button>`).join("")}</div>`;
    pane.innerHTML = `<div class="list-head"><h2 class="section-title">페이지 설정</h2></div>
      <div class="subtabs" role="tablist">${SET_TABS.map(([k, l]) => `<button type="button" role="tab" data-st="${k}" aria-selected="${k === state.settingsTab}">${l}</button>`).join("")}</div>
      <form id="set-form" class="stack">
        <section data-sec="basic" class="form-grid">
          <div class="field"><label for="f-name">이름 (안내문자에 표시)</label><input id="f-name" required value="${esc(p.name)}"></div>
          <div class="field"><label for="f-phone">연락처</label><input id="f-phone" inputmode="tel" value="${esc(p.contact_phone)}" placeholder="010-0000-0000"></div>
          <div class="field full"><label for="f-title">신청 페이지 제목</label><input id="f-title" required value="${esc(p.page_title)}"></div>
          <div class="field full"><label for="f-intro">신청 페이지 안내 문구</label><textarea id="f-intro">${esc(p.page_intro)}</textarea></div>
          <div class="field full"><label for="f-place">기본 방문 장소</label><input id="f-place" placeholder="예: 학교 시청각실" value="${esc(p.default_place)}"><span class="hint">신청자가 장소를 비워 두면 이 값이 안내문자에 들어가요.</span></div>
        </section>
        <section data-sec="time" class="form-grid">
          <div class="field"><label for="f-unit">시간 칸 단위</label><select id="f-unit">${opt([10, 15, 20, 30, 60], p.slot_minutes, (v) => `${v}분`)}</select><span class="hint">신청자는 이 단위로 시작·끝 시간을 고릅니다.</span></div>
          <div class="field"><label for="f-ahead">신청 받는 기간</label><select id="f-ahead">${opt([7, 14, 21, 28, 42, 56, 90], p.days_ahead, (v) => `오늘부터 ${v}일`)}</select></div>
          <div class="field"><label for="f-start">하루 시작 시각</label><select id="f-start">${opt(times, p.day_start, (v) => v)}</select></div>
          <div class="field"><label for="f-end">하루 끝 시각</label><select id="f-end">${opt(times, p.day_end, (v) => v)}</select></div>
        </section>
        <section data-sec="message" class="stack">
          <div class="field"><label for="f-invite">신청 요청 안내문자 (고등학교에 링크와 함께 보내는 글)</label><textarea id="f-invite" rows="7">${esc(p.invite_template || API.DEFAULT_INVITE)}</textarea>${helper("f-invite")}</div>
          <div class="field"><label for="f-confirm">확정 안내문자 (신청 완료 후 보내는 글)</label><textarea id="f-confirm" rows="10">${esc(p.confirm_template || API.DEFAULT_CONFIRM)}</textarea>${helper("f-confirm")}
            <span class="hint">버튼을 누르면 커서 위치에 값이 들어가요. 보낼 때 실제 내용으로 바뀝니다.</span></div>
        </section>
        <section data-sec="address" class="stack">
          <div class="field"><label for="f-slug">신청 페이지 주소 끝부분</label><input id="f-slug" required value="${esc(p.slug)}">
            <span class="hint">영어 소문자, 숫자, - 만 쓸 수 있어요 (3~30자). 바꾸면 예전에 보낸 링크와 QR은 열리지 않아요.</span></div>
          <p class="small muted">현재 주소: ${esc(pageUrl(p.slug))}</p>
        </section>
        <section data-sec="account" class="stack">
          <p class="muted">아이디: <b>${esc(p.login_id || "")}</b></p>
          <div class="field"><label for="f-pw">새 비밀번호</label><input id="f-pw" type="password" minlength="6" autocomplete="new-password" placeholder="6자 이상"></div>
          <div class="field"><label for="f-pw2">새 비밀번호 확인</label><input id="f-pw2" type="password" autocomplete="new-password"></div>
          <div class="form-actions"><button class="btn btn-primary" type="button" id="pw-save">비밀번호 바꾸기</button></div>
        </section>
        <p class="error" id="set-err" hidden></p>
        <div class="form-actions" id="set-save"><button class="btn btn-primary" type="submit">저장</button></div>
      </form>`;
    const show = () => {
      pane.querySelectorAll("[data-sec]").forEach((s) => { s.hidden = s.dataset.sec !== state.settingsTab; });
      pane.querySelectorAll("[data-st]").forEach((b) => b.setAttribute("aria-selected", b.dataset.st === state.settingsTab));
      pane.querySelector("#set-save").hidden = state.settingsTab === "account";
    };
    pane.querySelector("#pw-save").onclick = async () => {
      const err = pane.querySelector("#set-err");
      err.hidden = true;
      const a = pane.querySelector("#f-pw").value, b = pane.querySelector("#f-pw2").value;
      if (a.length < 6) { err.textContent = "비밀번호는 6자 이상이어야 해요."; err.hidden = false; return; }
      if (a !== b) { err.textContent = "두 비밀번호가 서로 달라요."; err.hidden = false; return; }
      try { await API.changePassword(a); pane.querySelector("#f-pw").value = pane.querySelector("#f-pw2").value = ""; toast("비밀번호를 바꿨어요."); }
      catch (e) { err.textContent = e.message; err.hidden = false; }
    };
    pane.querySelectorAll("[data-st]").forEach((b) => { b.onclick = () => { state.settingsTab = b.dataset.st; show(); }; });
    show();
    pane.querySelectorAll(".chips-help").forEach((box) => {
      box.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-v]"); if (!b) return;
        const ta = document.getElementById(box.dataset.target);
        const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s;
        ta.value = ta.value.slice(0, s) + b.dataset.v + ta.value.slice(en);
        ta.focus(); ta.selectionStart = ta.selectionEnd = s + b.dataset.v.length;
      });
    });
    pane.querySelector("#set-form").onsubmit = async (e) => {
      e.preventDefault();
      const err = pane.querySelector("#set-err");
      err.hidden = true;
      const v = (id) => pane.querySelector(id).value.trim();
      const bad = (tab, msg) => { state.settingsTab = tab; show(); err.textContent = msg; err.hidden = false; };
      if (!v("#f-name") || !v("#f-title")) return bad("basic", "이름과 신청 페이지 제목을 입력해 주세요.");
      if (v("#f-start") >= v("#f-end")) return bad("time", "하루 끝 시각이 시작 시각보다 늦어야 해요.");
      if (!/^[a-z0-9-]{3,30}$/.test(v("#f-slug"))) return bad("address", "주소는 영어 소문자, 숫자, - 로 3~30자여야 해요.");
      try {
        state.me = await API.updateProfile({
          name: v("#f-name"), contact_phone: v("#f-phone"), page_title: v("#f-title"), page_intro: pane.querySelector("#f-intro").value,
          slot_minutes: Number(v("#f-unit")), day_start: v("#f-start"), day_end: v("#f-end"), days_ahead: Number(v("#f-ahead")),
          default_place: v("#f-place"), slug: v("#f-slug"), invite_template: pane.querySelector("#f-invite").value, confirm_template: pane.querySelector("#f-confirm").value,
        });
        toast("저장했어요.");
      } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    };
  }

  // ---------- 관리 (관리자만, 메뉴에 따로 노출) ----------
  // 헷갈리는 글자(0/o, 1/l)를 뺀 임시 비밀번호
  function tempPw() {
    const cs = "abcdefghjkmnpqrstuvwxyz23456789";
    const buf = new Uint32Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => cs[n % cs.length]).join("");
  }
  function showLoginInfo(name, loginId, pw, title) {
    const text = `[${SCHOOL} 홍보 예약] ${name} 선생님 로그인 정보\n주소: ${location.origin}${location.pathname}#/login\n아이디: ${loginId}\n비밀번호: ${pw}\n로그인 후 '페이지 설정 → 내 계정'에서 비밀번호를 바꿔 주세요.`;
    openModal(`<div class="card-body"><h2 class="section-title">${title}</h2>
      <p class="muted">아래 내용을 선생님께 보내 주세요. 이 창을 닫으면 비밀번호는 다시 볼 수 없어요.</p>
      <pre class="msg-preview" style="white-space:pre-wrap;margin:0">${esc(text)}</pre>
      <div class="form-actions"><button class="btn" data-close>닫기</button><button class="btn btn-primary" id="li-copy">복사</button></div></div>`);
    document.getElementById("li-copy").onclick = () => copyText(text, "로그인 정보를 복사했어요.");
  }
  async function viewAdmin() {
    if (!state.me) { location.hash = "#/login/admin"; return; }
    if (state.me.role !== "admin") { location.hash = "#/app"; return; }
    chrome(`<div class="wrap page"><div class="page-head"><div><h1>관리</h1><p>선생님 계정과 전체 예약을 관리합니다.</p></div></div><div id="admin" class="stack"><p class="muted">불러오는 중…</p></div></div>`);
    const box = document.getElementById("admin");
    const draw = async () => {
      const [users, all] = await Promise.all([API.listUsers(), API.listAllBookings()]);
      const upcoming = all.filter((b) => b.status === "confirmed" && T.ms(b.end_at) >= Date.now());
      box.innerHTML = `
        <div class="card"><div class="card-body">
          <h2 class="section-title">선생님 ${users.length}명</h2><p class="hint-line">선생님은 로그인 화면의 '계정 만들기'에서 직접 가입해요. 모르는 계정은 '사용 멈춤'이나 삭제로 정리해 주세요.</p>
          <div class="table-scroll"><table class="data"><thead><tr><th>이름</th><th>아이디</th><th>신청 페이지</th><th>권한</th><th>상태</th><th></th></tr></thead><tbody>
            ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.login_id || "")}</td><td><a href="#/r/${esc(u.slug)}">/r/${esc(u.slug)}</a></td><td>${u.role === "admin" ? "관리자" : "선생님"}</td><td><span class="badge ${u.active ? "ok" : "off"}">${u.active ? "사용 중" : "멈춤"}</span></td>
              <td><div class="row" style="flex-wrap:nowrap"><button class="btn btn-sm" data-reset="${u.id}">비밀번호 초기화</button>${u.id === state.me.id ? "" : `<button class="btn btn-sm" data-act="${u.id}" data-to="${u.active ? "0" : "1"}">${u.active ? "사용 멈춤" : "다시 사용"}</button><button class="btn btn-sm btn-danger" data-del="${u.id}">삭제</button>`}</div></td></tr>`).join("")}
          </tbody></table></div>
        </div></div>
        <div class="card"><div class="card-body">
          <h2 class="section-title">다가오는 전체 예약 ${upcoming.length}건</h2>
          ${upcoming.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>일시</th><th>방문 담당</th><th>학교</th><th>담당 선생님</th><th>대상</th></tr></thead><tbody>
            ${upcoming.map((b) => `<tr><td>${fmtRange(b.start_at, b.end_at)}</td><td>${esc(b.owner_name)}</td><td>${esc(b.school)}</td><td>${esc(b.contact_name)} ${esc(b.phone)}</td><td>${esc(b.target || "-")}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="empty-pane">다가오는 예약이 없어요.</div>`}
        </div></div>`;
      const userOf = (id) => users.find((x) => x.id === id) || {};
      box.querySelectorAll("[data-reset]").forEach((b) => { b.onclick = () => {
        const u = userOf(b.dataset.reset);
        openModal(`<div class="card-body"><h2 class="section-title">${esc(u.name)} 선생님 비밀번호 초기화</h2>
          <div class="field"><label for="r-pw">새 비밀번호</label><input id="r-pw" minlength="6" value="${tempPw()}"></div>
          <p class="error" id="r-err" hidden></p>
          <div class="form-actions"><button class="btn" data-close>취소</button><button class="btn btn-primary" id="r-go">초기화</button></div></div>`);
        document.getElementById("r-go").onclick = async () => {
          const pw = document.getElementById("r-pw").value;
          try { await API.resetPassword(u.id, pw); showLoginInfo(u.name, u.login_id, pw, "비밀번호를 초기화했어요"); }
          catch (e) { const er = document.getElementById("r-err"); er.textContent = e.message; er.hidden = false; }
        };
      }; });
      box.querySelectorAll("[data-del]").forEach((b) => { b.onclick = () => {
        const u = userOf(b.dataset.del);
        openModal(`<div class="card-body"><h2 class="section-title">${esc(u.name)} 선생님 계정 삭제</h2>
          <p class="muted">이 선생님의 신청 페이지, 열린 시간, 예약 기록이 모두 지워지고 되돌릴 수 없어요. 잠시 쉬게 하려면 '사용 멈춤'을 써 주세요.</p>
          <div class="form-actions"><button class="btn" data-close>취소</button><button class="btn btn-danger" id="d-go">삭제</button></div></div>`);
        document.getElementById("d-go").onclick = async () => {
          try { await API.deleteUser(u.id); closeModal(); toast("계정을 삭제했어요."); draw(); } catch (e) { toast(e.message); }
        };
      }; });
      box.querySelectorAll("[data-act]").forEach((b) => { b.onclick = async () => { try { await API.setUserActive(b.dataset.act, b.dataset.to === "1"); draw(); } catch (e) { toast(e.message); } }; });
    };
    try { await draw(); } catch (e) { box.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }

  // ---------- 신청자 페이지 ----------
  async function viewPublic(slug) {
    chrome(`<div class="wrap page"><p class="muted">불러오는 중…</p></div>`, { publicView: true });
    let page;
    try { page = await API.publicPage(slug); } catch (e) { page = null; }
    if (!page) {
      simpleCard("신청 페이지를 찾지 못했어요", `<p class="muted">주소가 바뀌었거나 닫힌 페이지예요. 링크를 보내 준 선생님께 다시 문의해 주세요.</p>`, { publicView: true });
      return;
    }
    const unit = Number(page.slot_minutes) || 30;
    const rows = rowsFor(page);
    const first = addDays(dayStart(new Date()), 1); // 내일부터
    const last = addDays(dayStart(new Date()), Number(page.days_ahead) || 28); // 이 날까지 포함
    const firstMonth = monthStart(first), lastMonth = monthStart(last);
    if (!state.pubMonth || state.pubMonth < firstMonth || state.pubMonth > lastMonth) state.pubMonth = firstMonth;
    let avail = { open: [], blocked: [] };
    let day = null; // 고른 날짜
    let sel = null; // { s, e }

    chrome(`
      <section class="pub-band"><img class="mark" src="${ASSET.emblemWhite}" alt="">
        <div class="wrap"><img class="logo" src="${ASSET.logoWhite}" alt="${SCHOOL}">
          <h1>${esc(page.page_title || "고교 방문 홍보 신청")}</h1>${page.page_intro ? `<p>${esc(page.page_intro)}</p>` : ""}</div></section>
      <div class="wrap pub-main">
        <div class="card"><div class="card-body">
          <div class="list-head"><h2 class="section-title">1. 날짜와 시간 고르기</h2><span class="badge">${unit}분 단위 · 신청 즉시 확정</span></div>
          <div class="cal-wrap"><div id="pcal"></div><div class="slots-panel" id="ppanel"></div></div>
        </div></div>
        <div class="card" id="form-card" hidden><div class="card-body">
          <h2 class="section-title">2. 신청 정보 입력</h2>
          <div id="picked"></div>
          <form id="apply" class="form-grid">
            <div class="field"><label for="p-school">학교명 <span class="req">*</span></label><input id="p-school" required autocomplete="organization" placeholder="예: 인천○○고등학교"></div>
            <div class="field"><label for="p-name">담당 선생님 성함 <span class="req">*</span></label><input id="p-name" required autocomplete="name"></div>
            <div class="field"><label for="p-phone">연락처 <span class="req">*</span></label><input id="p-phone" required inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></div>
            <div class="field"><label for="p-target">대상 (학년·인원)</label><input id="p-target" placeholder="예: 3학년 120명"></div>
            <div class="field full"><label for="p-place">장소</label><input id="p-place" placeholder="${esc(page.default_place || "예: 강당, 시청각실")}"></div>
            <div class="field full"><label for="p-req">요청사항</label><textarea id="p-req" placeholder="준비물, 주차, 출입 안내 등"></textarea></div>
            <p class="error full" id="p-err" hidden></p>
            <div class="form-actions full"><button class="btn btn-primary btn-lg" type="submit" id="p-submit">이 시간으로 신청하기</button></div>
          </form>
        </div></div>
      </div>`, { publicView: true });

    const $cal = document.getElementById("pcal");
    const $panel = document.getElementById("ppanel");
    const $formCard = document.getElementById("form-card");
    const $picked = document.getElementById("picked");

    const cellOk = (s) => {
      if (T.ms(s) <= Date.now() || s < first || s >= addDays(last, 1)) return false;
      const e = addMin(s, unit);
      if (!T.covered(avail.open, s, e)) return false;
      return !avail.blocked.some((b) => T.overlaps(b.start_at, b.end_at, s, e));
    };
    const dayCount = (d) => rows.reduce((n, r) => n + (cellOk(atTime(d, r)) ? 1 : 0), 0);

    const drawPicked = () => {
      if (!sel) { $formCard.hidden = true; return; }
      $formCard.hidden = false;
      $picked.innerHTML = `<div class="picked"><div><span class="lbl">고른 시간</span><strong>${fmtRange(sel.s, sel.e)}</strong><span class="small muted">${fmtLen((sel.e - sel.s) / 60000)}</span></div><button type="button" class="btn btn-sm" id="unpick">다시 고르기</button></div>`;
      document.getElementById("unpick").onclick = () => { sel = null; drawPanel(); drawPicked(); };
    };

    const drawPanel = () => {
      if (!day) {
        $panel.innerHTML = `<div class="empty-pane">달력에서 파란색 날짜를 골라 주세요.</div>`;
        return;
      }
      $panel.innerHTML = `<div class="list-head"><h3>${fmtDay(day)}</h3></div>
        <p class="hint-line">시작 시간을 누르고, 끝나는 칸을 한 번 더 누르면 그만큼 이어서 선택돼요. 회색 칸은 고를 수 없어요.</p>
        <div class="chips">${rows.map((r) => {
          const s = atTime(day, r);
          const ok = cellOk(s);
          const on = sel && T.ms(s) >= T.ms(sel.s) && T.ms(s) < T.ms(sel.e);
          return `<button type="button" class="chip ${on ? "on" : ""}" data-s="${s.toISOString()}" ${ok ? "" : "disabled"} aria-pressed="${on}" aria-label="${r} ${ok ? "선택 가능" : "선택 불가"}">${r}<small>~${fmtTime(addMin(s, unit))}</small></button>`;
        }).join("")}</div>
        <div class="legend"><span><i class="lg-closed"></i>선택 가능</span><span><i class="lg-pick"></i>고른 시간</span><span><i class="lg-off"></i>선택 불가</span></div>`;
      $panel.querySelectorAll(".chip:not([disabled])").forEach((b) => {
        b.onclick = () => {
          const s = new Date(b.dataset.s);
          if (sel && T.ms(s) >= T.ms(sel.e)) {
            // 이어 붙이기: 사이 칸이 모두 가능하고 최대 시간 이내일 때만
            let okAll = true;
            for (let t = new Date(sel.e); t <= s; t = addMin(t, unit)) if (!cellOk(t)) { okAll = false; break; }
            const len = (T.ms(s) + unit * 60000 - T.ms(sel.s)) / 60000;
            if (okAll && len <= MAX_BOOK_MIN) sel = { s: sel.s, e: addMin(s, unit) };
            else { sel = { s, e: addMin(s, unit) }; if (okAll) toast(`한 번에 ${fmtLen(MAX_BOOK_MIN)}까지 신청할 수 있어요.`); }
          } else if (sel && T.ms(s) >= T.ms(sel.s) && T.ms(s) < T.ms(sel.e) && (sel.e - sel.s) > unit * 60000) {
            sel = { s: sel.s, e: addMin(s, unit) }; // 고른 범위 안을 누르면 거기까지 줄이기
          } else {
            sel = { s, e: addMin(s, unit) };
          }
          drawPanel(); drawPicked();
        };
      });
    };

    const drawCal = () => {
      const m = state.pubMonth;
      $cal.innerHTML = calHead(m, "pm", m > firstMonth, m < lastMonth) + monthCal(m, (d) => {
        const n = dayCount(d);
        return { disabled: n === 0, cls: n ? "avail" : "", sub: n ? "가능" : "", aria: n ? "신청 가능" : "신청 불가" };
      }, day);
      $cal.querySelector("#pm-prev").onclick = () => { state.pubMonth = addMonths(m, -1); loadMonth(); };
      $cal.querySelector("#pm-next").onclick = () => { state.pubMonth = addMonths(m, 1); loadMonth(); };
      $cal.querySelectorAll(".day[data-day]:not([disabled])").forEach((b) => {
        b.onclick = () => { day = new Date(b.dataset.day); sel = null; drawCal(); drawPanel(); drawPicked(); };
      });
    };

    async function loadMonth() {
      const m = state.pubMonth;
      const from = new Date(Math.max(T.ms(m), T.ms(first)));
      const to = new Date(Math.min(T.ms(addMonths(m, 1)), T.ms(addDays(last, 1))));
      $cal.innerHTML = `<p class="muted">달력을 불러오는 중…</p>`;
      day = null; sel = null; drawPanel(); drawPicked();
      try {
        avail = to > from ? await API.availability(slug, from.toISOString(), to.toISOString()) : { open: [], blocked: [] };
      } catch (e) {
        $cal.innerHTML = `<p class="error">${esc(e.message)}</p>`;
        return;
      }
      // 이 달에서 처음 가능한 날을 미리 골라 둡니다.
      for (let d = new Date(from); d < to; d = addDays(d, 1)) if (dayCount(d)) { day = dayStart(d); break; }
      drawCal(); drawPanel();
      if (!day) $panel.innerHTML = `<div class="empty-pane">이 달에는 신청 가능한 시간이 없어요.${m < lastMonth ? " 다음 달을 확인해 주세요." : ""}</div>`;
    }
    await loadMonth();

    document.getElementById("apply").onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("p-err");
      const btn = document.getElementById("p-submit");
      err.hidden = true;
      const v = (id) => document.getElementById(id).value.trim();
      const fields = { school: v("p-school"), contact_name: v("p-name"), phone: v("p-phone"), target: v("p-target"), place: v("p-place") || page.default_place || "", request: v("p-req") };
      if (!/^[0-9+\-\s()]{8,20}$/.test(fields.phone)) { err.textContent = "연락처를 숫자로 입력해 주세요. 예: 010-1234-5678"; err.hidden = false; return; }
      if (!sel) { err.textContent = "시간을 먼저 골라 주세요."; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = "신청하는 중…";
      try {
        const r = await API.book(slug, sel.s.toISOString(), sel.e.toISOString(), fields);
        state.lastBooking = r;
        try { sessionStorage.setItem("promo-last-booking", JSON.stringify(r)); } catch (e2) { /* 메모리에만 */ }
        location.hash = "#/done";
      } catch (e2) {
        err.textContent = e2.message; err.hidden = false;
        btn.disabled = false; btn.textContent = "이 시간으로 신청하기";
        await loadMonth();
      }
    };
  }

  // ---------- 신청 완료 ----------
  function viewDone() {
    let r = state.lastBooking;
    if (!r) { try { r = JSON.parse(sessionStorage.getItem("promo-last-booking") || "null"); } catch (e) { r = null; } }
    if (!r) { location.hash = "#/"; return; }
    const { booking: b, page } = r;
    const text = confirmMessage(page, b);
    chrome(`<div class="wrap page"><div class="card"><div class="card-body">
      <div class="done">
        <div class="stack" style="justify-items:start">
          <span class="check" aria-hidden="true">✓</span>
          <h1>신청이 확정됐어요</h1>
          <p class="when">${fmtRange(b.start_at, b.end_at)}</p>
          <p class="muted">${esc(b.school)} · ${esc(b.target || "대상 미입력")} · ${esc(b.place || page.default_place || "장소 미입력")}</p>
          <p class="muted small">아래 안내문자를 복사해 두시거나 카카오톡으로 보내 두세요. 일정 변경은 ${esc(page.name)} 선생님(${esc(page.contact_phone || "-")})께 연락해 주세요.</p>
          <div class="done-actions"><button class="btn" id="d-copy">안내문자 복사</button><button class="btn btn-kakao" id="d-share">카카오톡으로 보내기</button></div>
          <a class="small" href="#/r/${esc(page.slug)}">다른 시간 하나 더 신청하기</a>
        </div>
        <div class="phone" aria-label="안내문자 미리보기"><div class="screen">
          <div class="bar"><img src="${ASSET.emblem}" alt="">${SCHOOL}</div>
          <div class="chat"><span class="from">${SCHOOL}</span><div class="bubble">${esc(text)}</div></div>
        </div></div>
      </div></div></div></div>`, { publicView: true });
    document.getElementById("d-copy").onclick = () => copyText(text, "안내문자를 복사했어요.");
    document.getElementById("d-share").onclick = () => shareText(text, page.page_title);
  }

  // ---------- 라우터 ----------
  async function route() {
    closeModal();
    window.onpointerup = null;
    const [a, b] = location.hash.replace(/^#\/?/, "").split("/");
    if (a === "r" && b) return viewPublic(decodeURIComponent(b));
    if (a === "done") return viewDone();
    if (a === "login") {
      if (state.me) { location.hash = b === "admin" ? "#/admin" : "#/app"; return; }
      return viewLogin(b === "admin");
    }
    if (a === "signup") {
      if (state.me) { location.hash = "#/app"; return; }
      return viewSignup();
    }
    if (a === "admin") return viewAdmin();
    if (a === "app") {
      if (!state.me && !API.demo && API.sessionEmail && (await API.sessionEmail())) return viewNotRegistered();
      return viewApp(b);
    }
    return viewHome();
  }

  async function boot() {
    try { state.me = await API.init(); } catch (e) { state.me = null; }
    API.onAuthChange((me) => { state.me = me; if (me && /^#?\/?(login)?$/.test(location.hash)) location.hash = "#/app"; else route(); });
    window.addEventListener("hashchange", route);
    if (state.me && new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname + "#/app");
    route();
  }
  boot();
})();
