// 아이디·비밀번호 계정 관리 서버 함수.
// - status: 관리자 계정이 아직 없는지 (처음 설정 화면용)
// - setup: 관리자 계정이 하나도 없을 때만 첫 관리자 만들기
// - signup: 선생님이 가입 코드를 넣고 직접 가입 (코드는 관리 화면에서 확인·변경)
// - create_user / reset_password / delete_user: 최고 관리자만
// 아이디는 내부적으로 `{아이디}@isg-promo.local` 이메일로 저장합니다 (메일은 보내지 않음).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const DOMAIN = "isg-promo.local";
const ID_RE = /^[a-z0-9._-]{3,20}$/;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ error: msg }, status);
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

async function hasAdmin() {
  const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("active", true);
  return (count ?? 0) > 0;
}

async function freeSlug(base: string) {
  let slug = base.replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  if (slug.length < 3) slug = "t-" + slug;
  for (let i = 0; i < 5; i++) {
    const { data } = await db.from("profiles").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
    slug = slug.slice(0, 24) + "-" + Math.random().toString(36).slice(2, 6);
  }
  return slug;
}

async function createAccount(loginId: string, password: string, name: string, role: "admin" | "user") {
  if (!ID_RE.test(loginId)) return { error: "아이디는 영어 소문자, 숫자, . _ - 로 3~20자여야 해요." };
  if (password.length < 6) return { error: "비밀번호는 6자 이상이어야 해요." };
  if (!name) return { error: "이름을 입력해 주세요." };
  const { data: dup } = await db.from("profiles").select("id").eq("login_id", loginId).maybeSingle();
  if (dup) return { error: "이미 있는 아이디예요." };
  const email = `${loginId}@${DOMAIN}`;
  const { data: created, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (error) console.error("createUser", error.message);
  if (error || !created?.user) return { error: error?.message?.includes("already") ? "이미 있는 아이디예요." : "계정을 만들지 못했어요." };
  const { error: pe } = await db.from("profiles").insert({
    id: created.user.id, email, login_id: loginId, name, role, slug: await freeSlug(loginId),
  });
  if (pe) {
    await db.auth.admin.deleteUser(created.user.id);
    return { error: "계정을 만들지 못했어요." };
  }
  return { id: created.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("POST만 받아요.", 405);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch (_e) { return fail("요청 형식이 올바르지 않아요."); }
  const action = String(body.action ?? "");
  const loginId = clean(body.login_id, 20).toLowerCase();
  const password = String(body.password ?? "");
  const name = clean(body.name, 30);

  if (action === "status") return json({ needs_setup: !(await hasAdmin()) });

  if (action === "setup") {
    if (await hasAdmin()) return fail("이미 관리자 계정이 있어요. 로그인해 주세요.", 409);
    const r = await createAccount(loginId, password, name, "admin");
    return r.error ? fail(r.error) : json({ ok: true });
  }

  // 선생님이 가입 코드를 넣고 직접 가입
  if (action === "signup") {
    const { data: setting } = await db.from("app_settings").select("value").eq("key", "signup_code").maybeSingle();
    if (!setting?.value || clean(body.code, 40) !== setting.value) return fail("가입 코드가 맞지 않아요. 관리자에게 코드를 확인해 주세요.", 403);
    const r = await createAccount(loginId, password, name, "user");
    return r.error ? fail(r.error) : json({ ok: true });
  }

  // 여기부터는 최고 관리자만 (다른 관리자는 가입자 목록 보기만 가능)
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return fail("로그인이 필요해요.", 401);
  const { data: me } = await db.from("profiles").select("role, active, owner").eq("id", u.user.id).maybeSingle();
  if (!me || me.role !== "admin" || !me.owner || !me.active) return fail("최고 관리자만 할 수 있어요.", 403);

  if (action === "create_user") {
    const role = body.role === "admin" ? "admin" : "user";
    const r = await createAccount(loginId, password, name, role);
    return r.error ? fail(r.error) : json({ ok: true, id: r.id });
  }

  const userId = clean(body.user_id, 40);
  const { data: target } = await db.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!target) return fail("계정을 찾지 못했어요.", 404);

  if (action === "reset_password") {
    if (password.length < 6) return fail("비밀번호는 6자 이상이어야 해요.");
    const { error } = await db.auth.admin.updateUserById(userId, { password });
    return error ? fail("비밀번호를 바꾸지 못했어요.", 500) : json({ ok: true });
  }

  if (action === "delete_user") {
    if (userId === u.user.id) return fail("내 계정은 삭제할 수 없어요.");
    const { error } = await db.auth.admin.deleteUser(userId);
    return error ? fail("계정을 삭제하지 못했어요.", 500) : json({ ok: true });
  }

  return fail("알 수 없는 요청이에요.");
});
