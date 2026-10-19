// 신청자(로그인 없음)와 사용자 화면이 함께 쓰는 서버 함수.
// - page: 신청 페이지 공개 정보
// - availability: 열린 시간 + 막힌 시간(구글 캘린더 바쁨, 확정 예약). 일정 내용은 내보내지 않음
// - book: 겹침을 다시 검사한 뒤 예약 저장
// - busy_self: 로그인한 사용자 본인의 구글 캘린더 바쁜 시간
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const priv = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }, db: { schema: "private" } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);

const PUBLIC_FIELDS =
  "id, slug, name, page_title, page_intro, contact_phone, default_place, slot_minutes, duration_minutes, days_ahead, day_start, day_end, confirm_template, active";

type Span = { start_at: string; end_at: string };
const ms = (s: string | Date) => new Date(s).getTime();
const overlaps = (a: Span, b: Span) => ms(a.start_at) < ms(b.end_at) && ms(b.start_at) < ms(a.end_at);
function covered(list: Span[], s: number, e: number) {
  const xs = list.map((x) => [ms(x.start_at), ms(x.end_at)]).sort((a, b) => a[0] - b[0]);
  let reach = s;
  for (const [a, b] of xs) {
    if (a > reach) break;
    if (b > reach) reach = b;
    if (reach >= e) return true;
  }
  return reach >= e;
}
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function pageBySlug(slug: string) {
  const { data } = await db.from("profiles").select(PUBLIC_FIELDS).eq("slug", slug).eq("active", true).maybeSingle();
  return data;
}

// 구글 캘린더 '바쁨' 시간만 가져옵니다. 연결이 없거나 실패하면 빈 목록.
async function googleBusy(userId: string, from: string, to: string): Promise<Span[]> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return [];
  const { data: tok } = await priv.from("google_tokens").select("refresh_token").eq("user_id", userId).maybeSingle();
  if (!tok?.refresh_token) return [];
  try {
    const t = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: tok.refresh_token,
        grant_type: "refresh_token",
      }),
    }).then((r) => r.json());
    if (!t.access_token) return [];
    const fb = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${t.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: "primary" }] }),
    }).then((r) => r.json());
    const busy = fb?.calendars?.primary?.busy ?? [];
    return busy.map((b: { start: string; end: string }) => ({ start_at: b.start, end_at: b.end }));
  } catch (_e) {
    return [];
  }
}

async function blockedFor(userId: string, from: string, to: string): Promise<Span[]> {
  const [{ data: bk }, busy] = await Promise.all([
    db.from("bookings").select("start_at, end_at").eq("user_id", userId).eq("status", "confirmed").lt("start_at", to).gt("end_at", from),
    googleBusy(userId, from, to),
  ]);
  return [...(bk ?? []), ...busy];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("POST만 받아요.", 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_e) { return fail("요청 형식이 올바르지 않아요."); }
  const action = String(body.action ?? "");

  if (action === "busy_self") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return fail("로그인이 필요해요.", 401);
    const from = String(body.from), to = String(body.to);
    if (isNaN(ms(from)) || isNaN(ms(to)) || ms(to) - ms(from) > 45 * 86400000) return fail("기간이 올바르지 않아요.");
    return json({ busy: await googleBusy(u.user.id, from, to) });
  }

  const slug = clean(body.slug, 40);
  const page = await pageBySlug(slug);
  if (!page) return fail("신청 페이지를 찾지 못했어요.", 404);
  const { id: userId, ...publicPage } = page;

  if (action === "page") return json({ page: publicPage });

  if (action === "availability") {
    const from = String(body.from), to = String(body.to);
    if (isNaN(ms(from)) || isNaN(ms(to)) || ms(to) <= ms(from) || ms(to) - ms(from) > 45 * 86400000) return fail("기간이 올바르지 않아요.");
    const [{ data: open }, blocked] = await Promise.all([
      db.from("open_slots").select("start_at, end_at").eq("user_id", userId).lt("start_at", to).gt("end_at", from),
      blockedFor(userId, from, to),
    ]);
    return json({ open: open ?? [], blocked });
  }

  if (action === "book") {
    const f = (body.fields ?? {}) as Record<string, unknown>;
    const fields = {
      school: clean(f.school, 100),
      contact_name: clean(f.contact_name, 50),
      phone: clean(f.phone, 20),
      target: clean(f.target, 100),
      place: clean(f.place, 100),
      request: clean(f.request, 1000),
    };
    if (!fields.school || !fields.contact_name || fields.phone.length < 8) return fail("학교명, 성함, 연락처를 입력해 주세요.");
    const s = ms(String(body.start_at));
    if (isNaN(s)) return fail("시간이 올바르지 않아요.");
    // 신청자는 칸 단위로 시작·끝을 고릅니다 (최대 4시간)
    const e = ms(String(body.end_at));
    const unitMs = page.slot_minutes * 60000;
    if (isNaN(e) || e - s < unitMs || e - s > 240 * 60000 || (e - s) % unitMs !== 0) return fail("신청 시간이 올바르지 않아요.");
    const now = Date.now();
    if (s <= now) return fail("지난 시간은 신청할 수 없어요.");
    if (s > now + (page.days_ahead + 1) * 86400000) return fail("신청 받는 기간을 벗어났어요.");
    const span = { start_at: new Date(s).toISOString(), end_at: new Date(e).toISOString() };
    const { data: open } = await db.from("open_slots").select("start_at, end_at").eq("user_id", userId)
      .lt("start_at", span.end_at).gt("end_at", span.start_at);
    if (!covered(open ?? [], s, e)) return fail("방금 그 시간이 닫혔어요. 다른 시간을 골라 주세요.", 409);
    const blocked = await blockedFor(userId, span.start_at, span.end_at);
    if (blocked.some((b) => overlaps(b, span))) return fail("방금 다른 일정이 들어왔어요. 다른 시간을 골라 주세요.", 409);
    const { data: booking, error } = await db.from("bookings").insert({ user_id: userId, ...span, ...fields }).select().single();
    if (error) {
      if (error.code === "23P01") return fail("방금 다른 분이 그 시간을 신청했어요. 다른 시간을 골라 주세요.", 409);
      return fail("신청을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.", 500);
    }
    const { user_id: _u, ...safe } = booking;
    return json({ booking: safe, page: publicPage });
  }

  return fail("알 수 없는 요청이에요.");
});
