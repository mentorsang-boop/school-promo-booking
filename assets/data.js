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
    covered(intervals, s, e) {
      const S = T.ms(s), E = T.ms(e);
      return T.merge(intervals).some((x) => T.ms(x.start_at) <= S && T.ms(x.end_at) >= E);
    },
  };

  const DEFAULT_INVITE =
    "안녕하세요, {사용자}입니다.\n학교 홍보 방문 일정을 잡고자 연락드립니다.\n아래 링크에서 편하신 날짜와 시간을 골라 신청해 주세요.\n\n{링크}\n\n감사합니다.";
  const DEFAULT_CONFIRM =
    "[학교 홍보 일정 안내]\n{학교명} {담당자} 선생님, 홍보 방문 일정이 확정되었습니다.\n\n■ 일시: {일시}\n■ 장소: {장소}\n■ 대상: {대상}\n■ 방문 담당: {사용자} ({연락처})\n\n일정 변경이 필요하시면 위 연락처로 말씀 부탁드립니다. 감사합니다.";

  const PUBLIC_FIELDS = [
    "slug", "name", "page_title", "page_intro", "contact_phone", "default_place",
    "slot_minutes", "duration_minutes", "days_ahead", "day_start", "day_end", "confirm_template", "active",
  ];
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

  // =====================================================================
  // 체험 모드
  // =====================================================================
  function demoApi() {
    const KEY = "promo-booking-demo-v1";
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
        id, active: true, slot_minutes: 30, duration_minutes: 60, days_ahead: 28,
        day_start: "09:00", day_end: "18:00", invite_template: DEFAULT_INVITE, confirm_template: DEFAULT_CONFIRM,
        google_connected: true, ...extra,
      });
      const profiles = [
        base("u-admin", {
          email: "admin@example.com", name: "미카", role: "admin", slug: "mika",
          page_title: "입학처 홍보 방문 신청", page_intro: "원하시는 날짜와 시간을 골라 주세요.\n방문 홍보는 약 1시간 진행됩니다.",
          contact_phone: "010-1234-5678", default_place: "",
        }),
        base("u-kim", {
          email: "kim@example.com", name: "김홍보", role: "user", slug: "kim",
          page_title: "OO대학교 고교 방문 홍보 신청",
          page_intro: "학과 소개와 입시 안내를 위해 학교로 직접 찾아갑니다.\n편하신 시간을 골라 신청해 주세요. 신청 즉시 확정됩니다.",
          contact_phone: "010-2345-6789", default_place: "학교 시청각실",
        }),
      ];
      const open = [];
      for (let off = 1; off <= 20; off++) {
        if (isWeekend(off)) continue;
        for (const uid of ["u-kim", "u-admin"]) {
          open.push({ user_id: uid, start_at: at(off, "10:00"), end_at: at(off, "12:00") });
          open.push({ user_id: uid, start_at: at(off, "13:30"), end_at: at(off, "17:00") });
        }
      }
      // 구글 캘린더 '바쁨' 예시
      const busy = [];
      for (let off = 1; off <= 20; off++) {
        if (isWeekend(off)) continue;
        if (off % 3 === 1) busy.push({ user_id: "u-kim", start_at: at(off, "10:30"), end_at: at(off, "11:30") });
        if (off % 4 === 2) busy.push({ user_id: "u-kim", start_at: at(off, "15:00"), end_at: at(off, "16:30") });
        if (off % 2 === 0) busy.push({ user_id: "u-admin", start_at: at(off, "14:00"), end_at: at(off, "15:00") });
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
      const allowed = [
        { email: "admin@example.com", role: "admin" },
        { email: "kim@example.com", role: "user" },
        { email: "choi@example.com", role: "user" },
      ];
      return { profiles, open, busy, bookings, allowed };
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
      async signIn(role) {
        setSession(role === "admin" ? "u-admin" : "u-kim");
        return me();
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
      async myBusy(from, to) {
        const p = need();
        return load().busy.filter((x) => x.user_id === p.id && inRange(x, from, to)).map((x) => pick(x, ["start_at", "end_at"]));
      },
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
      async listAllowed() { needAdmin(); return load().allowed.slice(); },
      async addAllowed(email, role) {
        needAdmin();
        const db = load();
        email = email.trim().toLowerCase();
        const ex = db.allowed.find((a) => a.email === email);
        if (ex) ex.role = role; else db.allowed.push({ email, role });
        save();
      },
      async removeAllowed(email) { needAdmin(); const db = load(); db.allowed = db.allowed.filter((a) => a.email !== email); save(); },
      async listUsers() { needAdmin(); return load().profiles.slice(); },
      async setUserActive(id, active) { needAdmin(); const u = load().profiles.find((p) => p.id === id); if (u) { u.active = active; save(); } },
      async listAllBookings() {
        needAdmin();
        const db = load();
        return db.bookings
          .map((b) => ({ ...b, owner_name: (db.profiles.find((p) => p.id === b.user_id) || {}).name || "" }))
          .sort((a, b) => T.ms(a.start_at) - T.ms(b.start_at));
      },
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
        const blocked = [
          ...db.busy.filter((x) => x.user_id === p.id && inRange(x, from, to)),
          ...db.bookings.filter((x) => x.user_id === p.id && x.status === "confirmed" && inRange(x, from, to)),
        ].map((x) => pick(x, ["start_at", "end_at"]));
        return wait({ open, blocked });
      },
      async book(slug, start_at, fields) {
        const db = load();
        const p = db.profiles.find((x) => x.slug === slug && x.active);
        if (!p) throw new Error("신청 페이지를 찾지 못했어요.");
        const end_at = new Date(T.ms(start_at) + p.duration_minutes * 60000).toISOString();
        if (T.ms(start_at) <= Date.now()) throw new Error("지난 시간은 신청할 수 없어요.");
        const open = db.open.filter((x) => x.user_id === p.id);
        if (!T.covered(open, start_at, end_at)) throw new Error("방금 그 시간이 닫혔어요. 다른 시간을 골라 주세요.");
        const clash = [...db.busy.filter((x) => x.user_id === p.id), ...db.bookings.filter((x) => x.user_id === p.id && x.status === "confirmed")]
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
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
    });
    let current = null;
    const fail = (error) => { if (error) throw new Error(error.message || "요청을 처리하지 못했어요."); };

    async function fn(body) {
      const { data, error } = await sb.functions.invoke("public-api", { body });
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
      // 구글 로그인 직후에만 갱신 토큰이 들어옵니다. 캘린더 조회용으로 서버에 보관합니다.
      if (session.provider_refresh_token) {
        await sb.rpc("save_google_token", { token: session.provider_refresh_token });
      }
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
      async signIn() {
        const { error } = await sb.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: location.origin + location.pathname,
            scopes: "https://www.googleapis.com/auth/calendar.freebusy",
            queryParams: { access_type: "offline", prompt: "consent" },
          },
        });
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
      async myBusy(from, to) {
        const r = await fn({ action: "busy_self", from, to });
        return r.busy || [];
      },
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
      async listAllowed() {
        const { data, error } = await sb.from("allowed_emails").select("*").order("created_at");
        fail(error);
        return data;
      },
      async addAllowed(email, role) {
        const { error } = await sb.from("allowed_emails").upsert({ email: email.trim().toLowerCase(), role });
        fail(error);
      },
      async removeAllowed(email) {
        const { error } = await sb.from("allowed_emails").delete().eq("email", email);
        fail(error);
      },
      async listUsers() {
        const { data, error } = await sb.from("profiles").select("*").order("created_at");
        fail(error);
        return data;
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
      async publicPage(slug) {
        const r = await fn({ action: "page", slug });
        return r.page || null;
      },
      async availability(slug, from, to) {
        return fn({ action: "availability", slug, from, to });
      },
      async book(slug, start_at, fields) {
        return fn({ action: "book", slug, start_at, fields });
      },
    };
  }

  window.API = DEMO ? demoApi() : supabaseApi();
})();
