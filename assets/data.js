// 데이터 계층: Supabase(실제 모드)와 localStorage(체험 모드)를 같은 모양의 API로 감쌉니다.
(function () {
  const CFG = window.APP_CONFIG || {};
  // 주소 끝에 ?demo 를 붙이면 실제 설정이 있어도 체험 모드로 열립니다.
  const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || new URLSearchParams(location.search).has("demo");

  // ---------- 공용 시간 계산 ----------
  const T = {
    ms: (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime()),
    overlaps: (aS, aE, bS, bE) => T.ms(aS) < T.ms(bE) && T.ms(bS) < T.ms(aE),
    // 겹치거나 맞닿은 구간을 하나로 합칩니다. 입력/출력: [{start_at, end_at}] (ISO 문자열)
    merge(list) {
      const xs = list
        .map((x) => [T.ms(x.start_at), T.ms(x.end_at)])
        .filter(([s, e]) => e > s)
        .sort((a, b) => a[0] - b[0]);
      const out = [];
      for (const [s, e] of xs) {
        const last = out[out.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else out.push([s, e]);
      }
      return out.map(([s, e]) => ({ start_at: new Date(s).toISOString(), end_at: new Date(e).toISOString() }));
    },
    // 신청 받는 날짜 범위 (그 날 0시 기준, last 포함). 시작일·마감일을 비우면 내일부터 days_ahead일까지
    bookRange(p) {
      const day = (str) => { const [y, m, d] = String(str).split("-").map(Number); return new Date(y, m - 1, d); };
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
      let first = p.book_from ? day(p.book_from) : tomorrow;
      if (first < tomorrow) first = tomorrow;
      let last = p.book_until ? day(p.book_until) : new Date(today.getFullYear(), today.getMonth(), today.getDate() + (Number(p.days_ahead) || 28));
      return { first, last };
    },
    covered(intervals, s, e) {
      const S = T.ms(s), E = T.ms(e);
      return T.merge(intervals).some((x) => T.ms(x.start_at) <= S && T.ms(x.end_at) >= E);
    },
  };

  const DEFAULT_INVITE =
    "안녕하세요, 인천산업정보학교 {사용자}입니다.\n학교 홍보 방문 일정을 잡고자 연락드립니다.\n아래 링크에서 편하신 날짜와 시간을 골라 신청해 주세요.\n\n{링크}\n\n감사합니다.";
  const DEFAULT_CONFIRM =
    "[인천산업정보학교 홍보 방문 안내]\n{학교명} {담당자} 선생님, 홍보 방문 일정이 확정되었습니다.\n\n■ 일시: {일시}\n■ 장소: {장소}\n■ 대상: {대상}\n■ 방문 담당: {사용자} ({연락처})\n\n일정 변경이 필요하시면 위 연락처로 말씀 부탁드립니다. 감사합니다.";

  const PUBLIC_FIELDS = [
    "slug", "name", "page_title", "page_intro", "contact_phone", "default_place",
    "slot_minutes", "duration_minutes", "days_ahead", "day_start", "day_end", "confirm_template", "active",
    "book_from", "book_until",
  ];
  // 아이디는 서버에 `{아이디}@isg-promo.local` 형태로 저장됩니다 (메일은 보내지 않음).
  const ID_DOMAIN = "isg-promo.local";
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

  // =====================================================================
  // 체험 모드
  // =====================================================================
  function demoApi() {
    const KEY = "promo-booking-demo-v3.4";
    const SESSION_KEY = "promo-booking-demo-session";
    let mem = null;
    let sessionMem = null;

    const at = (dayOffset, hhmm) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + dayOffset);
      const [h, m] = hhmm.split(":").map(Number);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const isWeekend = (off) => {
      const d = new Date();
      d.setDate(d.getDate() + off);
      return d.getDay() === 0 || d.getDay() === 6;
    };

    function seed() {
      const base = (id, extra) => ({
        id, active: true, slot_minutes: 30, duration_minutes: 60, days_ahead: 28, book_from: null, book_until: null, class_times: [],
        day_start: "09:00", day_end: "18:00", invite_template: DEFAULT_INVITE, confirm_template: DEFAULT_CONFIRM,
        password: "1234", ...extra,
      });
      const profiles = [
        base("u-admin", {
          login_id: "admin", email: "admin@isg-promo.local", name: "미카", role: "admin", slug: "mika",
          page_title: "인천산업정보학교 고교 방문 홍보 신청", page_intro: "원하시는 날짜와 시간을 골라 주세요.\n방문 홍보는 약 1시간 진행됩니다.",
          contact_phone: "010-1234-5678", default_place: "",
        }),
        base("u-kim", {
          login_id: "kim", email: "kim@isg-promo.local", name: "김홍보", role: "user", slug: "kim",
          page_title: "인천산업정보학교 고교 방문 홍보 신청",
          page_intro: "위탁 교육과정과 학과 소개를 위해 고등학교로 직접 찾아갑니다.\n편하신 날짜와 시간을 30분 단위로 골라 신청해 주세요. 신청 즉시 확정됩니다.",
          contact_phone: "010-2345-6789", default_place: "학교 시청각실",
        }),
      ];
      const open = [];
      for (let off = 1; off <= 45; off++) {
        if (isWeekend(off)) continue;
        for (const uid of ["u-kim", "u-admin"]) {
          open.push({ user_id: uid, start_at: at(off, "10:00"), end_at: at(off, "12:00") });
          open.push({ user_id: uid, start_at: at(off, "13:30"), end_at: at(off, "17:00") });
        }
      }
      let firstWeekday = 2;
      while (isWeekend(firstWeekday)) firstWeekday++;
      let second = firstWeekday + 2;
      while (isWeekend(second)) second++;
      const bookings = [
        {
          id: "b-1", user_id: "u-kim", start_at: at(firstWeekday, "13:30"), end_at: at(firstWeekday, "14:30"),
          school: "한빛고등학교", contact_name: "이진로", phone: "010-5555-1234", target: "3학년 120명",
          place: "강당", request: "빔프로젝터는 학교에서 준비합니다.", status: "confirmed", created_at: new Date().toISOString(),
        },
        {
          id: "b-2", user_id: "u-kim", start_at: at(second, "10:00"), end_at: at(second, "11:00"),
          school: "새솔고등학교", contact_name: "박상담", phone: "010-7777-8888", target: "2학년 진로반 35명",
          place: "진로상담실", request: "", status: "confirmed", created_at: new Date().toISOString(),
        },
      ];
      // 방문 학교 예시 (이름·연락처는 모두 가짜)
      const sc = (no, name, district, found, gender, teacher, intake, current, extra) => ({
        no, name, short: name.replace(/여자고등학교$/, "여고").replace(/고등학교$/, "고"), kind: "일반", district, found, gender,
        classes: 8 + (no % 4), students: 200 + no * 17,
        intake: intake.map((count, k) => ({ year: 2019 + k, count })),
        current, promo_teacher: teacher,
        contacts: [
          { role: "위탁 담당", lines: [{ text: `홍담당(032-000-${1000 + no})`, phones: [`032-000-${1000 + no}`] }] },
          { role: "2학년 부장", lines: [{ text: `이부장(032-000-${2000 + no})`, phones: [`032-000-${2000 + no}`] }] },
          { role: "진로진학 담당", lines: [{ text: `박진로(032-000-${3000 + no})`, phones: [`032-000-${3000 + no}`] }] },
        ],
        consign_hope: "", our_hope: "", briefing: "", visits: [], ...extra,
      });
      const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
      const schools = [
        sc(1, "한빛고등학교", "서구", "공립", "공학", "김홍보", [3, 5, 2, 4, 6, 3, 5, 8],
          [{ name: "학생가", dept: "그래픽디자인과" }, { name: "학생나", dept: "뷰티아트과" }, { name: "학생다", dept: "뷰티아트과" }, { name: "학생라", dept: "호텔조리과 카페" }],
          { visits: [{ date: day(firstWeekday), note: "김홍보", source: "현황" }], briefing: "교내 설명회 희망 15:40~" }),
        sc(2, "새솔고등학교", "연수구", "사립", "남", "김홍보", [1, 0, 2, 1, 0, 3, 2, 4],
          [{ name: "학생마", dept: "호텔조리과 쉐프" }, { name: "학생바", dept: "펫케어과" }],
          { visits: [{ date: day(second), note: "김홍보", source: "달력" }] }),
        sc(3, "푸른여자고등학교", "부평구", "공립", "여", "김홍보", [2, 3, 1, 0, 4, 2, 6, 3], [{ name: "학생사", dept: "사진영상콘텐츠과" }], {}),
        sc(4, "바다고등학교", "중구", "공립", "공학", "미카", [0, 1, 0, 2, 1, 0, 1, 2], [], {}),
        sc(5, "솔빛고등학교", "남동구", "사립", "공학", "", [4, 2, 3, 1, 2, 1, 0, 1], [], {}),
      ];
      return { profiles, open, bookings, schools };
    }

    function load() {
      if (mem) return mem;
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) mem = JSON.parse(raw);
      } catch (e) { /* 저장소 사용 불가 */ }
      if (!mem) { mem = seed(); save(); }
      return mem;
    }
    function save() {
      try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* 메모리에만 유지 */ }
    }
    function sessionId() {
      if (sessionMem !== null) return sessionMem;
      try { sessionMem = localStorage.getItem(SESSION_KEY) || ""; } catch (e) { sessionMem = ""; }
      return sessionMem;
    }
    function setSession(id) {
      sessionMem = id || "";
      try { localStorage.setItem(SESSION_KEY, sessionMem); } catch (e) { /* 무시 */ }
    }
    const me = () => load().profiles.find((p) => p.id === sessionId()) || null;
    const need = () => { const p = me(); if (!p) throw new Error("로그인이 필요해요."); return p; };
    const needAdmin = () => { const p = need(); if (p.role !== "admin") throw new Error("관리자만 할 수 있어요."); return p; };
    const inRange = (x, from, to) => T.overlaps(x.start_at, x.end_at, from, to);
    const wait = (v) => new Promise((r) => setTimeout(() => r(v), 120));

    return {
      demo: true,
      T, DEFAULT_INVITE, DEFAULT_CONFIRM,
      async init() { load(); return me(); },
      onAuthChange() {},
      async setupStatus() { return { needs_setup: false }; },
      async signIn(loginId, password) {
        const p = load().profiles.find((x) => x.login_id === String(loginId).trim().toLowerCase());
        if (!p || p.password !== password) throw new Error("아이디 또는 비밀번호가 맞지 않아요.");
        setSession(p.id);
        return me();
      },
      async changePassword(pw) {
        const p = need();
        if (String(pw).length < 6) throw new Error("비밀번호는 6자 이상이어야 해요.");
        p.password = pw; save();
      },
      async signOut() { setSession(""); },
      async resetDemo() { mem = seed(); save(); },
      async profile() { return me(); },
      async updateProfile(patch) {
        const p = need();
        if (patch.slug && load().profiles.some((x) => x.slug === patch.slug && x.id !== p.id)) {
          throw new Error("이미 쓰고 있는 주소예요. 다른 주소를 정해 주세요.");
        }
        Object.assign(p, patch);
        save();
        return wait(p);
      },
      async listOpen(from, to) {
        const p = need();
        return load().open.filter((x) => x.user_id === p.id && inRange(x, from, to));
      },
      async saveOpen(from, to, intervals) {
        const p = need();
        const db = load();
        db.open = db.open.filter((x) => !(x.user_id === p.id && T.ms(x.start_at) >= T.ms(from) && T.ms(x.end_at) <= T.ms(to)));
        for (const x of T.merge(intervals)) db.open.push({ user_id: p.id, ...x });
        save();
        return true;
      },
      async myBusy() { return []; },
      async listBookings() {
        const p = need();
        return load().bookings.filter((b) => b.user_id === p.id).sort((a, b) => T.ms(a.start_at) - T.ms(b.start_at));
      },
      async cancelBooking(id) {
        const p = need();
        const b = load().bookings.find((x) => x.id === id && (x.user_id === p.id || p.role === "admin"));
        if (!b) throw new Error("예약을 찾지 못했어요.");
        b.status = "cancelled";
        save();
        return wait(b);
      },
      // 관리자
      async signUp(fields) {
        if (String(fields.code || "") !== (load().signup_code || "123456")) throw new Error("가입 코드가 맞지 않아요. 관리자에게 코드를 확인해 주세요.");
        await this.createUser({ ...fields, role: "user" }, true);
        return this.signIn(fields.login_id, fields.password);
      },
      async createUser({ login_id, name, password, role }, self) {
        if (!self) needAdmin();
        const db = load();
        login_id = String(login_id || "").trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,20}$/.test(login_id)) throw new Error("아이디는 영어 소문자, 숫자, . _ - 로 3~20자여야 해요.");
        if (String(password).length < 6) throw new Error("비밀번호는 6자 이상이어야 해요.");
        if (!String(name || "").trim()) throw new Error("이름을 입력해 주세요.");
        if (db.profiles.some((p) => p.login_id === login_id)) throw new Error("이미 있는 아이디예요.");
        let slug = login_id.replace(/[^a-z0-9-]/g, "-");
        if (slug.length < 3 || db.profiles.some((p) => p.slug === slug)) slug = (slug + "-" + Math.random().toString(36).slice(2, 6)).slice(0, 30);
        const tpl = db.profiles[0];
        db.profiles.push({
          id: "u-" + Math.random().toString(36).slice(2, 9), login_id, email: login_id + "@isg-promo.local", name: name.trim(),
          role: role === "admin" ? "admin" : "user", active: true, slug, password,
          slot_minutes: 30, duration_minutes: 60, days_ahead: 28, day_start: "09:00", day_end: "18:00", book_from: null, book_until: null, class_times: [],
          page_title: tpl.page_title, page_intro: "편하신 날짜와 시간을 30분 단위로 골라 신청해 주세요. 신청 즉시 확정됩니다.",
          contact_phone: "", default_place: "", invite_template: DEFAULT_INVITE, confirm_template: DEFAULT_CONFIRM,
        });
        save();
      },
      async resetPassword(id, password) {
        needAdmin();
        const u = load().profiles.find((p) => p.id === id);
        if (!u) throw new Error("계정을 찾지 못했어요.");
        u.password = password; save();
      },
      async deleteUser(id) {
        const a = needAdmin();
        if (id === a.id) throw new Error("내 계정은 삭제할 수 없어요.");
        const db = load();
        db.profiles = db.profiles.filter((p) => p.id !== id);
        db.open = db.open.filter((x) => x.user_id !== id);
        db.bookings = db.bookings.filter((x) => x.user_id !== id);
        save();
      },
      async listUsers() { needAdmin(); return load().profiles.slice(); },
      async getSignupCode() { needAdmin(); return load().signup_code || "123456"; },
      async setSignupCode(code) { needAdmin(); load().signup_code = code; save(); },
      async setUserRole(id, role) { needAdmin(); const u = load().profiles.find((p) => p.id === id); if (u) { u.role = role; save(); } },
      async setUserActive(id, active) { needAdmin(); const u = load().profiles.find((p) => p.id === id); if (u) { u.active = active; save(); } },
      async listAllBookings() {
        needAdmin();
        const db = load();
        return db.bookings
          .map((b) => ({ ...b, owner_name: (db.profiles.find((p) => p.id === b.user_id) || {}).name || "" }))
          .sort((a, b) => T.ms(a.start_at) - T.ms(b.start_at));
      },
      // 방문 학교
      async listSchools() { need(); return (load().schools || []).slice(); },
      async replaceSchools(list) { needAdmin(); load().schools = list; save(); },
      // 신청자(로그인 없음)
      async publicPage(slug) {
        const p = load().profiles.find((x) => x.slug === slug && x.active);
        return wait(p ? pick(p, PUBLIC_FIELDS) : null);
      },
      async availability(slug, from, to) {
        const db = load();
        const p = db.profiles.find((x) => x.slug === slug && x.active);
        if (!p) throw new Error("신청 페이지를 찾지 못했어요.");
        const open = db.open.filter((x) => x.user_id === p.id && inRange(x, from, to)).map((x) => pick(x, ["start_at", "end_at"]));
        const blocked = db.bookings.filter((x) => x.user_id === p.id && x.status === "confirmed" && inRange(x, from, to))
          .map((x) => pick(x, ["start_at", "end_at"]));
        return wait({ open, blocked });
      },
      async book(slug, start_at, end_at, fields) {
        const db = load();
        const p = db.profiles.find((x) => x.slug === slug && x.active);
        if (!p) throw new Error("신청 페이지를 찾지 못했어요.");
        const len = (T.ms(end_at) - T.ms(start_at)) / 60000;
        if (!(len >= p.slot_minutes && len <= 240 && len % p.slot_minutes === 0)) throw new Error("신청 시간이 올바르지 않아요.");
        if (T.ms(start_at) <= Date.now()) throw new Error("지난 시간은 신청할 수 없어요.");
        const rg = T.bookRange(p);
        if (new Date(start_at) < rg.first || new Date(start_at) >= new Date(rg.last.getFullYear(), rg.last.getMonth(), rg.last.getDate() + 1)) throw new Error("신청 받는 기간을 벗어났어요.");
        const open = db.open.filter((x) => x.user_id === p.id);
        if (!T.covered(open, start_at, end_at)) throw new Error("방금 그 시간이 닫혔어요. 다른 시간을 골라 주세요.");
        const clash = db.bookings.filter((x) => x.user_id === p.id && x.status === "confirmed")
          .some((x) => T.overlaps(x.start_at, x.end_at, start_at, end_at));
        if (clash) throw new Error("방금 다른 일정이 들어왔어요. 다른 시간을 골라 주세요.");
        const b = {
          id: "b-" + Math.random().toString(36).slice(2, 9), user_id: p.id, start_at, end_at,
          ...fields, status: "confirmed", created_at: new Date().toISOString(),
        };
        db.bookings.push(b);
        save();
        return wait({ booking: b, page: pick(p, PUBLIC_FIELDS) });
      },
    };
  }

  // =====================================================================
  // 실제 모드 (Supabase)
  // =====================================================================
  function supabaseApi() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    let current = null;
    const fail = (error) => { if (error) throw new Error(error.message || "요청을 처리하지 못했어요."); };

    async function fn(body, name = "public-api") {
      const { data, error } = await sb.functions.invoke(name, { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (e) { /* 원문 유지 */ }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    }

    async function loadProfile(session) {
      if (!session) { current = null; return null; }
      const { data, error } = await sb.rpc("ensure_profile");
      fail(error);
      current = data && data.id ? data : null;
      return current;
    }

    return {
      demo: false,
      T, DEFAULT_INVITE, DEFAULT_CONFIRM,
      async init() {
        const { data } = await sb.auth.getSession();
        return loadProfile(data.session);
      },
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(async () => cb(await loadProfile(session)), 0);
        });
      },
      async setupStatus() { return fn({ action: "status" }, "admin-api"); },
      async signUp(fields) { await fn({ action: "signup", ...fields }, "admin-api"); return this.signIn(fields.login_id, fields.password); },
      async setupAdmin(fields) { await fn({ action: "setup", ...fields }, "admin-api"); return this.signIn(fields.login_id, fields.password); },
      async signIn(loginId, password) {
        const id = String(loginId || "").trim().toLowerCase();
        const { data, error } = await sb.auth.signInWithPassword({ email: `${id}@${ID_DOMAIN}`, password });
        if (error) throw new Error(error.status === 400 ? "아이디 또는 비밀번호가 맞지 않아요." : "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return loadProfile(data.session);
      },
      async changePassword(pw) {
        if (String(pw).length < 6) throw new Error("비밀번호는 6자 이상이어야 해요.");
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error && /different/i.test(error.message)) throw new Error("지금 비밀번호와 다른 비밀번호를 정해 주세요.");
        fail(error);
      },
      async signOut() { await sb.auth.signOut(); current = null; },
      async profile() { return current; },
      async sessionEmail() { const { data } = await sb.auth.getUser(); return data.user ? data.user.email : ""; },
      async updateProfile(patch) {
        const { data, error } = await sb.from("profiles").update(patch).eq("id", current.id).select().single();
        if (error && error.code === "23505") throw new Error("이미 쓰고 있는 주소예요. 다른 주소를 정해 주세요.");
        fail(error);
        current = data;
        return data;
      },
      async listOpen(from, to) {
        const { data, error } = await sb.from("open_slots").select("start_at,end_at")
          .eq("user_id", current.id).lt("start_at", to).gt("end_at", from);
        fail(error);
        return data;
      },
      async saveOpen(from, to, intervals) {
        const del = await sb.from("open_slots").delete()
          .eq("user_id", current.id).gte("start_at", from).lte("end_at", to);
        fail(del.error);
        const rows = T.merge(intervals)
          .filter((x) => T.ms(x.start_at) >= T.ms(from) && T.ms(x.end_at) <= T.ms(to))
          .map((x) => ({ user_id: current.id, ...x }));
        if (rows.length) fail((await sb.from("open_slots").insert(rows)).error);
        return true;
      },
      async myBusy() { return []; },
      async listBookings() {
        const { data, error } = await sb.from("bookings").select("*").eq("user_id", current.id).order("start_at");
        fail(error);
        return data;
      },
      async cancelBooking(id) {
        const { data, error } = await sb.from("bookings").update({ status: "cancelled" }).eq("id", id).select().single();
        fail(error);
        return data;
      },
      async createUser(fields) { await fn({ action: "create_user", ...fields }, "admin-api"); },
      async resetPassword(user_id, password) { await fn({ action: "reset_password", user_id, password }, "admin-api"); },
      async deleteUser(user_id) { await fn({ action: "delete_user", user_id }, "admin-api"); },
      async listUsers() {
        const { data, error } = await sb.from("profiles").select("*").order("created_at");
        fail(error);
        return data;
      },
      async getSignupCode() {
        const { data, error } = await sb.from("app_settings").select("value").eq("key", "signup_code").maybeSingle();
        fail(error);
        return data ? data.value : "";
      },
      async setSignupCode(code) {
        fail((await sb.from("app_settings").upsert({ key: "signup_code", value: code, updated_at: new Date().toISOString() })).error);
      },
      async setUserRole(id, role) {
        fail((await sb.from("profiles").update({ role }).eq("id", id)).error);
      },
      async setUserActive(id, active) {
        const { error } = await sb.from("profiles").update({ active }).eq("id", id);
        fail(error);
      },
      async listAllBookings() {
        const { data, error } = await sb.from("bookings").select("*, profiles(name)").order("start_at");
        fail(error);
        return data.map((b) => ({ ...b, owner_name: b.profiles ? b.profiles.name : "" }));
      },
      async listSchools() {
        const { data, error } = await sb.from("visit_schools").select("no, data, updated_at").order("no");
        fail(error);
        return data.map((r) => ({ ...r.data, updated_at: r.updated_at }));
      },
      async replaceSchools(list) {
        fail((await sb.from("visit_schools").delete().gte("no", -1000000)).error);
        const rows = list.map((s) => ({ no: s.no, name: s.name, promo_teacher: s.promo_teacher || "", data: s }));
        for (let i = 0; i < rows.length; i += 50) fail((await sb.from("visit_schools").insert(rows.slice(i, i + 50))).error);
      },
      async publicPage(slug) {
        const r = await fn({ action: "page", slug });
        return r.page || null;
      },
      async availability(slug, from, to) {
        return fn({ action: "availability", slug, from, to });
      },
      async book(slug, start_at, end_at, fields) {
        return fn({ action: "book", slug, start_at, end_at, fields });
      },
    };
  }

  window.API = DEMO ? demoApi() : supabaseApi();
})();
