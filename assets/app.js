// 화면: 첫 화면, 로그인, 사용자/관리자 대시보드, 신청자 페이지, 신청 완료
(function () {
  const API = window.API;
  const T = API.T;
  const CFG = window.APP_CONFIG || {};
  const $app = document.getElementById("app");
  const $modal = document.getElementById("modal-root");
  const $toast = document.getElementById("toast");

  const state = {
    me: null,
    tab: "open",
    weekStart: null, // 사용자 편집 격자의 주 시작일
    pubWeek: 0, // 신청자 격자의 주 번호
    lastBooking: null,
  };

  // ---------- 작은 도구 ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const pad = (n) => String(n).padStart(2, "0");
  const dayStart = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const addMin = (d, n) => new Date(T.ms(d) + n * 60000);
  const atTime = (d, hhmm) => { const [h, m] = hhmm.split(":").map(Number); const x = dayStart(d); x.setHours(h, m, 0, 0); return x; };
  const fmtDay = (d) => { d = new Date(d); return `${d.getMonth() + 1}월 ${d.getDate()}일(${WD[d.getDay()]})`; };
  const fmtTime = (d) => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtRange = (s, e) => `${fmtDay(s)} ${fmtTime(s)}~${fmtTime(e)}`;
  const sameDay = (a, b) => dayStart(a).getTime() === dayStart(b).getTime();
  const mondayOf = (d) => { const x = dayStart(d); const w = (x.getDay() + 6) % 7; return addDays(x, -w); };
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
      // 클립보드가 막힌 환경: 직접 선택해서 복사하도록 창을 띄웁니다.
      openModal(`<div class="sheet-body"><h2 class="section-title">직접 복사해 주세요</h2>
        <p class="small muted">아래 내용을 길게 눌러 전체 선택 후 복사해 주세요.</p>
        <div class="field"><textarea id="copy-fallback" rows="8">${esc(text)}</textarea></div>
        <div class="form-actions"><button class="btn" data-close>닫기</button></div></div>`);
      const ta = document.getElementById("copy-fallback");
      ta.focus(); ta.select();
      return false;
    }
  }

  // 휴대폰 공유창(카카오톡 선택 가능). 공유창이 없으면 복사로 대신합니다.
  async function shareText(text, title) {
    if (navigator.share) {
      try { await navigator.share({ title: title || "홍보 일정 안내", text }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    const ok = await copyText(text, "복사했어요. 카카오톡 대화창에 붙여넣어 주세요.");
    if (ok) setTimeout(() => toast("복사했어요. 카카오톡 대화창에 붙여넣어 주세요."), 0);
  }

  function fillTemplate(tpl, vars) {
    return String(tpl || "").replace(/\{(학교명|담당자|일시|장소|대상|사용자|연락처|링크|페이지제목|요청사항)\}/g, (_, k) => (vars[k] == null || vars[k] === "" ? "-" : vars[k]));
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
    $modal.innerHTML = `<div class="modal-back" data-close-back><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const back = $modal.firstElementChild;
    back.addEventListener("click", (e) => {
      if (e.target === back || e.target.closest("[data-close]")) closeModal();
    });
    const first = $modal.querySelector("button, input, textarea, select");
    if (first) first.focus();
  }
  function closeModal() { $modal.innerHTML = ""; }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  // ---------- 공통 틀 ----------
  function chrome(inner, opts = {}) {
    const me = state.me;
    const demoBar = API.demo
      ? `<div class="demo-bar"><div class="wrap"><span>체험 모드예요. 데이터는 이 브라우저에만 저장되고 구글 캘린더 일정은 예시입니다.</span><button type="button" id="demo-reset">예시 데이터로 되돌리기</button></div></div>`
      : "";
    const right = opts.publicView
      ? ""
      : me
        ? `<span class="who">${esc(me.name || me.email)}${me.role === "admin" ? " · 관리자" : ""}</span>
           <a class="btn btn-sm" href="#/app">내 시트</a>
           <button class="btn btn-sm btn-ghost" id="logout">로그아웃</button>`
        : `<a class="btn btn-sm" href="#/login">로그인</a>`;
    $app.innerHTML = `${demoBar}
      <header class="topbar"><div class="wrap">
        <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>홍보 예약 시트</a>
        <div class="top-actions">${right}</div>
      </div></header>
      <main>${inner}</main>
      <footer class="footer"><div class="wrap"><span>학교 홍보 방문 예약</span><span class="ver" title="배포일 ${esc(CFG.RELEASED || "")}">v${esc(CFG.VERSION || "1.0")}</span></div></footer>`;
    const lo = document.getElementById("logout");
    if (lo) lo.onclick = async () => { await API.signOut(); state.me = null; location.hash = "#/"; route(); };
    const rs = document.getElementById("demo-reset");
    if (rs) rs.onclick = async () => { await API.resetDemo(); toast("예시 데이터로 되돌렸어요."); route(); };
  }

  function loading(msg) {
    chrome(`<div class="wrap sheet-page"><div class="sheet"><div class="sheet-head"></div><div class="sheet-body"><p class="muted">${esc(msg || "불러오는 중…")}</p></div></div></div>`);
  }

  // ---------- 첫 화면 ----------
  function viewHome() {
    chrome(`
      <section class="hero">
        <span class="blob a"></span><span class="blob b"></span><span class="dot c"></span><span class="dot d"></span><span class="dot e"></span>
        <div class="wrap hero-inner">
          <h1>학교 홍보 일정,<br>링크 하나로 잡으세요.</h1>
          <p class="lead">내가 열어 둔 시간 중에서 학교 선생님이 직접 날짜와 시간을 고릅니다.<br>내 구글 캘린더 일정과 겹치는 칸은 자동으로 막히고, 확정되면 안내문자가 바로 만들어져요.</p>
          <div class="hero-actions">
            <a class="btn btn-cta" href="${state.me ? "#/app" : "#/login"}">${state.me ? "내 시트 열기" : "시작하기"}</a>
            ${API.demo ? `<a class="btn btn-yellow" href="#/r/kim">신청자 화면 보기</a>` : ""}
          </div>
          <ul class="checks"><li>구글 캘린더 일정 자동 반영</li><li>겹치는 시간 자동 비활성화</li><li>안내문자 복사·카톡 공유</li></ul>
        </div>
      </section>
      <section class="how"><div class="wrap">
        <div class="how-grid">
          <div><span class="cell-ref">A1</span><h3>시간 열기</h3><p>내 시트에서 방문 가능한 칸만 눌러 엽니다. 구글 캘린더에 일정이 있는 칸은 열 수 없어요.</p></div>
          <div><span class="cell-ref">B1</span><h3>링크·QR 보내기</h3><p>내 신청 페이지 링크와 QR을 안내문자와 함께 학교에 보냅니다.</p></div>
          <div><span class="cell-ref">C1</span><h3>확정 안내</h3><p>선생님이 칸을 고르면 바로 확정되고, 일정 안내문자를 복사하거나 카톡으로 보냅니다.</p></div>
        </div>
      </div></section>`);
  }

  // ---------- 로그인 ----------
  function viewLogin() {
    const g = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;
    const body = API.demo
      ? `<p class="muted">체험 모드에서는 구글 로그인 대신 역할을 골라 들어갑니다.</p>
         <div class="row"><button class="btn btn-yellow" id="as-user">사용자로 체험</button><button class="btn btn-lav" id="as-admin">관리자로 체험</button></div>`
      : `<p class="muted">관리자가 등록한 구글 계정으로 로그인해 주세요. 로그인할 때 캘린더의 '바쁨' 시간만 읽도록 허용하면, 일정이 있는 칸이 자동으로 막힙니다. 일정 제목이나 내용은 읽지 않아요.</p>
         <div class="row"><button class="btn google-btn" id="google">${g} Google로 로그인</button></div>`;
    chrome(`<div class="wrap"><div class="center-card"><p class="file-name">login.xlsx</p><div class="sheet"><div class="sheet-head"></div>
      <div class="sheet-body"><div class="title-block"><h1>로그인</h1></div>${body}<p class="error" id="login-err" hidden></p></div></div></div></div>`);
    const err = document.getElementById("login-err");
    const go = async (role) => {
      try {
        state.me = await API.signIn(role);
        if (state.me) { location.hash = "#/app"; }
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    };
    if (API.demo) {
      document.getElementById("as-user").onclick = () => go("user");
      document.getElementById("as-admin").onclick = () => go("admin");
    } else {
      document.getElementById("google").onclick = () => go();
    }
  }

  async function viewNotRegistered() {
    const email = API.sessionEmail ? await API.sessionEmail() : "";
    chrome(`<div class="wrap"><div class="center-card"><div class="sheet"><div class="sheet-head"></div><div class="sheet-body">
      <div class="title-block"><h1>등록되지 않은 계정이에요</h1>
      <p>${esc(email)} 계정은 아직 사용자로 등록되지 않았어요. 관리자에게 이 이메일을 등록해 달라고 요청한 뒤 다시 로그인해 주세요.</p></div>
      <div class="row"><button class="btn" id="out">다른 계정으로 로그인</button></div></div></div></div></div>`);
    document.getElementById("out").onclick = async () => { await API.signOut(); location.hash = "#/login"; };
  }

  // ---------- 사용자 대시보드 ----------
  const TABS = [
    ["open", "열린 시간"],
    ["bookings", "예약 목록"],
    ["share", "공유"],
    ["settings", "페이지 설정"],
  ];

  async function viewApp(tab) {
    if (!state.me) { location.hash = "#/login"; return; }
    if (!state.me.active) {
      chrome(`<div class="wrap"><div class="center-card"><div class="sheet"><div class="sheet-head"></div><div class="sheet-body"><h1>사용이 정지된 계정이에요</h1><p class="muted">관리자에게 문의해 주세요.</p></div></div></div></div>`);
      return;
    }
    const tabs = TABS.concat(state.me.role === "admin" ? [["admin", "관리자"]] : []);
    state.tab = tabs.some(([k]) => k === tab) ? tab : "open";
    chrome(`<div class="wrap sheet-page">
      <p class="file-name">${esc(state.me.slug)}_홍보예약.xlsx</p>
      <div class="sheet"><div class="sheet-head"></div><div class="sheet-body" id="pane"></div></div>
      <nav class="tabs" role="tablist" aria-label="내 시트 메뉴">
        ${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === state.tab}" data-tab="${k}">${l}</button>`).join("")}
      </nav></div>`);
    document.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => { location.hash = "#/app/" + b.dataset.tab; }; });
    const pane = document.getElementById("pane");
    try {
      if (state.tab === "open") await paneOpen(pane);
      else if (state.tab === "bookings") await paneBookings(pane);
      else if (state.tab === "share") paneShare(pane);
      else if (state.tab === "settings") paneSettings(pane);
      else if (state.tab === "admin") await paneAdmin(pane);
    } catch (e) {
      pane.innerHTML = `<p class="error">${esc(e.message)}</p>`;
    }
  }

  // 하루의 칸 목록
  function rowsFor(p) {
    const unit = Number(p.slot_minutes) || 30;
    const [sh, sm] = (p.day_start || "09:00").split(":").map(Number);
    const [eh, em] = (p.day_end || "18:00").split(":").map(Number);
    const out = [];
    for (let m = sh * 60 + sm; m + unit <= eh * 60 + em; m += unit) out.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    return out;
  }

  function gridTable(days, rows, cellHtml) {
    const today = new Date();
    return `<div class="grid-scroll"><table class="slots">
      <thead><tr><th class="corner"></th>${days.map((d, i) => `<th class="${sameDay(d, today) ? "today" : ""}"><span class="col">${COLS[i]}</span>${fmtDay(d)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r, ri) => `<tr><th class="rowh" scope="row"><span class="n">${ri + 1}</span>${r}</th>${days.map((d, di) => `<td>${cellHtml(d, r, di, ri)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  // 열린 시간 편집
  async function paneOpen(pane) {
    const p = state.me;
    if (!state.weekStart) state.weekStart = mondayOf(new Date());
    const from = state.weekStart;
    const to = addDays(from, 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const rows = rowsFor(p);
    const unit = Number(p.slot_minutes) || 30;
    pane.innerHTML = `<p class="muted">불러오는 중…</p>`;
    const [open, busy, bookings] = await Promise.all([
      API.listOpen(from.toISOString(), to.toISOString()),
      API.myBusy(from.toISOString(), to.toISOString()).catch(() => []),
      API.listBookings(),
    ]);
    let openSet = T.merge(open);
    const live = bookings.filter((b) => b.status === "confirmed");

    const cellInfo = (d, r) => {
      const s = atTime(d, r), e = addMin(s, unit);
      const bk = live.find((b) => T.overlaps(b.start_at, b.end_at, s, e));
      if (bk) return { s, e, kind: "booked", label: bk.school };
      if (T.ms(s) < Date.now()) return { s, e, kind: "past" };
      const isBusy = busy.some((b) => T.overlaps(b.start_at, b.end_at, s, e));
      const isOpen = T.covered(openSet, s, e);
      if (isBusy) return { s, e, kind: isOpen ? "busy-open" : "busy" };
      return { s, e, kind: isOpen ? "open" : "closed" };
    };

    pane.innerHTML = `
      <div class="title-block"><h1>열린 시간</h1>
        <p>신청자가 고를 수 있게 열어 둘 칸을 눌러 주세요. 다시 누르면 닫힙니다. 끌어서 여러 칸을 한 번에 바꿀 수 있어요.\n구글 캘린더 일정이 있는 칸과 이미 예약된 칸은 신청자 화면에서 자동으로 비활성화돼요.</p></div>
      <div class="grid-tools">
        <div class="week-nav"><button class="btn btn-sm" id="prev" aria-label="이전 주">◀</button><strong>${fmtDay(from)} 주</strong><button class="btn btn-sm" id="next" aria-label="다음 주">▶</button></div>
        <div class="row"><button class="btn btn-sm btn-yellow" id="open-week">평일 전부 열기</button><button class="btn btn-sm" id="close-week">이번 주 모두 닫기</button></div>
      </div>
      <div class="legend"><span><i class="sw-open"></i>열림</span><span><i class="sw-closed"></i>닫힘</span><span><i class="sw-busy"></i>구글 일정</span><span><i class="sw-booked"></i>예약됨</span></div>
      <div id="grid"></div>
      <p class="grid-note">${p.google_connected ? "구글 캘린더 연결됨 · 바쁜 시간만 읽어 와요." : "구글 캘린더가 아직 연결되지 않았어요. 로그아웃 후 다시 로그인하면서 캘린더 접근을 허용해 주세요."} 한 칸 = ${unit}분, 한 번 방문 = ${p.duration_minutes}분</p>`;

    const $grid = pane.querySelector("#grid");
    const draw = () => {
      $grid.innerHTML = gridTable(days, rows, (d, r) => {
        const c = cellInfo(d, r);
        const dis = c.kind === "booked" || c.kind === "past" || c.kind === "busy";
        const label = c.kind === "booked" ? esc(c.label) : c.kind === "busy" || c.kind === "busy-open" ? "일정" : "";
        const aria = `${fmtDay(d)} ${r} ${({ open: "열림", closed: "닫힘", busy: "구글 일정", "busy-open": "열림, 구글 일정 있음", booked: "예약됨", past: "지난 시간" })[c.kind]}`;
        return `<button type="button" class="slot s-${c.kind === "past" ? "closed s-past" : c.kind}" data-d="${d.toISOString()}" data-r="${r}" aria-label="${esc(aria)}" ${dis ? "disabled" : ""}>${label}</button>`;
      });
    };
    draw();

    let saveTimer = null;
    const persist = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try { await API.saveOpen(from.toISOString(), to.toISOString(), openSet); toast("저장했어요."); }
        catch (e) { toast(e.message); }
      }, 500);
    };
    const setCell = (s, e, makeOpen) => {
      if (makeOpen) openSet = T.merge(openSet.concat([{ start_at: s.toISOString(), end_at: e.toISOString() }]));
      else {
        const S = T.ms(s), E = T.ms(e);
        const next = [];
        for (const x of openSet) {
          const a = T.ms(x.start_at), b = T.ms(x.end_at);
          if (b <= S || a >= E) { next.push(x); continue; }
          if (a < S) next.push({ start_at: x.start_at, end_at: new Date(S).toISOString() });
          if (b > E) next.push({ start_at: new Date(E).toISOString(), end_at: x.end_at });
        }
        openSet = T.merge(next);
      }
    };

    // 누르고 끌어서 칠하기
    let paint = null;
    const cellFrom = (el) => (el && el.classList && el.classList.contains("slot") && !el.disabled ? el : null);
    const apply = (el) => {
      const s = atTime(new Date(el.dataset.d), el.dataset.r);
      setCell(s, addMin(s, unit), paint);
      const k = cellInfo(new Date(el.dataset.d), el.dataset.r).kind;
      el.className = `slot s-${k}`;
      el.textContent = k === "busy-open" ? "일정" : "";
    };
    $grid.addEventListener("pointerdown", (e) => {
      const el = cellFrom(e.target);
      if (!el) return;
      e.preventDefault();
      const k = cellInfo(new Date(el.dataset.d), el.dataset.r).kind;
      paint = !(k === "open" || k === "busy-open");
      apply(el);
    });
    $grid.addEventListener("pointerover", (e) => { if (paint === null) return; const el = cellFrom(e.target); if (el) apply(el); });
    const end = () => { if (paint !== null) { paint = null; persist(); } };
    window.addEventListener("pointerup", end, { once: false });
    $grid.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = cellFrom(e.target); if (!el) return;
      e.preventDefault();
      const k = cellInfo(new Date(el.dataset.d), el.dataset.r).kind;
      paint = !(k === "open" || k === "busy-open"); apply(el); end();
    });

    pane.querySelector("#prev").onclick = () => { state.weekStart = addDays(from, -7); paneOpen(pane); };
    pane.querySelector("#next").onclick = () => { state.weekStart = addDays(from, 7); paneOpen(pane); };
    pane.querySelector("#open-week").onclick = () => {
      days.forEach((d) => { if (d.getDay() === 0 || d.getDay() === 6) return; rows.forEach((r) => { const s = atTime(d, r); if (T.ms(s) > Date.now()) setCell(s, addMin(s, unit), true); }); });
      draw(); persist();
    };
    pane.querySelector("#close-week").onclick = () => {
      days.forEach((d) => rows.forEach((r) => { const s = atTime(d, r); if (T.ms(s) > Date.now()) setCell(s, addMin(s, unit), false); }));
      draw(); persist();
    };
  }

  // 예약 목록
  async function paneBookings(pane) {
    const list = await API.listBookings();
    const now = Date.now();
    const upcoming = list.filter((b) => T.ms(b.end_at) >= now);
    const past = list.filter((b) => T.ms(b.end_at) < now);
    const item = (b) => `<div class="item ${b.status === "cancelled" ? "cancelled" : ""}">
        <div class="when">${fmtDay(b.start_at)}<small>${fmtTime(b.start_at)}~${fmtTime(b.end_at)}</small></div>
        <div class="meta"><strong>${esc(b.school)}</strong> ${b.status === "cancelled" ? `<span class="pill off">취소됨</span>` : ""}
          <p>${esc(b.contact_name)} · ${esc(b.phone)} · ${esc(b.target || "-")} · ${esc(b.place || state.me.default_place || "-")}</p>
          ${b.request ? `<p>요청: ${esc(b.request)}</p>` : ""}</div>
        <div class="acts">${b.status === "confirmed" ? `<button class="btn btn-sm btn-yellow" data-msg="${b.id}">안내문자</button><button class="btn btn-sm btn-danger" data-cancel="${b.id}">취소</button>` : ""}</div>
      </div>`;
    pane.innerHTML = `<div class="title-block"><h1>예약 목록</h1><p>신청이 들어오면 바로 확정돼요. 확정된 일정의 안내문자를 복사하거나 카톡으로 보낼 수 있어요.</p></div>
      ${upcoming.length ? `<div class="list">${upcoming.map(item).join("")}</div>` : `<div class="empty"><p class="hand">아직 들어온 신청이 없어요.</p><p class="small">공유 탭에서 링크나 QR을 학교에 보내 보세요.</p></div>`}
      ${past.length ? `<h2 class="section-title">지난 방문</h2><div class="list">${past.map(item).join("")}</div>` : ""}`;
    pane.querySelectorAll("[data-msg]").forEach((btn) => {
      btn.onclick = () => {
        const b = list.find((x) => x.id === btn.dataset.msg);
        const text = confirmMessage(state.me, b);
        openModal(`<div class="sheet-head"></div><div class="sheet-body"><h2 class="section-title">${esc(b.school)} 안내문자</h2>
          <div class="field"><label for="msg-edit">보내기 전에 고칠 수 있어요</label><textarea id="msg-edit" rows="11">${esc(text)}</textarea></div>
          <div class="form-actions"><button class="btn" data-close>닫기</button><button class="btn" id="m-copy">복사</button><button class="btn btn-yellow" id="m-share">카톡으로 보내기</button></div></div>`);
        document.getElementById("m-copy").onclick = () => copyText(document.getElementById("msg-edit").value);
        document.getElementById("m-share").onclick = () => shareText(document.getElementById("msg-edit").value);
      };
    });
    pane.querySelectorAll("[data-cancel]").forEach((btn) => {
      btn.onclick = () => {
        const b = list.find((x) => x.id === btn.dataset.cancel);
        openModal(`<div class="sheet-head"></div><div class="sheet-body"><h2 class="section-title">이 예약을 취소할까요?</h2>
          <p>${esc(b.school)} · ${fmtRange(b.start_at, b.end_at)}</p><p class="small muted">취소하면 그 시간은 다시 신청할 수 있는 칸으로 돌아가요. 학교에는 따로 연락해 주세요.</p>
          <div class="form-actions"><button class="btn" data-close>그대로 두기</button><button class="btn btn-coral" id="do-cancel">예약 취소</button></div></div>`);
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
    pane.innerHTML = `<div class="title-block"><h1>신청 페이지 공유</h1><p>이 링크나 QR로 들어온 학교 선생님은 내가 열어 둔 시간 중에서만 신청할 수 있어요.</p></div>
      <div class="share">
        <div class="qr-box"><div id="qr" aria-label="신청 페이지 QR 코드"></div><span class="cap">찍으면 바로 신청!</span><button class="btn btn-sm" id="qr-save">QR 이미지 저장</button></div>
        <div class="stack">
          <div class="field"><label for="share-url">내 신청 페이지 주소</label>
            <div class="link-row"><input id="share-url" readonly value="${esc(url)}"><button class="btn btn-sm" id="copy-url">링크 복사</button><a class="btn btn-sm" href="#/r/${esc(p.slug)}">열어 보기</a></div></div>
          <div class="field"><label>학교에 보낼 안내문자</label><pre class="msg-preview" id="invite">${esc(invite)}</pre>
            <span class="hint">문구는 페이지 설정 탭에서 바꿀 수 있어요.</span></div>
          <div class="row"><button class="btn" id="copy-invite">안내문자 복사</button><button class="btn btn-yellow" id="share-invite">카톡으로 보내기</button></div>
        </div>
      </div>`;
    const box = pane.querySelector("#qr");
    let qrOk = false;
    if (window.QRCode) {
      try { new window.QRCode(box, { text: url, width: 392, height: 392, correctLevel: window.QRCode.CorrectLevel.M }); qrOk = true; }
      catch (e) { qrOk = false; }
    }
    if (!qrOk) box.innerHTML = `<p class="small muted">QR을 만들지 못했어요. 링크를 대신 보내 주세요.</p>`;
    pane.querySelector("#copy-url").onclick = () => copyText(url, "링크를 복사했어요.");
    pane.querySelector("#copy-invite").onclick = () => copyText(invite, "안내문자를 복사했어요.");
    pane.querySelector("#share-invite").onclick = () => shareText(invite, p.page_title);
    pane.querySelector("#qr-save").onclick = () => {
      const c = box.querySelector("canvas");
      const img = box.querySelector("img");
      const src = c ? c.toDataURL("image/png") : img ? img.src : "";
      if (!src) return;
      const a = document.createElement("a");
      a.href = src; a.download = `${p.slug}_신청QR.png`;
      document.body.appendChild(a); a.click(); a.remove();
      toast("QR 이미지를 저장했어요.");
    };
  }

  // 페이지 설정
  function paneSettings(pane) {
    const p = state.me;
    const opt = (vals, cur, fmt) => vals.map((v) => `<option value="${v}" ${String(v) === String(cur) ? "selected" : ""}>${fmt(v)}</option>`).join("");
    const times = [];
    for (let h = 6; h <= 22; h++) for (const m of [0, 30]) times.push(`${pad(h)}:${pad(m)}`);
    pane.innerHTML = `<div class="title-block"><h1>페이지 설정</h1><p>신청자에게 보이는 내용과 시간 단위를 정해요.</p></div>
      <form id="set-form" class="form-grid">
        <div class="field"><label for="f-name">내 이름(안내문자에 표시)</label><input id="f-name" required value="${esc(p.name)}"></div>
        <div class="field"><label for="f-phone">내 연락처</label><input id="f-phone" inputmode="tel" value="${esc(p.contact_phone)}"></div>
        <div class="field full"><label for="f-title">신청 페이지 제목</label><input id="f-title" required value="${esc(p.page_title)}"></div>
        <div class="field full"><label for="f-intro">신청 페이지 안내 문구</label><textarea id="f-intro">${esc(p.page_intro)}</textarea></div>
        <div class="field"><label for="f-unit">시간 칸 단위</label><select id="f-unit">${opt([10, 15, 20, 30, 60], p.slot_minutes, (v) => `${v}분`)}</select></div>
        <div class="field"><label for="f-dur">한 번 방문 시간</label><select id="f-dur">${opt([20, 30, 40, 50, 60, 90, 120, 150, 180], p.duration_minutes, (v) => (v >= 60 ? `${Math.floor(v / 60)}시간${v % 60 ? ` ${v % 60}분` : ""}` : `${v}분`))}</select>
          <span class="hint">칸 단위로 나누어 떨어지게 정해 주세요.</span></div>
        <div class="field"><label for="f-start">하루 시작 시각</label><select id="f-start">${opt(times, p.day_start, (v) => v)}</select></div>
        <div class="field"><label for="f-end">하루 끝 시각</label><select id="f-end">${opt(times, p.day_end, (v) => v)}</select></div>
        <div class="field"><label for="f-ahead">신청 받는 기간</label><select id="f-ahead">${opt([7, 14, 21, 28, 42, 56, 90], p.days_ahead, (v) => `오늘부터 ${v}일`)}</select></div>
        <div class="field"><label for="f-place">기본 장소</label><input id="f-place" placeholder="예: 학교 시청각실" value="${esc(p.default_place)}"></div>
        <div class="field full"><label for="f-slug">신청 페이지 주소 끝부분</label><input id="f-slug" required pattern="[a-z0-9-]{3,30}" value="${esc(p.slug)}">
          <span class="hint">영어 소문자, 숫자, - 만 쓸 수 있어요 (3~30자). 바꾸면 예전 링크와 QR은 더 이상 열리지 않아요.</span></div>
        <div class="field full"><label for="f-invite">학교에 보낼 안내문자 (신청 요청)</label><textarea id="f-invite" rows="7">${esc(p.invite_template || API.DEFAULT_INVITE)}</textarea></div>
        <div class="field full"><label for="f-confirm">확정 안내문자</label><textarea id="f-confirm" rows="9">${esc(p.confirm_template || API.DEFAULT_CONFIRM)}</textarea>
          <span class="hint">넣을 수 있는 값: {학교명} {담당자} {일시} {장소} {대상} {요청사항} {사용자} {연락처} {링크} {페이지제목}</span></div>
        <p class="error full" id="set-err" hidden></p>
        <div class="form-actions full"><button class="btn btn-yellow" type="submit">저장</button></div>
      </form>`;
    const f = pane.querySelector("#set-form");
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = pane.querySelector("#set-err");
      err.hidden = true;
      const v = (id) => pane.querySelector(id).value.trim();
      const unit = Number(v("#f-unit")), dur = Number(v("#f-dur"));
      if (dur % unit !== 0) { err.textContent = "방문 시간이 칸 단위로 나누어 떨어지지 않아요. 예: 30분 칸이면 60분, 90분."; err.hidden = false; return; }
      if (v("#f-start") >= v("#f-end")) { err.textContent = "하루 끝 시각이 시작 시각보다 늦어야 해요."; err.hidden = false; return; }
      if (!/^[a-z0-9-]{3,30}$/.test(v("#f-slug"))) { err.textContent = "주소는 영어 소문자, 숫자, - 로 3~30자여야 해요."; err.hidden = false; return; }
      try {
        state.me = await API.updateProfile({
          name: v("#f-name"), contact_phone: v("#f-phone"), page_title: v("#f-title"), page_intro: pane.querySelector("#f-intro").value,
          slot_minutes: unit, duration_minutes: dur, day_start: v("#f-start"), day_end: v("#f-end"), days_ahead: Number(v("#f-ahead")),
          default_place: v("#f-place"), slug: v("#f-slug"), invite_template: pane.querySelector("#f-invite").value, confirm_template: pane.querySelector("#f-confirm").value,
        });
        toast("저장했어요.");
      } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    };
  }

  // 관리자
  async function paneAdmin(pane) {
    const [allowed, users, all] = await Promise.all([API.listAllowed(), API.listUsers(), API.listAllBookings()]);
    const upcoming = all.filter((b) => b.status === "confirmed" && T.ms(b.end_at) >= Date.now());
    pane.innerHTML = `<div class="title-block"><h1>관리자</h1><p>여기에 등록한 구글 계정만 로그인해서 사용자로 쓸 수 있어요.</p></div>
      <form id="add-form" class="row">
        <div class="field" style="flex:1 1 240px"><label for="a-email">구글 계정 이메일</label><input id="a-email" type="email" required placeholder="name@gmail.com"></div>
        <div class="field"><label for="a-role">역할</label><select id="a-role"><option value="user">사용자</option><option value="admin">관리자</option></select></div>
        <button class="btn btn-yellow" type="submit" style="align-self:end">등록</button>
      </form>
      <div class="table-scroll"><table class="data"><thead><tr><th>등록된 이메일</th><th>역할</th><th>가입</th><th></th></tr></thead><tbody>
        ${allowed.map((a) => { const u = users.find((x) => (x.email || "").toLowerCase() === a.email); return `<tr><td>${esc(a.email)}</td><td><span class="pill ${a.role === "admin" ? "admin" : "on"}">${a.role === "admin" ? "관리자" : "사용자"}</span></td><td>${u ? "가입함" : "아직"}</td><td><button class="btn btn-sm btn-danger" data-rm="${esc(a.email)}">등록 해제</button></td></tr>`; }).join("")}
      </tbody></table></div>
      <h2 class="section-title">사용자</h2>
      <div class="table-scroll"><table class="data"><thead><tr><th>이름</th><th>이메일</th><th>신청 페이지</th><th>캘린더</th><th>상태</th><th></th></tr></thead><tbody>
        ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><a href="#/r/${esc(u.slug)}">/r/${esc(u.slug)}</a></td><td>${u.google_connected ? "연결됨" : "미연결"}</td><td><span class="pill ${u.active ? "on" : "off"}">${u.active ? "사용 중" : "정지"}</span></td>
          <td>${u.id === state.me.id ? "" : `<button class="btn btn-sm" data-act="${u.id}" data-to="${u.active ? "0" : "1"}">${u.active ? "정지" : "다시 사용"}</button>`}</td></tr>`).join("")}
      </tbody></table></div>
      <h2 class="section-title">다가오는 전체 예약 (${upcoming.length}건)</h2>
      ${upcoming.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>일시</th><th>담당</th><th>학교</th><th>선생님</th><th>대상</th></tr></thead><tbody>
        ${upcoming.map((b) => `<tr><td>${fmtRange(b.start_at, b.end_at)}</td><td>${esc(b.owner_name)}</td><td>${esc(b.school)}</td><td>${esc(b.contact_name)} ${esc(b.phone)}</td><td>${esc(b.target || "-")}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><p class="hand">다가오는 예약이 없어요.</p></div>`}`;
    pane.querySelector("#add-form").onsubmit = async (e) => {
      e.preventDefault();
      try { await API.addAllowed(pane.querySelector("#a-email").value, pane.querySelector("#a-role").value); toast("등록했어요."); paneAdmin(pane); }
      catch (e2) { toast(e2.message); }
    };
    pane.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { try { await API.removeAllowed(b.dataset.rm); toast("등록을 해제했어요."); paneAdmin(pane); } catch (e) { toast(e.message); } }; });
    pane.querySelectorAll("[data-act]").forEach((b) => { b.onclick = async () => { try { await API.setUserActive(b.dataset.act, b.dataset.to === "1"); paneAdmin(pane); } catch (e) { toast(e.message); } }; });
  }

  // ---------- 신청자 페이지 ----------
  async function viewPublic(slug) {
    loading();
    let page;
    try { page = await API.publicPage(slug); } catch (e) { page = null; }
    if (!page) {
      chrome(`<div class="wrap"><div class="center-card"><div class="sheet"><div class="sheet-head"></div><div class="sheet-body"><h1>신청 페이지를 찾지 못했어요</h1><p class="muted">주소가 바뀌었거나 닫힌 페이지예요. 링크를 보내 준 분께 다시 문의해 주세요.</p></div></div></div></div>`, { publicView: true });
      return;
    }
    const unit = Number(page.slot_minutes) || 30;
    const dur = Number(page.duration_minutes) || unit;
    const need = Math.max(1, Math.round(dur / unit));
    const first = addDays(dayStart(new Date()), 1);
    const last = addDays(dayStart(new Date()), Number(page.days_ahead) || 28);
    const weeks = Math.max(1, Math.ceil((last - first) / (7 * 86400000)));
    const rows = rowsFor(page);
    let pick = null; // 선택한 시작 시각
    let avail = { open: [], blocked: [] };

    chrome(`<div class="wrap sheet-page">
      <p class="file-name">${esc(page.slug)}_홍보신청.xlsx</p>
      <div class="sheet"><div class="sheet-head"></div><div class="sheet-body">
        <div class="title-block"><span class="tag">신청 즉시 확정</span><h1>${esc(page.page_title || "홍보 방문 신청")}</h1>${page.page_intro ? `<p>${esc(page.page_intro)}</p>` : ""}</div>
        <div class="grid-tools">
          <div class="week-nav"><button class="btn btn-sm" id="pw-prev" aria-label="이전 주">◀</button><strong id="pw-label"></strong><button class="btn btn-sm" id="pw-next" aria-label="다음 주">▶</button></div>
          <div class="legend"><span><i class="sw-open"></i>선택 가능</span><span><i class="sw-pick"></i>내가 고른 시간</span><span><i class="sw-off"></i>선택 불가</span></div>
        </div>
        <div id="pgrid"><p class="muted">시간표를 불러오는 중…</p></div>
        <p class="grid-note">칸을 누르면 그 시각부터 ${dur}분 동안 방문합니다. 방문 담당: ${esc(page.name)}</p>
        <div id="picked"></div>
        <form id="apply" class="form-grid" hidden>
          <div class="field"><label for="p-school">학교명 <span class="req">*</span></label><input id="p-school" required autocomplete="organization"></div>
          <div class="field"><label for="p-name">담당 선생님 성함 <span class="req">*</span></label><input id="p-name" required autocomplete="name"></div>
          <div class="field"><label for="p-phone">연락처 <span class="req">*</span></label><input id="p-phone" required inputmode="tel" autocomplete="tel" placeholder="010-0000-0000"></div>
          <div class="field"><label for="p-target">대상 (학년·인원)</label><input id="p-target" placeholder="예: 3학년 120명"></div>
          <div class="field full"><label for="p-place">장소</label><input id="p-place" placeholder="${esc(page.default_place || "예: 강당, 시청각실")}"></div>
          <div class="field full"><label for="p-req">요청사항</label><textarea id="p-req" placeholder="준비물, 주차, 출입 안내 등"></textarea></div>
          <p class="error full" id="p-err" hidden></p>
          <div class="form-actions full"><button class="btn btn-cta" type="submit" id="p-submit">이 시간으로 신청하기</button></div>
        </form>
      </div></div></div>`, { publicView: true });

    const $grid = document.getElementById("pgrid");
    const $picked = document.getElementById("picked");
    const $form = document.getElementById("apply");

    const canStart = (s) => {
      if (T.ms(s) <= Date.now() || s < first) return false;
      const e = addMin(s, dur);
      if (T.ms(e) > T.ms(atTime(s, page.day_end || "18:00"))) return false;
      if (!T.covered(avail.open, s, e)) return false;
      return !avail.blocked.some((b) => T.overlaps(b.start_at, b.end_at, s, e));
    };

    const showPicked = () => {
      if (!pick) { $picked.innerHTML = ""; $form.hidden = true; return; }
      $picked.innerHTML = `<div class="picked-box"><div><span class="small muted">고른 시간</span><br><strong>${fmtRange(pick, addMin(pick, dur))}</strong></div><button type="button" class="btn btn-sm" id="unpick">다시 고르기</button></div>`;
      document.getElementById("unpick").onclick = () => { pick = null; drawGrid(); showPicked(); };
      $form.hidden = false;
    };

    let days = [];
    const drawGrid = () => {
      $grid.innerHTML = gridTable(days, rows, (d, r) => {
        const s = atTime(d, r);
        const inPick = pick && T.ms(s) >= T.ms(pick) && T.ms(s) < T.ms(addMin(pick, dur));
        const ok = canStart(s);
        const isStart = pick && T.ms(s) === T.ms(pick);
        const label = isStart ? fmtTime(s) : "";
        return `<button type="button" class="slot ${inPick ? "pick" : ""} ${isStart ? "pick-start" : ""}" data-s="${s.toISOString()}" ${ok || inPick ? "" : "disabled"} aria-label="${fmtDay(d)} ${r} ${ok ? "선택 가능" : "선택 불가"}" ${isStart ? 'aria-pressed="true"' : ""}>${label}</button>`;
      });
      $grid.querySelectorAll(".slot:not([disabled])").forEach((b) => {
        b.onclick = () => {
          const s = new Date(b.dataset.s);
          if (!canStart(s)) return;
          pick = s; drawGrid(); showPicked();
          document.getElementById("picked").scrollIntoView({ behavior: "smooth", block: "nearest" });
        };
      });
    };

    const loadWeek = async () => {
      const from = addDays(first, state.pubWeek * 7);
      const to = addDays(from, 7);
      days = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((d) => d <= last);
      document.getElementById("pw-label").textContent = `${fmtDay(from)} ~ ${fmtDay(days[days.length - 1])}`;
      document.getElementById("pw-prev").disabled = state.pubWeek <= 0;
      document.getElementById("pw-next").disabled = state.pubWeek >= weeks - 1;
      $grid.innerHTML = `<p class="muted">시간표를 불러오는 중…</p>`;
      try {
        avail = await API.availability(slug, from.toISOString(), to.toISOString());
        drawGrid();
        const any = $grid.querySelector(".slot:not([disabled])");
        if (!any) $grid.insertAdjacentHTML("beforeend", `<p class="grid-note" style="padding:8px">이 주에는 신청 가능한 시간이 없어요. 다음 주를 확인해 주세요.</p>`);
      } catch (e) {
        $grid.innerHTML = `<p class="error">${esc(e.message)}</p>`;
      }
    };
    document.getElementById("pw-prev").onclick = () => { state.pubWeek = Math.max(0, state.pubWeek - 1); loadWeek(); };
    document.getElementById("pw-next").onclick = () => { state.pubWeek = Math.min(weeks - 1, state.pubWeek + 1); loadWeek(); };
    state.pubWeek = 0;
    await loadWeek();

    $form.onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById("p-err");
      const btn = document.getElementById("p-submit");
      err.hidden = true;
      const v = (id) => document.getElementById(id).value.trim();
      const fields = { school: v("p-school"), contact_name: v("p-name"), phone: v("p-phone"), target: v("p-target"), place: v("p-place") || page.default_place || "", request: v("p-req") };
      if (!/^[0-9+\-\s()]{8,20}$/.test(fields.phone)) { err.textContent = "연락처를 숫자로 입력해 주세요. 예: 010-1234-5678"; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = "신청하는 중…";
      try {
        const r = await API.book(slug, pick.toISOString(), fields);
        state.lastBooking = r;
        try { sessionStorage.setItem("promo-last-booking", JSON.stringify(r)); } catch (e2) { /* 메모리에만 */ }
        location.hash = "#/done";
      } catch (e2) {
        err.textContent = e2.message; err.hidden = false;
        btn.disabled = false; btn.textContent = "이 시간으로 신청하기";
        pick = null; showPicked(); loadWeek();
      }
    };
  }

  // ---------- 신청 완료 ----------
  function phoneSvg() {
    // 손으로 그린 듯한 휴대폰 테두리
    return `<svg class="frame" viewBox="0 0 330 600" aria-hidden="true">
      <path d="M44 14 C120 8 220 10 292 16 C314 18 320 30 320 52 L318 552 C318 576 306 588 284 588 L48 590 C24 590 12 578 12 556 L14 48 C14 26 24 16 44 14 Z" fill="#4fa36d" stroke="#1f2421" stroke-width="5" stroke-linejoin="round"/>
      <path d="M40 80 L292 78 L290 488 L42 490 Z" fill="#fbf9f2" stroke="#1f2421" stroke-width="4" stroke-linejoin="round"/>
      <path d="M140 46 C156 44 176 44 190 46" fill="none" stroke="#1f2421" stroke-width="5" stroke-linecap="round"/>
      <circle cx="120" cy="46" r="5" fill="#1f2421"/>
      <path d="M150 520 C168 516 182 518 186 530 C190 546 184 560 166 562 C148 564 138 552 140 538 C141 528 144 522 150 520 Z" fill="#fbf9f2" stroke="#1f2421" stroke-width="4"/>
    </svg>`;
  }

  function viewDone() {
    let r = state.lastBooking;
    if (!r) { try { r = JSON.parse(sessionStorage.getItem("promo-last-booking") || "null"); } catch (e) { r = null; } }
    if (!r) { location.hash = "#/"; return; }
    const { booking: b, page } = r;
    const text = confirmMessage(page, b);
    chrome(`<div class="wrap sheet-page"><p class="file-name">신청완료.xlsx</p><div class="sheet"><div class="sheet-head"></div><div class="sheet-body">
      <div class="done">
        <div class="stack">
          <span class="tag">확정</span>
          <h1>신청이 완료됐어요</h1>
          <p class="hand">${fmtRange(b.start_at, b.end_at)}<br>${esc(b.school)}에서 만나요!</p>
          <p class="muted">오른쪽 안내문자를 복사해 두시거나 카톡으로 보내 두세요. 일정 변경은 ${esc(page.name)} (${esc(page.contact_phone || "-")})에게 연락해 주세요.</p>
          <div class="done-actions"><button class="btn" id="d-copy">안내문자 복사</button><button class="btn btn-yellow" id="d-share">카톡으로 보내기</button></div>
          <a class="small" href="#/r/${esc(page.slug)}">다른 시간 하나 더 신청하기</a>
        </div>
        <div class="phone">${phoneSvg()}<div class="screen"><span class="chat-head">홍보 일정 안내</span><div class="bubble">${esc(text)}</div></div></div>
      </div></div></div></div>`, { publicView: true });
    document.getElementById("d-copy").onclick = () => copyText(text, "안내문자를 복사했어요.");
    document.getElementById("d-share").onclick = () => shareText(text, page.page_title);
  }

  // ---------- 라우터 ----------
  async function route() {
    closeModal();
    const h = location.hash.replace(/^#\/?/, "");
    const [a, b] = h.split("/");
    if (a === "r" && b) return viewPublic(decodeURIComponent(b));
    if (a === "done") return viewDone();
    if (a === "login") return state.me ? (location.hash = "#/app") : viewLogin();
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
    // 구글 로그인에서 돌아온 직후에는 내 시트로 보냅니다.
    if (state.me && (!location.hash || location.hash === "#/" || location.hash === "#/login")) {
      if (new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname + "#/app");
    }
    route();
  }
  boot();
})();
