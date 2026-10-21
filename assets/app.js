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
    schoolFilter: "upcoming", // upcoming | past
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
  function fillInvite(tpl, p) {
    return fillTemplate(tpl, { 사용자: p.name, 연락처: p.contact_phone, 링크: pageUrl(p.slug), 페이지제목: p.page_title });
  }
  function inviteMessage(p) { return fillInvite(p.invite_template || API.DEFAULT_INVITE, p); }
  // 공유 탭의 추천 안내문자 ({사용자} {연락처} {링크}는 보낼 때 채워짐)
  // 길찾기: 카카오맵은 웹 주소라 앱이 없어도 열리고, 티맵·네이버지도는 휴대폰에 앱이 있어야 열려요
  function navLinks(sc) {
    if (!(sc.lat && sc.lng)) return [];
    const name = encodeURIComponent(sc.name);
    return [
      { label: "카카오맵", href: `https://m.map.kakao.com/scheme/route?ep=${sc.lat},${sc.lng}&en=${name}&by=CAR` },
      { label: "티맵", href: `tmap://route?goalname=${name}&goalx=${sc.lng}&goaly=${sc.lat}` },
      { label: "네이버지도", href: `nmap://route/car?dlat=${sc.lat}&dlng=${sc.lng}&dname=${name}&appname=${encodeURIComponent(location.hostname || "promo-booking")}` },
    ];
  }
  const navBtns = (sc, cls) => navLinks(sc).map((n) => `<a class="${cls}" href="${esc(n.href)}"${n.href.startsWith("http") ? ` target="_blank" rel="noopener"` : ""}>${n.label}</a>`).join("");
  const RECOMMENDED_INVITES = [
    { title: "처음 연락할 때", when: "진로·위탁 담당 선생님께 첫 인사",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n2학년 학생들의 진로 선택에 도움이 될 위탁교육 과정을 소개드리고자 연락드립니다.\n학과 체험 영상과 졸업생 진로 사례를 30분~1시간 정도 안내해 드릴 수 있습니다.\n\n아래 링크에서 편하신 날짜와 시간을 골라 주시면 바로 확정됩니다.\n{링크}\n\n문의: {사용자} {연락처}\n감사합니다." },
    { title: "짧게 (카톡용)", when: "이미 아는 선생님께 간단히",
      text: "선생님 안녕하세요, 인천산업정보학교 {사용자}입니다 :)\n올해도 홍보 방문 일정 잡아 주시면 찾아뵙겠습니다.\n편하신 시간 골라 주세요 → {링크}" },
    { title: "작년에 다녀온 학교", when: "지난해 방문·입교가 있던 학교",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n작년에 보내 주신 학생들이 저희 학교에서 잘 적응하며 지내고 있습니다. 진심으로 감사드립니다.\n올해도 2학년 학생들에게 과정을 소개해 드리고 싶어 연락드립니다.\n\n방문 일정 신청: {링크}\n문의: {연락처}\n감사합니다." },
    { title: "설명회·학부모 안내", when: "교내 설명회나 학부모 대상 안내",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n학생·학부모 대상 위탁교육 설명회(학과 소개, 입교 절차, 졸업 후 진로)를 진행해 드리고 있습니다.\n대상과 인원을 적어 신청해 주시면 맞춰서 준비하겠습니다.\n\n신청: {링크}\n문의: {사용자} {연락처}" },
    { title: "답이 없을 때 다시", when: "한 번 보냈는데 답이 없을 때",
      text: "선생님 안녕하세요, 인천산업정보학교 {사용자}입니다.\n지난번 안내드린 홍보 방문 건으로 다시 연락드립니다. 바쁜 시기라 짧게 10~20분도 가능합니다.\n편하실 때 아래에서 시간만 골라 주세요.\n{링크}\n감사합니다." },
    { title: "위탁교육 희망 학생이 있는 학교", when: "진로진학 담당 선생님께",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n위탁교육에 관심 있는 학생이 있다고 들어 연락드립니다. 학과별 교육과정, 입교 절차, 졸업 후 진로를 학생과 담당 선생님께 직접 안내해 드리겠습니다.\n\n방문 가능한 날짜를 골라 주세요.\n{링크}\n\n문의: {사용자} {연락처}\n감사합니다." },
    { title: "실습·체험 강조", when: "학과 체험을 보여 주고 싶을 때",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n저희 학교는 학과별 실습 중심 교육으로 학생들이 직접 만들고 체험해 볼 수 있습니다. 학교로 찾아가 실습 영상과 체험 활동을 함께 진행해 드립니다.\n\n편하신 날짜와 시간을 선택해 주세요.\n{링크}\n\n감사합니다." },
    { title: "2학년 부장·담임 선생님께", when: "학급 단위 진로 시간 제안",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n2학년 학급별 진로 시간에 위탁교육 과정을 소개해 드리고자 합니다. 학급 단위로도, 희망 학생만 모아서도 가능합니다.\n\n가능하신 시간을 골라 주세요.\n{링크}\n\n문의: {연락처}\n감사합니다." },
    { title: "바쁜 시기라 짧게", when: "10~20분 짧은 안내 제안",
      text: "선생님 안녕하세요, 인천산업정보학교 {사용자}입니다.\n학사 일정이 바쁘신 시기인 줄 알아, 10~20분 짧은 안내도 가능하도록 준비했습니다.\n편하신 시간만 골라 주세요.\n{링크}\n감사합니다." },
    { title: "전화 드린 뒤 문자", when: "통화 후 링크를 보낼 때",
      text: "안녕하세요, 방금 통화드린 인천산업정보학교 {사용자}입니다.\n말씀드린 홍보 방문 일정은 아래 링크에서 편하신 시간으로 직접 선택해 주시면 바로 확정됩니다.\n{링크}\n통화로 부족한 점은 {연락처}로 편하게 연락 주세요.\n감사합니다." },
    { title: "교장·교감 선생님께", when: "정중하게 요청할 때",
      text: "안녕하십니까, 인천산업정보학교 {사용자}입니다.\n귀교 학생들의 진로 선택에 도움이 되고자 위탁교육 과정 홍보 방문을 요청드립니다. 바쁘신 중에도 일정을 확인해 주시면 감사하겠습니다.\n\n방문 일정 선택: {링크}\n문의: {사용자} {연락처}\n\n감사합니다." },
    { title: "담당 선생님이 바뀌었을 때", when: "새로 업무를 맡으신 선생님께",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n올해 새로 진로·위탁 업무를 맡으셨다고 들었습니다. 지난해에도 학생 진로 안내로 인연이 있어 인사드립니다.\n\n방문 안내가 필요하시면 편하신 시간을 골라 주세요.\n{링크}\n\n문의: {연락처}\n감사합니다." },
    { title: "시험이 끝난 뒤", when: "시험 후 진로 고민 시기",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n시험이 끝나고 진로를 고민하는 시기에 맞춰, 학생들에게 위탁교육 과정을 소개해 드리고자 연락드립니다.\n\n학교 일정에 맞춰 날짜를 골라 주세요.\n{링크}\n\n감사합니다." },
    { title: "진로 행사·학부모 총회와 함께", when: "행사 일정에 맞출 때",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n학부모 총회·진로 행사에 맞춰 위탁교육 안내 부스나 짧은 설명 시간을 운영해 드릴 수 있습니다.\n행사 일정에 맞춰 신청해 주세요.\n{링크}\n\n문의: {사용자} {연락처}\n감사합니다." },
    { title: "날짜를 정하기 어려울 때", when: "여러 날짜 중 고르게 하고 싶을 때",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n방문 날짜를 정하기 어려우시면, 학교 일정에 맞춰 여러 날짜 중 편하신 날을 골라 주시면 됩니다. 점심시간이나 방과 후 시간도 가능합니다.\n{링크}\n\n문의: {연락처}\n감사합니다." },
    { title: "학생·학부모 개별 상담까지", when: "설명 뒤 상담을 함께 하고 싶을 때",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n위탁교육 설명과 함께, 관심 있는 학생·학부모님과 개별 상담도 진행해 드릴 수 있습니다. 상담이 필요하시면 신청 때 요청사항에 적어 주세요.\n\n방문 일정 신청: {링크}\n문의: {사용자} {연락처}\n감사합니다." },
    { title: "새 학기·1학기 초", when: "학기 초 일정 잡을 때",
      text: "안녕하세요, 인천산업정보학교 {사용자}입니다.\n새 학기를 맞아 올해 홍보 방문 일정을 잡고 있습니다. 학교 일정이 정해지시는 대로 편한 날짜를 골라 주세요.\n{링크}\n\n문의: {연락처}\n감사합니다." },
    { title: "편하게 (아는 선생님)", when: "격식 없이 친근하게",
      text: "선생님~ 인천산업정보학교 {사용자}예요 :)\n올해도 학교 홍보 다니는 시기가 왔네요. 시간 되실 때 아래에서 편한 날로 골라 주세요!\n{링크}\n늘 감사합니다." },
  ];
  const RECS_PER = 6;

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
    simpleCard("계정 만들기", `<p class="muted">관리자에게 받은 가입 코드를 넣어 주세요. 아이디와 비밀번호는 잊지 않게 적어 두세요.</p>
      <form id="signup-form" class="stack">
        <div class="field"><label for="u-code">가입 코드</label><input id="u-code" required inputmode="numeric" autocomplete="off" placeholder="관리자에게 받은 코드"></div>
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
        state.me = await API.signUp({ code: v("u-code").trim(), name: v("u-name").trim(), login_id: v("u-id").trim().toLowerCase(), password: v("u-pw") });
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
  const TABS = [["open", "열린 시간"], ["bookings", "예약 목록"], ["schools", "방문 학교"], ["library", "학교 자료"], ["share", "공유"], ["settings", "페이지 설정"]];

  async function viewApp(tab) {
    if (!state.me) { location.hash = "#/login"; return; }
    if (!state.me.active) { simpleCard("사용이 멈춘 계정이에요", `<p class="muted">홍보 담당 부서에 문의해 주세요.</p>`); return; }
    if (tab === "manage") tab = "library"; // 예전 주소
    const cur = TABS.some(([k]) => k === tab) ? tab : "open";
    chrome(`<div class="wrap page">
      <div class="page-head"><div><h1>${esc(state.me.name)} 선생님의 홍보 예약</h1></div></div>
      <div class="card"><nav class="tabs" role="tablist" aria-label="내 페이지 메뉴" style="padding:0 12px">
        ${TABS.map(([k, l]) => `<button role="tab" aria-selected="${k === cur}" data-tab="${k}">${l}</button>`).join("")}
      </nav><div class="card-body" id="pane"></div></div></div>`);
    document.querySelectorAll("[data-tab]").forEach((b) => { b.onclick = () => { location.hash = "#/app/" + b.dataset.tab; }; });
    const pane = document.getElementById("pane");
    try {
      if (cur === "open") await paneOpen(pane);
      else if (cur === "bookings") await paneBookings(pane);
      else if (cur === "schools") await paneSchools(pane);
      else if (cur === "library") await paneLibrary(pane);
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

    const todayD = dayStart(new Date());
    const period = () => {
      const q = state.me;
      return { from: q.book_from || ymdLocal(addDays(todayD, 1)), until: q.book_until || ymdLocal(addDays(todayD, Number(q.days_ahead) || 28)) };
    };
    const periodHint = () => {
      const pr = period(), q = state.me;
      const f = fromYmd(pr.from), u = fromYmd(pr.until);
      const days = Math.round((u - f) / 86400000) + 1;
      return `${fmtDay(f)} ~ ${fmtDay(u)} (${days}일) 사이 날짜만 신청받아요.${q.book_from && q.book_until ? "" : " 비워 둔 칸은 자동으로 정해져요 (첫날은 내일, 마지막 날은 오늘부터 " + (Number(q.days_ahead) || 28) + "일 뒤)."}`;
    };
    let guideOpen = false;
    try { guideOpen = localStorage.getItem("promo-guide-open") === "1"; } catch (e) { /* 저장소 사용 불가 */ }
    pane.innerHTML = `
      <div class="period-card">
        <div class="period-top"><b>신청 받는 기간</b>
          <div class="period-inputs"><input id="pr-from" type="date" aria-label="신청 받는 첫날" value="${esc(p.book_from || "")}"><span>~</span><input id="pr-until" type="date" aria-label="신청 받는 마지막 날" value="${esc(p.book_until || "")}"></div></div>
        <div class="row period-quick"><button type="button" class="btn btn-sm btn-soft" data-pq="14">앞으로 2주</button><button type="button" class="btn btn-sm btn-soft" data-pq="28">앞으로 4주</button><button type="button" class="btn btn-sm btn-soft" data-pq="month">이번 달 끝까지</button><button type="button" class="btn btn-sm" data-pq="reset">비우기</button></div>
        <p class="hint-line" id="pr-hint">${periodHint()}</p>
      </div>
      <div class="list-head"><div><h2 class="section-title">열린 시간</h2><p class="hint-line">날짜를 고른 뒤, 방문할 수 있는 시간을 눌러 열어 주세요. 다시 누르면 닫힙니다.</p></div>
        <div class="row"><button class="btn btn-sm btn-primary" id="timetable">수업시간표로 한 번에 열기</button><button class="btn btn-sm btn-soft" id="open-month">이번 달 평일 모두 열기</button><button class="btn btn-sm" id="close-month">이번 달 모두 닫기</button></div></div>
      <div class="cal-wrap">
        <div><div id="cal"></div>
          <div class="legend" style="margin-top:10px"><span><i class="dot" style="width:8px;height:8px;border-radius:50%;background:var(--ok);border:0"></i>열린 시간 있음</span><span><i style="width:8px;height:8px;border-radius:50%;background:var(--brand);border:0"></i>예약</span><span><i class="lg-out"></i>신청 기간 밖</span></div></div>
        <div class="slots-panel" id="panel"></div>
      </div>
      <p class="hint-line">시간 칸은 ${unit}분 단위예요. 단위는 페이지 설정에서 바꿀 수 있어요. 흐리게 보이는 날짜는 신청 기간 밖이라 신청을 받지 않아요.</p>
      <details class="guide" id="guide" ${guideOpen ? "open" : ""}>
        <summary>홍보 방문 순서와 이 페이지 사용 방법</summary>
        <div class="guide-body">
          <div class="guide-col"><h3>방문 전</h3><ol>
            <li><b>신청 기간 정하기</b><span>위쪽 '신청 받는 기간'에서 첫날과 마지막 날을 골라요.</span></li>
            <li><b>열린 시간 열기</b><span>'수업시간표로 한 번에 열기'를 쓰거나, 달력에서 날짜를 골라 시간을 눌러 열어요.</span></li>
            <li><b>학교에 링크 보내기</b><span>'공유' 탭에서 안내문자를 복사하거나 카카오톡으로 보내요. 추천 문구도 있어요.</span></li>
            <li><b>신청 확인하고 확정 문자 보내기</b><span>신청은 바로 확정돼요. '예약 목록'에서 확인하고 '안내문자'로 확정 문자를 보내요.</span></li>
            <li><b>학교 미리 알아보기</b><span>'학교 자료'에서 학교 레포트(입교 추이, 재학생, 연락처)를 보고 미팅을 준비해요. 길찾기도 있어요.</span></li>
          </ol></div>
          <div class="guide-col"><h3>방문 후</h3><ol class="after" start="6">
            <li><b>지난 방문 보기</b><span>'방문 학교'의 '지난 방문'에서 다녀온 학교를 다시 볼 수 있어요.</span></li>
            <li><b>다음 연락 정하기</b><span>'학교 자료'의 구분을 보고 다시 연락할 학교(신경 써야 할 학교 등)를 정해요. 입교 결과는 최고 관리자가 새 엑셀을 올리면 반영돼요.</span></li>
          </ol>
          <h3>이 페이지 사용 방법</h3>
          <ul class="tips">
            <li>시간 칸을 누르면 열리고, 다시 누르면 닫혀요. 끌어서 여러 칸을 한 번에 바꿀 수 있어요.</li>
            <li>바꾼 내용은 자동으로 저장돼요.</li>
            <li>예약된 시간은 닫을 수 없어요. 예약 목록에서 취소하면 다시 열려요.</li>
            <li>흐리게 보이는 날짜는 신청 기간 밖이라 신청을 받지 않아요.</li>
          </ul></div>
        </div>
      </details>`;

    const $cal = pane.querySelector("#cal");
    const $panel = pane.querySelector("#panel");
    const today = dayStart(new Date());

    const drawCal = () => {
      $cal.innerHTML = calHead(m0, "om", true, true) + monthCal(m0, (d) => {
        const past = d < today;
        const s = daySummary(d);
        const dots = (s.openMin ? `<i class="dot open"></i>` : "") + `<i class="dot"></i>`.repeat(Math.min(s.bk, 3)) + (s.bz ? `<i class="dot busy"></i>` : "");
        const pr = period(), ymd = ymdLocal(d), out = ymd < pr.from || ymd > pr.until;
        return { disabled: past, sub: s.openMin ? fmtLen(s.openMin) : "", dots, cls: `${s.openMin ? "avail" : ""} ${out ? "outside" : ""}` };
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

    pane.querySelector("#guide").addEventListener("toggle", (e) => { try { localStorage.setItem("promo-guide-open", e.target.open ? "1" : "0"); } catch (err) { /* 무시 */ } });
    // 신청 기간: 날짜를 고르는 즉시 저장 (페이지 설정에서 옮겨 옴)
    const $from = pane.querySelector("#pr-from"), $until = pane.querySelector("#pr-until");
    const savePeriod = async (from, until, msg) => {
      if (from && until && from > until) { toast("마지막 날이 첫날보다 빠를 수 없어요."); $from.value = state.me.book_from || ""; $until.value = state.me.book_until || ""; return; }
      try {
        state.me = await API.updateProfile({ book_from: from || null, book_until: until || null });
        $from.value = state.me.book_from || ""; $until.value = state.me.book_until || "";
        pane.querySelector("#pr-hint").textContent = periodHint();
        drawCal();
        toast(msg || "신청 기간을 저장했어요.");
      } catch (e) { toast(e.message); }
    };
    $from.onchange = () => savePeriod($from.value, $until.value);
    $until.onchange = () => savePeriod($from.value, $until.value);
    pane.querySelectorAll("[data-pq]").forEach((b) => { b.onclick = () => {
      const k = b.dataset.pq, tomorrow = addDays(todayD, 1);
      if (k === "reset") return savePeriod("", "", "신청 기간을 비웠어요.");
      let end;
      if (k === "month") {
        end = new Date(todayD.getFullYear(), todayD.getMonth() + 1, 0);
        if (end < tomorrow) end = new Date(todayD.getFullYear(), todayD.getMonth() + 2, 0);
      } else end = addDays(todayD, Number(k));
      savePeriod(ymdLocal(tomorrow), ymdLocal(end));
    }; });
    pane.querySelector("#timetable").onclick = () => openTimetable(() => paneOpen(pane));
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

  // 수업시간표: 요일별 수업 시간을 한 번 표시해 두고, 신청 기간 전체에 '수업 없는 평일 시간 = 열림'으로 일괄 적용
  const WD5 = [1, 2, 3, 4, 5];
  function openTimetable(done) {
    const p = state.me;
    const unit = Number(p.slot_minutes) || 30;
    const rows = rowsFor(p);
    const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
    const toHM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    // 저장 형식: [{ wd: 1~5, s: "09:00", e: "09:50" }]
    const marked = new Set();
    for (const c of p.class_times || []) for (const r of rows) {
      const a = toMin(r);
      if (a < toMin(c.e) && toMin(c.s) < a + unit) marked.add(`${c.wd}-${r}`);
    }
    const toList = () => {
      const out = [];
      for (const wd of WD5) {
        let cur = null;
        for (const r of rows) {
          if (marked.has(`${wd}-${r}`)) { if (cur && cur.e === r) cur.e = toHM(toMin(r) + unit); else { cur = { wd, s: r, e: toHM(toMin(r) + unit) }; out.push(cur); } }
        }
      }
      return out;
    };
    const { first, last } = T.bookRange(p);
    openModal(`<div class="card-body">
      <h2 class="section-title">수업시간표로 한 번에 열기</h2>
      <p class="muted">수업이 있는 칸을 눌러(끌어서 여러 칸) 표시해 주세요. 적용하면 신청 기간의 평일마다 <b>수업이 없는 시간은 열리고, 수업 시간은 닫혀요.</b></p>
      <div class="tt-wrap"><table class="tt"><thead><tr><th></th>${WD5.map((w) => `<th>${WD[w]}</th>`).join("")}</tr></thead><tbody>
        ${rows.map((r) => `<tr><th>${r}</th>${WD5.map((w) => `<td><button type="button" class="tt-cell ${marked.has(`${w}-${r}`) ? "on" : ""}" data-k="${w}-${r}" aria-label="${WD[w]} ${r}"></button></td>`).join("")}</tr>`).join("")}
      </tbody></table></div>
      <div class="legend"><span><i class="lg-class"></i>수업</span><span><i class="lg-open"></i>비어 있음 (열림)</span></div>
      <p class="small muted">적용 기간: ${fmtDay(first)} ~ ${fmtDay(last)} (열린 시간 맨 위 '신청 받는 기간'에서 바꿀 수 있어요). 이 기간에 직접 열고 닫은 시간은 시간표 기준으로 바뀌고, 이미 받은 예약은 그대로예요.</p>
      <p class="error" id="tt-err" hidden></p>
      <div class="form-actions"><button class="btn" data-close>닫기</button><button class="btn" id="tt-save">시간표만 저장</button><button class="btn btn-primary" id="tt-apply">신청 기간에 적용</button></div>
    </div>`);
    const $m = document.getElementById("modal-root");
    let paint = null;
    const apply = (el) => { const on = paint; el.classList.toggle("on", on); if (on) marked.add(el.dataset.k); else marked.delete(el.dataset.k); };
    $m.querySelectorAll(".tt-cell").forEach((el) => {
      el.addEventListener("pointerdown", (e) => { e.preventDefault(); paint = !el.classList.contains("on"); apply(el); });
      el.addEventListener("pointerenter", () => { if (paint !== null) apply(el); });
    });
    $m.querySelector(".tt").addEventListener("pointermove", (e) => {
      if (paint === null || e.pointerType === "mouse") return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el.classList.contains("tt-cell") && el.classList.contains("on") !== paint) apply(el);
    });
    window.onpointerup = () => { paint = null; };
    const err = document.getElementById("tt-err");
    const save = async () => { state.me = await API.updateProfile({ class_times: toList() }); };
    document.getElementById("tt-save").onclick = async () => {
      try { await save(); toast("시간표를 저장했어요."); } catch (e) { err.textContent = e.message; err.hidden = false; }
    };
    document.getElementById("tt-apply").onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        await save();
        const list = toList();
        const intervals = [];
        for (let d = new Date(first); d <= last; d = addDays(d, 1)) {
          if (isWeekend(d)) continue;
          for (const r of rows) {
            if (marked.has(`${d.getDay()}-${r}`)) continue;
            const s0 = atTime(d, r);
            if (T.ms(s0) > Date.now()) intervals.push({ start_at: s0.toISOString(), end_at: addMin(s0, unit).toISOString() });
          }
        }
        await API.saveOpen(first.toISOString(), addDays(last, 1).toISOString(), intervals);
        closeModal();
        toast(`${fmtDay(first)}부터 ${fmtDay(last)}까지 적용했어요.`);
        state.month = monthStart(first); state.day = null;
        done && done(list);
      } catch (e) { err.textContent = e.message; err.hidden = false; ev.target.disabled = false; }
    };
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
        <button type="button" class="btn btn-primary btn-sm" id="phone-add">＋ 전화 예약 등록</button>
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

    pane.querySelector("#phone-add").onclick = () => openPhoneBooking(pane);
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

  // 전화로 받은 예약을 내 계정에 바로 등록 (열린 시간·신청 기간과 상관없이, 겹치는 예약만 막음)
  async function openPhoneBooking(pane) {
    const unit = Number(state.me.slot_minutes) || 30;
    const base = state.bookDay || addDays(dayStart(new Date()), 1);
    const times = [];
    for (let m = 7 * 60; m <= 20 * 60; m += unit) times.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    const timeOpt = (sel) => times.map((t) => `<option value="${t}"${t === sel ? " selected" : ""}>${t}</option>`).join("");
    let schools = [];
    try { schools = await API.listSchools(); } catch (e) { /* 목록 없이도 입력 가능 */ }
    openModal(`<form class="card-body" id="ph-form"><h2 class="section-title">전화 예약 등록</h2>
      <p class="small muted">학교에서 전화로 신청한 방문을 바로 넣어요. 열어 둔 시간이 아니어도 등록돼요.</p>
      <div class="field"><label for="ph-school">학교</label><input id="ph-school" list="ph-schools" required maxlength="100" autocomplete="off" placeholder="학교 이름"><datalist id="ph-schools">${schools.map((x) => `<option value="${esc(x.name)}">`).join("")}</datalist></div>
      <div class="grid-2"><div class="field"><label for="ph-name">담당 선생님</label><input id="ph-name" required maxlength="50"></div>
      <div class="field"><label for="ph-phone">연락처</label><input id="ph-phone" type="tel" inputmode="tel" required placeholder="010-0000-0000"></div></div>
      <div class="field"><label for="ph-date">날짜</label><input id="ph-date" type="date" required value="${ymdLocal(base)}"></div>
      <div class="grid-2"><div class="field"><label for="ph-s">시작</label><select id="ph-s">${timeOpt("10:00")}</select></div>
      <div class="field"><label for="ph-e">끝</label><select id="ph-e">${timeOpt("11:00")}</select></div></div>
      <div class="field"><label for="ph-target">대상 (선택)</label><input id="ph-target" maxlength="100" placeholder="예: 3학년 50명"></div>
      <div class="field"><label for="ph-place">장소 (선택)</label><input id="ph-place" maxlength="100" value="${esc(state.me.default_place || "")}"></div>
      <div class="field"><label for="ph-req">요청사항 (선택)</label><textarea id="ph-req" rows="2" maxlength="1000"></textarea></div>
      <p class="error" id="ph-err" hidden></p>
      <div class="form-actions"><button type="button" class="btn" data-close>닫기</button><button class="btn btn-primary" id="ph-save">예약 등록</button></div></form>`);
    document.getElementById("ph-form").onsubmit = async (e) => {
      e.preventDefault();
      const v = (id) => document.getElementById(id).value.trim();
      const err = document.getElementById("ph-err");
      const at = (t) => { const [h, m] = t.split(":").map(Number); const d = fromYmd(v("ph-date")); d.setHours(h, m, 0, 0); return d; };
      const s = at(v("ph-s")), en = at(v("ph-e"));
      err.hidden = true;
      if (!/^[0-9+\-\s()]{8,20}$/.test(v("ph-phone"))) { err.textContent = "연락처를 숫자로 입력해 주세요. 예: 010-1234-5678"; err.hidden = false; return; }
      if (en <= s) { err.textContent = "끝나는 시간이 시작보다 늦어야 해요."; err.hidden = false; return; }
      const btn = document.getElementById("ph-save");
      btn.disabled = true;
      try {
        const b = await API.addBooking(s.toISOString(), en.toISOString(), { school: v("ph-school"), contact_name: v("ph-name"), phone: v("ph-phone"), target: v("ph-target"), place: v("ph-place"), request: v("ph-req") });
        closeModal(); toast("예약을 등록했어요.");
        state.month = monthStart(s); state.bookDay = dayStart(s);
        await paneBookings(pane);
        openModal(`<div class="card-body"><h2 class="section-title">${esc(b.school)} 안내문자</h2>
          <p class="small muted">전화 받은 선생님께 확정 문자를 보내 드리세요.</p>
          <div class="field"><textarea id="msg-edit" rows="12">${esc(confirmMessage(state.me, b))}</textarea></div>
          <div class="form-actions"><button class="btn" data-close>나중에</button><button class="btn" id="m-copy">복사</button><button class="btn btn-kakao" id="m-share">카카오톡으로 보내기</button></div></div>`);
        document.getElementById("m-copy").onclick = () => copyText(document.getElementById("msg-edit").value);
        document.getElementById("m-share").onclick = () => shareText(document.getElementById("msg-edit").value);
      } catch (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; }
    };
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
      </div>
      <div class="rec-head"><div class="list-head"><div><h2 class="section-title">추천 안내문자</h2><p class="hint-line">상황에 맞는 글을 골라 바로 보내거나, '내 안내문자로 쓰기'를 눌러 위 기본 문구로 바꿀 수 있어요.</p></div>
        <button type="button" class="btn btn-sm btn-soft" id="rec-next">↻ 다른 예시 보기</button></div></div>
      <p class="muted small" id="rec-pos"></p>
      <div class="rec-list" id="rec-list"></div>`;
    const drawRecs = () => {
      const n = RECOMMENDED_INVITES.length;
      const start = (state.recStart || 0) % n;
      const idx = Array.from({ length: RECS_PER }, (_, k) => (start + k) % n);
      pane.querySelector("#rec-pos").textContent = `예시 ${n}개 중 ${idx.map((i) => i + 1).join("·")}번을 보고 있어요. '다른 예시 보기'를 누르면 다음 예시가 나와요.`;
      pane.querySelector("#rec-list").innerHTML = idx.map((i) => { const r = RECOMMENDED_INVITES[i]; return `<div class="rec-card"><div class="rec-title"><b>${esc(r.title)}</b><span class="muted small">${esc(r.when)}</span></div>
        <pre class="msg-preview">${esc(fillInvite(r.text, p))}</pre>
        <div class="row"><button class="btn btn-sm" data-rec-copy="${i}">복사</button><button class="btn btn-sm btn-kakao" data-rec-share="${i}">카카오톡</button><button class="btn btn-sm btn-soft" data-rec-use="${i}">내 안내문자로 쓰기</button></div></div>`; }).join("");
      pane.querySelectorAll("[data-rec-copy]").forEach((b) => { b.onclick = () => copyText(fillInvite(RECOMMENDED_INVITES[b.dataset.recCopy].text, p), "안내문자를 복사했어요."); });
      pane.querySelectorAll("[data-rec-share]").forEach((b) => { b.onclick = () => shareText(fillInvite(RECOMMENDED_INVITES[b.dataset.recShare].text, p), p.page_title); });
      pane.querySelectorAll("[data-rec-use]").forEach((b) => { b.onclick = async () => {
        try { state.me = await API.updateProfile({ invite_template: RECOMMENDED_INVITES[b.dataset.recUse].text }); toast("내 안내문자를 바꿨어요."); paneShare(pane); } catch (e) { toast(e.message); }
      }; });
    };
    pane.querySelector("#rec-next").onclick = () => { state.recStart = ((state.recStart || 0) + RECS_PER) % RECOMMENDED_INVITES.length; drawRecs(); };
    drawRecs();
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
          <p class="small muted full">신청 받는 기간은 '열린 시간' 탭에서 정해요.</p>
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
          slot_minutes: Number(v("#f-unit")), day_start: v("#f-start"), day_end: v("#f-end"),
          default_place: v("#f-place"), slug: v("#f-slug"), invite_template: pane.querySelector("#f-invite").value, confirm_template: pane.querySelector("#f-confirm").value,
        });
        toast("저장했어요.");
      } catch (e2) { err.textContent = e2.message; err.hidden = false; }
    };
  }

  // ---------- 방문 학교 (방문 전 확인) ----------
  const ymdLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYmd = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const dday = (ymd) => {
    const n = Math.round((fromYmd(ymd) - dayStart(new Date())) / 86400000);
    return n === 0 ? "오늘" : n > 0 ? `D-${n}` : "지남";
  };
  const totalIntake = (sc) => (sc.intake || []).reduce((n, x) => n + (Number(x.count) || 0), 0);
  // 입교생 수 추이: 최근 해와 그 전 해 비교 (증가/감소/변화 없음/입교 없음)
  function intakeTrend(sc) {
    const xs = (sc.intake || []).filter((x) => x.count != null);
    if (!xs.length) return null;
    if (xs.every((x) => !x.count)) return { cls: "none", label: "입교 없음", text: `최근 ${xs.length}년 동안 입교한 학생이 없어요.` };
    if (xs.length < 2) return null;
    const a = xs[xs.length - 2], b = xs[xs.length - 1], d = b.count - a.count;
    const flow = xs.slice(-3).map((x) => `${String(x.year).slice(2)}년 ${x.count}명`).join(" → ");
    if (d > 0) return { d, cls: "up", label: `▲ ${d}명 증가`, text: `${flow}, 전년보다 <b>${d}명 증가</b>했어요.` };
    if (d < 0) return { d, cls: "down", label: `▼ ${-d}명 감소`, text: `${flow}, 전년보다 <b>${-d}명 감소</b>했어요.` };
    return { cls: "same", label: "변화 없음", text: `${flow}, 전년과 <b>같아요</b>.` };
  }
  // 학교 구분: 최고 관리자가 정한 구분(mark)이 있으면 그것, 없으면 입교 실적으로 자동
  const CATS = {
    care: { label: "신경 써야 할 학교", short: "신경", color: "#c4372a", desc: "입교가 2명 이상 줄었거나 2년째 없어요" },
    focus: { label: "집중 학교", short: "집중", color: "#2c479d", desc: "최근 3년 입교가 많은 핵심 학교" },
    new: { label: "개척할 학교", short: "개척", color: "#b7791f", desc: "최근 3년 입교가 없어요" },
    steady: { label: "유지 학교", short: "유지", color: "#1f8a5b", desc: "입교가 꾸준하거나 조금씩 오가요" },
  };
  const CAT_ORDER = ["care", "focus", "new", "steady"];
  // 최근 2년 연속 0명인데 그 전에는 입교가 있던 학교
  const stopped = (sc) => { const xs = (sc.intake || []).filter((x) => x.count != null); return xs.length >= 3 && !xs[xs.length - 1].count && !xs[xs.length - 2].count && xs.slice(0, -2).some((x) => x.count > 0); };
  const recentSum = (sc) => (sc.intake || []).filter((x) => x.count != null).slice(-3).reduce((n, x) => n + (Number(x.count) || 0), 0);
  function categorize(list) {
    const sums = list.map(recentSum).filter((n) => n > 0).sort((a, b) => b - a);
    const cut = sums.length ? sums[Math.max(0, Math.ceil(sums.length * 0.2) - 1)] : Infinity; // 상위 20%
    const out = new Map();
    for (const sc of list) {
      let key, why;
      const tr = intakeTrend(sc), sum = recentSum(sc);
      if (CATS[sc.mark]) { key = sc.mark; why = "관리자가 정함"; }
      else if (sum === 0) { key = "new"; why = "최근 3년 입교 0명"; }
      else if (tr && tr.d <= -2) { key = "care"; why = tr.label; }
      else if (stopped(sc)) { key = "care"; why = "2년째 입교 없음"; }
      else if (sum >= cut) { key = "focus"; why = `최근 3년 입교 ${sum}명`; }
      else { key = "steady"; why = tr ? tr.label : `최근 3년 입교 ${sum}명`; }
      out.set(sc, { key, why });
    }
    return out;
  }
  const lastIntake = (sc) => { const xs = (sc.intake || []).filter((x) => x.count != null); return xs[xs.length - 1] || null; };
  const schoolKeys = (sc) => {
    const out = new Set([sc.name, sc.short]);
    if (sc.short && sc.short.startsWith("인천") && sc.short.length > 3) out.add(sc.short.slice(2));
    return [...out].filter((x) => x && x.length >= 2);
  };
  // 예약에 적힌 학교명으로 엑셀 학교 찾기 (가장 길게 맞는 이름 우선: '인천고'보다 '인천고잔고')
  function matchSchool(b, list) {
    const text = String(b.school || "").replace(/\s/g, "");
    let best = null, len = 0;
    for (const sc of list) for (const k of schoolKeys(sc)) if (k.length > len && text.includes(k)) { best = sc; len = k.length; }
    return best;
  }
  const bookingsFor = (sc, all, list) => all.filter((b) => b.status === "confirmed" && matchSchool(b, list) === sc);
  const telLink = (p) => `tel:${String(p).replace(/[^0-9]/g, "")}`;

  // 내 예약 목록에 들어온 학교만, 엑셀 자료와 이어서 보여 줌
  async function paneSchools(pane) {
    pane.innerHTML = `<p class="muted">불러오는 중…</p>`;
    const [list, bookings] = await Promise.all([API.listSchools(), API.listBookings()]);
    const live = bookings.filter((b) => b.status === "confirmed").sort((a, b) => T.ms(a.start_at) - T.ms(b.start_at));
    const now = Date.now();
    const upcoming = live.filter((b) => T.ms(b.end_at) >= now);
    const past = live.filter((b) => T.ms(b.end_at) < now).reverse();
    const draw = () => {
      const xs = state.schoolFilter === "past" ? past : upcoming;
      pane.querySelector("#sc-list").innerHTML = xs.length ? xs.map((b) => {
        const sc = matchSchool(b, list);
        const li = sc ? lastIntake(sc) : null;
        const day = ymdLocal(new Date(b.start_at));
        const inner = `<div class="sc-top"><strong>${esc(sc ? sc.short || sc.name : b.school)}</strong><span class="badge ${T.ms(b.end_at) >= now ? "" : "off"}">${T.ms(b.end_at) >= now ? `${esc(dday(day))} · ` : ""}${fmtDay(b.start_at)}</span></div>
          <div class="sc-meta">${fmtTime(b.start_at)}~${fmtTime(b.end_at)} · ${esc(b.contact_name)} 선생님${b.target ? ` · ${esc(b.target)}` : ""}</div>
          ${sc ? `<div class="sc-nums"><span>재학생 <b>${(sc.current || []).length}</b>명</span><span>${li ? `${li.year} 입교 <b>${li.count}</b>명` : ""}</span><span>2학년 <b>${sc.students ?? "-"}</b>명</span></div>`
            : `<div class="sc-nums"><span>${list.length ? "학교 자료에서 이 학교를 찾지 못했어요." : "학교 자료가 아직 없어요."}</span></div>`}`;
        return sc ? `<a class="sc-card" href="#/school/${sc.no}">${inner}</a>` : `<div class="sc-card">${inner}</div>`;
      }).join("") : `<div class="empty-pane">${state.schoolFilter === "past" ? "지난 방문이 없어요." : "예약된 방문이 없어요. 신청이 들어오면 여기에 학교 정보가 함께 보여요."}</div>`;
      pane.querySelectorAll("[data-sf]").forEach((x) => x.setAttribute("aria-selected", x.dataset.sf === state.schoolFilter));
    };
    pane.innerHTML = `<div class="list-head"><div><h2 class="section-title">방문 학교</h2><p class="hint-line">예약이 들어온 학교예요. 학교를 누르면 방문 전에 볼 내용이 정리돼 있어요.</p></div></div>
      <div class="subtabs" role="tablist">
        <button type="button" role="tab" data-sf="upcoming">다가오는 방문 ${upcoming.length}</button>
        <button type="button" role="tab" data-sf="past">지난 방문 ${past.length}</button>
      </div>
      <div class="sc-list" id="sc-list"></div>`;
    pane.querySelectorAll("[data-sf]").forEach((x) => { x.onclick = () => { state.schoolFilter = x.dataset.sf; draw(); }; });
    state.schoolBack = "schools";
    draw();
  }

  // 지도 (Leaflet + OpenStreetMap, 필요할 때만 불러옴). 학교 구분 색으로 점을 찍고 누르면 레포트로
  async function loadLeaflet() {
    if (window.L) return;
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "assets/vendor/leaflet/leaflet.css"; document.head.appendChild(css);
    await loadScript("assets/vendor/leaflet/leaflet.js");
  }
  // 지도는 한 번만 만들고, 검색·지역을 바꿀 때는 점만 다시 찍음
  async function makeSchoolMap(box) {
    await loadLeaflet();
    const L = window.L;
    const map = L.map(box, { scrollWheelZoom: false }).setView([37.47, 126.68], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(map);
    L.circleMarker([37.4717, 126.6411], { radius: 9, color: "#17254f", weight: 3, fillColor: "#ffffff", fillOpacity: 1 }).addTo(map).bindPopup(`<b>${SCHOOL}</b>`);
    const layer = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 50);
    return {
      update(xs, cats) {
        layer.clearLayers();
        const pts = xs.filter((sc) => sc.lat && sc.lng);
        for (const sc of pts) {
          const c = CATS[(cats.get(sc) || {}).key] || CATS.steady;
          L.circleMarker([sc.lat, sc.lng], { radius: 8, color: "#fff", weight: 2, fillColor: c.color, fillOpacity: 0.95 }).addTo(layer)
            .bindPopup(`<a class="map-pop" href="#/school/${sc.no}"><b>${esc(sc.short || sc.name)}</b><br><span>${esc(c.short)} · ${esc(sc.district || "")}</span><br>레포트 보기 ›</a>${sc.address ? `<div class="map-nav"><div class="muted small">${esc(sc.address)}</div><div class="nav-row">${navBtns(sc, "nav-btn nav-light")}</div></div>` : ""}`);
        }
        // 섬 학교(백령·연평 등)까지 다 맞추면 시내가 너무 작아져서, 육지 학교가 있으면 그쪽에 맞춤 (섬은 축소하면 보임)
        const land = pts.filter((sc) => sc.lng > 126.45);
        const fit = land.length ? land : pts;
        if (fit.length) map.fitBounds(L.latLngBounds(fit.map((sc) => [sc.lat, sc.lng])).pad(0.1), { maxZoom: 14 });
      },
    };
  }

  // 학교 자료: 지도 → 네 가지 구분 → 학교 목록을 한 화면에서. 최고 관리자는 구분·메모를 직접 정할 수 있음
  async function paneLibrary(pane) {
    pane.innerHTML = `<p class="muted">불러오는 중…</p>`;
    const list = await API.listSchools();
    state.schoolBack = "library";
    const owner = !!state.me.owner;
    const norm = (t) => String(t || "").replace(/\s/g, "").toLowerCase();
    const districts = [...new Set(list.map((sc) => sc.district).filter(Boolean))].sort();
    const cats = categorize(list);
    let mapCtl = null, shown = [];
    const card = (sc, showCat) => {
      const li = lastIntake(sc), info = cats.get(sc);
      return `<div class="mg-card" style="--c:${CATS[info.key].color}"><a href="#/school/${sc.no}" class="mg-main">
          <div class="sc-top"><strong>${esc(sc.short || sc.name)}${showCat ? ` <span class="cat-chip" style="--c:${CATS[info.key].color}">${esc(CATS[info.key].short)}</span>` : ""}</strong><span class="muted small">${esc([sc.district, sc.found, sc.gender].filter(Boolean).join(" · "))}</span></div>
          <div class="sc-nums"><span>${esc(info.why)}</span><span>${li ? `${li.year} 입교 <b>${li.count}</b>명` : "입교 기록 없음"}</span><span>재학생 <b>${(sc.current || []).length}</b>명</span></div>
          ${sc.address ? `<div class="sc-address">${esc(sc.address)}</div>` : ""}
          ${sc.memo ? `<div class="mg-memo">${esc(sc.memo)}</div>` : ""}</a>
        <div class="mg-side">${navLinks(sc).length ? `<button class="btn btn-sm btn-soft" data-nav="${sc.no}">길찾기</button>` : ""}${owner ? `<button class="btn btn-sm" data-mark="${sc.no}">구분·메모</button>` : ""}</div></div>`;
    };
    const draw = () => {
      const q = norm(state.libQuery), dq = state.libDistrict || "";
      const xs = list.filter((sc) => (!dq || sc.district === dq) && (!q || norm([sc.name, sc.short, sc.district, sc.found, sc.gender, sc.kind].join(" ")).includes(q)));
      shown = xs;
      if (mapCtl) mapCtl.update(xs, cats);
      const noGeo = xs.filter((sc) => !(sc.lat && sc.lng)).length;
      pane.querySelector("#lib-note").textContent = `${xs.length}개 학교${noGeo ? ` (위치를 모르는 ${noGeo}곳은 지도에 없어요)` : ""} · 점을 누르면 학교 이름이, 이름을 누르면 레포트가 열려요.`;
      const groups = Object.fromEntries(CAT_ORDER.map((k) => [k, []]));
      for (const sc of xs) groups[cats.get(sc).key].push(sc);
      groups.care.sort((a, b) => (intakeTrend(a)?.d ?? 0) - (intakeTrend(b)?.d ?? 0));
      for (const k of ["focus", "new", "steady"]) groups[k].sort((a, b) => recentSum(b) - recentSum(a) || String(a.name).localeCompare(String(b.name), "ko"));
      const cur = CAT_ORDER.includes(state.manageCat) ? state.manageCat : "care";
      const searching = !!q;
      pane.querySelector("#lib-alert").innerHTML = groups.care.length
        ? `<div class="mg-alert"><b>신경 써야 할 학교 ${groups.care.length}곳</b><span>입교가 크게 줄었거나 끊긴 학교예요: ${groups.care.slice(0, 5).map((sc) => esc(sc.short || sc.name)).join(", ")}${groups.care.length > 5 ? " 등" : ""}</span></div>` : "";
      pane.querySelector("#lib-tiles").innerHTML = CAT_ORDER.map((k) => `<button type="button" class="mg-tile" data-cat="${k}" aria-pressed="${!searching && k === cur}" style="--c:${CATS[k].color}"><b>${groups[k].length}</b><span>${CATS[k].label}</span><small>${CATS[k].desc}</small></button>`).join("");
      const rows = searching ? CAT_ORDER.flatMap((k) => groups[k]) : groups[cur];
      pane.querySelector("#lib-sub").innerHTML = searching
        ? `<span>검색 결과 ${rows.length}곳</span>`
        : `<span style="color:${CATS[cur].color}">${CATS[cur].label} ${rows.length}곳</span>`;
      pane.querySelector("#lib-list").innerHTML = rows.length
        ? rows.map((sc) => card(sc, searching)).join("")
        : `<div class="empty-pane">${list.length ? (searching ? "찾는 학교가 없어요. 이름 일부만 넣어 보세요." : "해당하는 학교가 없어요.") : "학교 자료가 아직 없어요. 최고 관리자가 엑셀을 올리면 여기에 보여요."}</div>`;
      pane.querySelectorAll("[data-cat]").forEach((b) => { b.onclick = () => { state.manageCat = b.dataset.cat; state.libQuery = ""; pane.querySelector("#lib-q").value = ""; draw(); }; });
      pane.querySelectorAll("[data-mark]").forEach((b) => { b.onclick = () => openMark(list.find((x) => String(x.no) === b.dataset.mark)); });
      pane.querySelectorAll("[data-nav]").forEach((b) => { b.onclick = () => openNav(list.find((x) => String(x.no) === b.dataset.nav)); });
    };
    const openNav = (sc) => {
      openModal(`<div class="card-body"><h2 class="section-title">${esc(sc.short || sc.name)} 길찾기</h2>
        <p class="muted">${esc(sc.address || "")}</p>
        <div class="nav-pick">${navBtns(sc, "btn nav-big")}</div>
        <p class="small muted">티맵·네이버지도는 휴대폰에 앱이 설치되어 있어야 열려요. 눌렀을 때 아무 일도 없으면 카카오맵을 써 주세요.</p>
        <div class="form-actions"><button class="btn" data-close>닫기</button></div></div>`);
    };
    const openMark = (sc) => {
      openModal(`<div class="card-body"><h2 class="section-title">${esc(sc.short || sc.name)} 구분</h2>
        <div class="field"><label for="m-cat">구분</label><select id="m-cat"><option value="">자동 (입교 실적으로)</option>${CAT_ORDER.map((k) => `<option value="${k}" ${sc.mark === k ? "selected" : ""}>${CATS[k].label}</option>`).join("")}</select></div>
        <div class="field"><label for="m-memo">메모 (모든 선생님에게 보여요)</label><textarea id="m-memo" rows="3" maxlength="200">${esc(sc.memo || "")}</textarea></div>
        <div class="form-actions"><button class="btn" data-close>취소</button><button class="btn btn-primary" id="m-go">저장</button></div></div>`);
      document.getElementById("m-go").onclick = async () => {
        try { await API.setSchoolMark(sc.name, document.getElementById("m-cat").value, document.getElementById("m-memo").value.trim()); closeModal(); toast("저장했어요."); paneLibrary(pane); } catch (e) { toast(e.message); }
      };
    };
    pane.innerHTML = `<div class="list-head"><div><h2 class="section-title">학교 자료</h2><p class="hint-line">지도에서 학교를 찾고, 아래 구분을 눌러 학교 목록을 보세요. 학교를 누르면 레포트가 열려요.${owner ? " 구분은 직접 바꿀 수 있어요." : ""}</p></div></div>
      <div class="lib-filters">
        <input id="lib-q" type="search" placeholder="학교 이름 검색 (예: 부평, 대건)" value="${esc(state.libQuery || "")}" aria-label="학교 이름 검색">
        <select id="lib-d" aria-label="지역"><option value="">전체 지역</option>${districts.map((d) => `<option value="${esc(d)}" ${d === state.libDistrict ? "selected" : ""}>${esc(d)}</option>`).join("")}</select>
      </div>
      <div class="sc-map"><div class="map-canvas" id="lib-map"></div></div>
      <p class="muted small map-note" id="lib-note"></p>
      <div class="map-legend">${CAT_ORDER.map((k) => `<span><i style="background:${CATS[k].color}"></i>${CATS[k].short}</span>`).join("")}</div>
      <div id="lib-alert"></div>
      <div class="mg-tiles" id="lib-tiles"></div>
      <h3 class="mg-sub" id="lib-sub"></h3>
      <div class="sc-list" id="lib-list"></div>`;
    const qi = pane.querySelector("#lib-q");
    qi.oninput = () => { state.libQuery = qi.value; draw(); };
    pane.querySelector("#lib-d").onchange = (e) => { state.libDistrict = e.target.value; draw(); };
    draw();
    makeSchoolMap(pane.querySelector("#lib-map"))
      .then((c) => { mapCtl = c; c.update(shown, cats); })
      .catch(() => { pane.querySelector("#lib-map").innerHTML = `<p class="error" style="padding:16px">지도를 불러오지 못했어요. 아래 목록으로 학교를 찾아 주세요.</p>`; });
  }

  async function viewSchool(no) {
    if (!state.me) { location.hash = "#/login"; return; }
    chrome(`<div class="wrap page"><p class="muted">불러오는 중…</p></div>`);
    let list = [], bookings = [];
    try { [list, bookings] = await Promise.all([API.listSchools(), API.listBookings().catch(() => [])]); }
    catch (e) { simpleCard("학교 정보를 불러오지 못했어요", `<p class="muted">${esc(e.message)}</p>`); return; }
    const sc = list.find((x) => String(x.no) === String(no));
    if (!sc) { simpleCard("학교를 찾지 못했어요", `<p class="muted"><a href="#/app/schools">방문 학교 목록</a>으로 돌아가 주세요.</p>`); return; }
    const myBk = bookingsFor(sc, bookings, list);
    const back = state.schoolBack === "library" ? ["#/app/library", "학교 자료"] : ["#/app/schools", "방문 학교"];
    const intake = (sc.intake || []).filter((x) => x.count != null);
    const max = Math.max(1, ...intake.map((x) => x.count));
    const total = totalIntake(sc), li = lastIntake(sc);
    const avg = intake.length ? total / intake.length : 0;
    const depts = {};
    for (const st of sc.current || []) (depts[st.dept || "학과 미기재"] = depts[st.dept || "학과 미기재"] || []).push(st.name);

    // 미팅 때 꺼낼 이야기
    const points = [];
    if (li) points.push(`${li.year}학년도에 <b>${li.count}명</b>이 입교했어요${intake.length > 1 ? ` (최근 ${intake.length}년 평균 ${avg.toFixed(1)}명${li.count > avg ? ", 평균보다 많음" : li.count < avg ? ", 평균보다 적음" : ""})` : ""}.`);
    const tr = intakeTrend(sc);
    points.push(`입교생 추이: ${tr ? tr.text : "비교할 입교 기록이 없어요."}`);
    const cat = categorize(list).get(sc);
    points.unshift(`<span class="cat-chip" style="--c:${CATS[cat.key].color}">${CATS[cat.key].label}</span> ${esc(cat.why)}${sc.memo ? ` · 메모: ${esc(sc.memo)}` : ""}`);
    if ((sc.current || []).length) points.push(`이 학교 출신 재학생이 <b>${sc.current.length}명</b> 있어요: ${Object.entries(depts).map(([d, ns]) => `${esc(d)} ${ns.length}명`).join(", ")}.`);
    else points.push(`현재 이 학교 출신 재학생은 없어요. 학과별 실제 수업 모습과 진로 사례 위주로 소개해 보세요.`);
    if (sc.consign_hope) points.push(`위탁교육 희망 학생 수: <b>${esc(sc.consign_hope)}</b>`);
    if (sc.our_hope) points.push(`본교 위탁교육 희망 학생 수: <b>${esc(sc.our_hope)}</b>`);
    if (sc.briefing) points.push(`설명회 희망: ${esc(sc.briefing).replace(/\n/g, " ")}`);
    if (sc.classes || sc.students) points.push(`2학년은 ${sc.classes ?? "-"}학급 ${sc.students ?? "-"}명이에요.`);

    chrome(`<div class="wrap page sc-detail">
      <a class="back" href="${back[0]}">‹ ${back[1]}</a>
      <div class="sc-hero card"><div class="card-body">
        <div><h1>${esc(sc.short || sc.name)}</h1><p class="muted">${esc(sc.name)}</p></div>
        <div class="row">${[sc.district, sc.found, sc.gender, sc.kind].filter(Boolean).map((t) => `<span class="badge">${esc(t)}</span>`).join("")}</div>
        ${sc.address ? `<p class="sc-addr">${esc(sc.address)}</p>` : ""}
        ${navLinks(sc).length ? `<div class="nav-row"><span class="nav-lbl">길찾기</span>${navBtns(sc, "nav-btn")}</div>` : ""}
      </div></div>

      <div class="card"><div class="card-body">
        <h2 class="section-title">방문 예약</h2>
        ${myBk.length ? `<div class="stack">${myBk.map((b) => `<div class="sc-booking"><span class="lbl">${T.ms(b.end_at) >= Date.now() ? esc(dday(ymdLocal(new Date(b.start_at)))) : "지난 방문"}</span><b>${fmtRange(b.start_at, b.end_at)}</b>
            <span>${esc(b.contact_name)} 선생님 · <a href="${telLink(b.phone)}">${esc(b.phone)}</a></span>
            ${b.target ? `<span class="muted">대상: ${esc(b.target)}</span>` : ""}${b.place ? `<span class="muted">장소: ${esc(b.place)}</span>` : ""}${b.request ? `<span class="muted">요청: ${esc(b.request)}</span>` : ""}</div>`).join("")}</div>` : `<p class="muted">내 예약이 없는 학교예요.</p>`}
      </div></div>

      <div class="card"><div class="card-body">
        <h2 class="section-title">미팅 전에 확인할 것</h2>
        <ul class="sc-points">${points.map((x) => `<li>${x}</li>`).join("")}</ul>
      </div></div>

      <div class="sc-tiles">
        <div class="stat"><b>${(sc.current || []).length}명</b><span>본교 재학생</span></div>
        <div class="stat"><b>${li ? `${li.count}명` : "-"}</b><span>${li ? `${li.year} 입교` : "최근 입교"}</span></div>
        <div class="stat"><b>${total}명</b><span>${intake.length ? `${intake[0].year}~${li.year} 누적` : "누적 입교"}</span></div>
        <div class="stat"><b>${sc.students ?? "-"}명</b><span>2학년 (${sc.classes ?? "-"}학급)</span></div>
      </div>

      ${intake.length ? `<div class="card"><div class="card-body">
        <h2 class="section-title">해마다 입교한 학생 수</h2>
        <div class="sc-bars" role="img" aria-label="연도별 입교 ${intake.map((x) => `${x.year}년 ${x.count}명`).join(", ")}">
          ${intake.map((x) => `<div class="bar"><span class="v">${x.count}</span><i style="height:${Math.round((x.count / max) * 100)}%"></i><span class="y">${String(x.year).slice(2)}</span></div>`).join("")}
        </div>
      </div></div>` : ""}

      <div class="card"><div class="card-body">
        <h2 class="section-title">이 학교 출신 재학생</h2>
        ${(sc.current || []).length ? `<div class="sc-depts">${Object.entries(depts).map(([d, ns]) => `<div><span class="dept">${esc(d)}</span><span>${ns.map(esc).join(", ")}</span></div>`).join("")}</div>` : `<p class="muted">없어요.</p>`}
      </div></div>

      <div class="card"><div class="card-body">
        <h2 class="section-title">연락처</h2>
        ${(sc.contacts || []).length ? `<div class="sc-contacts">${sc.contacts.map((c) => `<div class="sc-contact"><span class="role">${esc(c.role)}</span>
          ${c.lines.map((l) => `<div class="line"><span>${esc(l.text)}</span>${(l.phones || []).map((ph) => `<a class="btn btn-sm btn-soft" href="${telLink(ph)}">전화</a>`).join("")}</div>`).join("")}</div>`).join("")}</div>` : `<p class="muted">연락처가 없어요.</p>`}
      </div></div>
    </div>`);
  }

  // 관리자: 방문 학교 엑셀 올리기 (SheetJS는 필요할 때만 불러옴)
  function loadScript(src) {
    return new Promise((ok, no) => { const el = document.createElement("script"); el.src = src; el.onload = ok; el.onerror = () => no(new Error("엑셀 읽기 도구를 불러오지 못했어요.")); document.head.appendChild(el); });
  }
  async function readSchoolExcel(file) {
    if (!window.XLSX) await loadScript("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js");
    if (!window.SchoolImport) await loadScript("assets/schools-import.js");
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const r = window.SchoolImport.parseWorkbook(wb, window.XLSX);
    // 홍보 담당 배정·방문 일정(교사 이름)은 자주 바뀌므로 저장하지 않음. 방문 학교는 예약 기준으로 보여 줌
    r.schools = r.schools.map(({ promo_teacher, visits, ...rest }) => ({ ...rest, promo_teacher: "", visits: [] }));
    return r;
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
    chrome(`<div class="wrap page"><div class="page-head"><div><h1>관리</h1><p>${state.me.owner ? "선생님 계정과 전체 예약을 관리합니다." : "가입 안내와 가입한 선생님 목록을 볼 수 있어요."}</p></div></div><div id="admin" class="stack"><p class="muted">불러오는 중…</p></div></div>`);
    const box = document.getElementById("admin");
    const draw = async () => {
      const owner = !!state.me.owner;
      const [users, all, schools, code] = await Promise.all([API.listUsers(owner), owner ? API.listAllBookings() : [], owner ? API.listSchools().catch(() => []) : [], API.getSignupCode().catch(() => "")]);
      const schoolCount = schools.length;
      const upcoming = all.filter((b) => b.status === "confirmed" && T.ms(b.end_at) >= Date.now());
      const roleName = (u) => (u.owner ? "최고 관리자" : u.role === "admin" ? "관리자" : "선생님");
      const codeCard = `<div class="card"><div class="card-body">
          <h2 class="section-title">가입 코드</h2>
          <p class="hint-line">${owner ? "선생님은 '계정 만들기'에서 이 코드를 넣어야 가입할 수 있어요. 코드를 바꾸면 이전 코드로는 더 이상 가입할 수 없어요 (이미 가입한 계정은 그대로)." : "가입 안내를 복사해서 선생님께 보내 주세요. 코드는 최고 관리자만 바꿀 수 있어요."}</p>
          <div class="row"><span class="signup-code" id="code-show">${esc(code || "없음")}</span>
            <button class="btn btn-sm" id="code-copy">가입 안내 복사</button>${owner ? `<button class="btn btn-sm" id="code-new">새 코드 만들기</button>` : ""}</div>
        </div></div>`;
      if (!owner) {
        box.innerHTML = `${codeCard}
          <div class="card"><div class="card-body">
            <h2 class="section-title">가입한 선생님 ${users.length}명</h2>
            <div class="table-scroll"><table class="data" style="min-width:0"><thead><tr><th>이름</th><th>권한</th><th>상태</th></tr></thead><tbody>
              ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${roleName(u)}</td><td><span class="badge ${u.active ? "ok" : "off"}">${u.active ? "사용 중" : "멈춤"}</span></td></tr>`).join("")}
            </tbody></table></div>
          </div></div>`;
        box.querySelector("#code-copy").onclick = () => copyText(`[${SCHOOL} 홍보 예약] 선생님 가입 안내\n주소: ${location.origin}${location.pathname}#/signup\n가입 코드: ${code}`, "가입 안내를 복사했어요.");
        return;
      }
      box.innerHTML = `${codeCard}
        <div class="card"><div class="card-body">
          <h2 class="section-title">선생님 ${users.length}명</h2><p class="hint-line">'관리자로 지정'을 누르면 그 선생님도 이 관리 화면을 쓸 수 있어요. 모르는 계정은 '사용 멈춤'이나 삭제로 정리해 주세요.</p>
          <div class="table-scroll"><table class="data"><thead><tr><th>이름</th><th>아이디</th><th>신청 페이지</th><th>권한</th><th>상태</th><th></th></tr></thead><tbody>
            ${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.login_id || "")}</td><td><a href="#/r/${esc(u.slug)}">/r/${esc(u.slug)}</a></td><td>${roleName(u)}</td><td><span class="badge ${u.active ? "ok" : "off"}">${u.active ? "사용 중" : "멈춤"}</span></td>
              <td><div class="row" style="flex-wrap:nowrap"><button class="btn btn-sm" data-reset="${u.id}">비밀번호 초기화</button>${u.id === state.me.id || u.owner ? "" : `<button class="btn btn-sm ${u.role === "admin" ? "" : "btn-soft"}" data-role="${u.id}" data-to="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "관리자 해제" : "관리자로 지정"}</button><button class="btn btn-sm" data-act="${u.id}" data-to="${u.active ? "0" : "1"}">${u.active ? "사용 멈춤" : "다시 사용"}</button><button class="btn btn-sm btn-danger" data-del="${u.id}">삭제</button>`}</div></td></tr>`).join("")}
          </tbody></table></div>
        </div></div>
        <div class="card"><div class="card-body">
          <h2 class="section-title">방문 학교 자료</h2>
          <p class="hint-line">'방문 홍보 배정' 엑셀 파일을 올리면 선생님들의 '방문 학교' 화면이 새 자료로 바뀌어요. 지금 ${schoolCount}개 학교가 들어 있어요.</p>
          <div class="row"><label class="btn btn-primary" for="sc-file">엑셀 올리기</label><input id="sc-file" type="file" accept=".xlsx,.xls" hidden></div>
          <div id="sc-preview"></div>
        </div></div>
        <div class="card"><div class="card-body">
          <h2 class="section-title">다가오는 전체 예약 ${upcoming.length}건</h2>
          ${upcoming.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>일시</th><th>방문 담당</th><th>학교</th><th>담당 선생님</th><th>대상</th></tr></thead><tbody>
            ${upcoming.map((b) => `<tr><td>${fmtRange(b.start_at, b.end_at)}</td><td>${esc(b.owner_name)}</td><td>${esc(b.school)}</td><td>${esc(b.contact_name)} ${esc(b.phone)}</td><td>${esc(b.target || "-")}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="empty-pane">다가오는 예약이 없어요.</div>`}
        </div></div>`;
      box.querySelector("#sc-file").onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const $p = box.querySelector("#sc-preview");
        $p.innerHTML = `<p class="muted">엑셀을 읽는 중…</p>`;
        try {
          const r = await readSchoolExcel(file);
          $p.innerHTML = `<div class="msg-preview">학교 ${r.schools.length}곳, 재학생 ${r.schools.reduce((n, x) => n + x.current.length, 0)}명을 읽었어요.</div>
            <div class="form-actions"><button class="btn btn-primary" id="sc-apply">이 자료로 바꾸기</button></div>`;
          $p.querySelector("#sc-apply").onclick = async (ev) => {
            ev.target.disabled = true;
            try { await API.replaceSchools(r.schools); toast("방문 학교 자료를 바꿨어요."); draw(); }
            catch (e2) { toast(e2.message); ev.target.disabled = false; }
          };
        } catch (e2) { $p.innerHTML = `<p class="error">${esc(e2.message)}</p>`; }
        e.target.value = "";
      };
      const userOf = (id) => users.find((x) => x.id === id) || {};
      box.querySelector("#code-copy").onclick = () => copyText(`[${SCHOOL} 홍보 예약] 선생님 가입 안내\n주소: ${location.origin}${location.pathname}#/signup\n가입 코드: ${code}`, "가입 안내를 복사했어요.");
      box.querySelector("#code-new").onclick = () => {
        openModal(`<div class="card-body"><h2 class="section-title">새 가입 코드</h2>
          <div class="field"><label for="c-new">새 코드 (4~20자)</label><input id="c-new" value="${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0")}"></div>
          <p class="error" id="c-err" hidden></p>
          <div class="form-actions"><button class="btn" data-close>취소</button><button class="btn btn-primary" id="c-go">바꾸기</button></div></div>`);
        document.getElementById("c-go").onclick = async () => {
          const v = document.getElementById("c-new").value.trim();
          const er = document.getElementById("c-err");
          if (v.length < 4 || v.length > 20) { er.textContent = "코드는 4~20자로 정해 주세요."; er.hidden = false; return; }
          try { await API.setSignupCode(v); closeModal(); toast("가입 코드를 바꿨어요."); draw(); } catch (e) { er.textContent = e.message; er.hidden = false; }
        };
      };
      box.querySelectorAll("[data-role]").forEach((b) => { b.onclick = () => {
        const u = userOf(b.dataset.role), toAdmin = b.dataset.to === "admin";
        openModal(`<div class="card-body"><h2 class="section-title">${esc(u.name)} 선생님 ${toAdmin ? "관리자로 지정" : "관리자 해제"}</h2>
          <p class="muted">${toAdmin ? "관리 화면에서 가입 코드, 선생님 계정, 학교 자료, 전체 예약을 다룰 수 있게 돼요." : "관리 화면을 더 이상 쓸 수 없고, 일반 선생님 화면만 쓰게 돼요."}</p>
          <div class="form-actions"><button class="btn" data-close>취소</button><button class="btn btn-primary" id="r-go">${toAdmin ? "지정" : "해제"}</button></div></div>`);
        document.getElementById("r-go").onclick = async () => {
          try { await API.setUserRole(u.id, toAdmin ? "admin" : "user"); closeModal(); toast(toAdmin ? "관리자로 지정했어요." : "관리자를 해제했어요."); draw(); } catch (e) { toast(e.message); }
        };
      }; });
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
    const { first, last } = T.bookRange(page); // last 포함
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
    if (a === "school" && b) return viewSchool(decodeURIComponent(b));
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
