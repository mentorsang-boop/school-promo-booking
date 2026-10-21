-- 인천산업정보학교 고교 방문 홍보 예약 데이터베이스
-- Supabase SQL Editor에서 한 번 실행합니다. (이미 적용된 프로젝트에는 다시 실행하지 마세요)

create extension if not exists btree_gist;
create schema if not exists private;

-- 로그인을 허용할 구글 계정 목록 (관리자가 관리)
create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

-- 사용자 정보와 신청 페이지 설정
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  active boolean not null default true,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,30}$'),
  page_title text not null default '인천산업정보학교 고교 방문 홍보 신청',
  page_intro text not null default '편하신 날짜와 시간을 30분 단위로 골라 신청해 주세요. 신청 즉시 확정됩니다.',
  contact_phone text not null default '',
  default_place text not null default '',
  slot_minutes int not null default 30 check (slot_minutes in (10, 15, 20, 30, 60)),
  duration_minutes int not null default 60 check (duration_minutes between 10 and 480),
  days_ahead int not null default 28 check (days_ahead between 1 and 180),
  day_start text not null default '09:00' check (day_start ~ '^\d{2}:\d{2}$'),
  day_end text not null default '18:00' check (day_end ~ '^\d{2}:\d{2}$'),
  invite_template text,
  confirm_template text,
  google_connected boolean not null default false,
  created_at timestamptz not null default now()
);

-- 사용자가 열어 둔 시간
create table public.open_slots (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  check (end_at > start_at)
);
create index open_slots_user_time on public.open_slots (user_id, start_at);

-- 예약 (신청자 입력은 서버 함수만 넣을 수 있음)
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  school text not null check (length(school) between 1 and 100),
  contact_name text not null check (length(contact_name) between 1 and 50),
  phone text not null check (length(phone) between 8 and 20),
  target text not null default '' check (length(target) <= 100),
  place text not null default '' check (length(place) <= 100),
  request text not null default '' check (length(request) <= 1000),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (end_at > start_at),
  -- 같은 사용자의 확정 예약끼리 시간이 겹치면 저장되지 않음 (동시 신청 방지)
  constraint bookings_no_overlap exclude using gist (user_id with =, tstzrange(start_at, end_at) with &&) where (status = 'confirmed')
);
create index bookings_user_time on public.bookings (user_id, start_at);

-- 구글 캘린더 조회용 갱신 토큰 (API로 노출되지 않는 private 스키마)
create table private.google_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);

-- ---------- 도우미 함수 ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;

-- 로그인한 계정의 프로필을 돌려줍니다. 등록된 이메일이면 처음 로그인할 때 만들어 줍니다.
create or replace function public.ensure_profile()
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_allowed public.allowed_emails;
  v_profile public.profiles;
  v_slug text;
  v_name text;
begin
  if v_uid is null then return null; end if;
  select * into v_profile from public.profiles where id = v_uid;
  if found then return v_profile; end if;
  select * into v_allowed from public.allowed_emails where email = v_email;
  if not found then return null; end if;
  v_slug := lower(regexp_replace(split_part(v_email, '@', 1), '[^a-z0-9-]', '', 'g'));
  if length(v_slug) < 3 or exists (select 1 from public.profiles where slug = v_slug) then
    v_slug := left(coalesce(nullif(v_slug, ''), 'u'), 20) || '-' || substr(md5(random()::text), 1, 5);
  end if;
  select coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', split_part(v_email, '@', 1))
    into v_name from auth.users where id = v_uid;
  insert into public.profiles (id, email, name, role, slug)
  values (v_uid, v_email, v_name, v_allowed.role, v_slug)
  returning * into v_profile;
  return v_profile;
end;
$$;

-- 구글 로그인 직후 받은 갱신 토큰 저장
create or replace function public.save_google_token(token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(token, '') = '' then return; end if;
  insert into private.google_tokens (user_id, refresh_token, updated_at)
  values (auth.uid(), token, now())
  on conflict (user_id) do update set refresh_token = excluded.refresh_token, updated_at = now();
  update public.profiles set google_connected = true where id = auth.uid();
end;
$$;

-- 관리자가 아니면 역할·정지 여부·이메일을 바꿀 수 없음
-- (브라우저에서 직접 바꾸는 경우만 막고, 서버 함수 안에서의 변경은 허용)
create or replace function public.profiles_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.email := old.email;
    new.google_connected := old.google_connected;
  end if;
  new.id := old.id;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------- 접근 규칙 (RLS) ----------
alter table public.allowed_emails enable row level security;
alter table public.profiles enable row level security;
alter table public.open_slots enable row level security;
alter table public.bookings enable row level security;
alter table private.google_tokens enable row level security;

create policy "admin manages allowed emails" on public.allowed_emails
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "read own profile or admin" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or (select public.is_admin()));
create policy "update own profile or admin" on public.profiles
  for update to authenticated using (id = (select auth.uid()) or (select public.is_admin()))
  with check (id = (select auth.uid()) or (select public.is_admin()));

create policy "own open slots" on public.open_slots
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "admin reads open slots" on public.open_slots
  for select to authenticated using ((select public.is_admin()));

create policy "read own bookings or admin" on public.bookings
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "update own bookings or admin" on public.bookings
  for update to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()))
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

-- 신청자(anon)용 정책은 없습니다. 신청자는 public-api 서버 함수를 거쳐서만 읽고 씁니다.

-- 첫 관리자 등록: 아래 이메일을 본인 구글 계정으로 바꿔 실행하세요.
-- insert into public.allowed_emails (email, role) values ('your.name@gmail.com', 'admin');

-- ---------- v3.0: 아이디·비밀번호 로그인 ----------
-- 계정은 admin-api 서버 함수가 만들고 profiles 행도 함께 넣습니다. (allowed_emails, google_tokens는 더 이상 쓰지 않음)
alter table public.profiles add column if not exists login_id text unique check (login_id ~ '^[a-z0-9._-]{3,20}$');

create or replace function public.ensure_profile()
returns public.profiles language sql stable security definer set search_path = '' as $$
  select * from public.profiles where id = auth.uid();
$$;

create or replace function public.profiles_guard()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.role := old.role;
    new.active := old.active;
    new.email := old.email;
    new.login_id := old.login_id;
    new.google_connected := old.google_connected;
  end if;
  new.id := old.id;
  return new;
end;
$$;

-- ---------- v3.2: 신청 기간 날짜, 수업시간표 ----------
alter table public.profiles
  add column if not exists book_from date,
  add column if not exists book_until date,
  add column if not exists class_times jsonb not null default '[]'::jsonb; -- [{ wd: 1~5, s: "09:00", e: "09:50" }]

-- ---------- v3.3: 방문 학교 (관리자가 엑셀로 올림, 로그인한 선생님만 읽음) ----------
create table if not exists public.visit_schools (
  no int primary key,
  name text not null,
  promo_teacher text not null default '',
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.visit_schools enable row level security;
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;
create policy "active users read visit schools" on public.visit_schools
  for select to authenticated using ((select public.is_active_user()));
create policy "admin manages visit schools" on public.visit_schools
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- v3.4: 가입 코드 (관리자만 읽고 바꿈, admin-api가 가입 때 확인) ----------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "admin manages settings" on public.app_settings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
insert into public.app_settings (key, value)
values ('signup_code', lpad((floor(random() * 1000000))::int::text, 6, '0'))
on conflict (key) do nothing;
alter table public.profiles add column if not exists pending boolean not null default false; -- 쓰지 않음

-- ---------- v3.5: 최고 관리자 (가입 코드 변경·계정 관리·전체 예약은 최고 관리자만) ----------
alter table public.profiles add column if not exists owner boolean not null default false;
-- update public.profiles set owner = true where login_id = '최고 관리자 아이디';
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and owner and active);
$$;
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not public.is_owner() then
    new.role := old.role;
    new.active := old.active;
    new.pending := old.pending;
    new.email := old.email;
    new.login_id := old.login_id;
    new.google_connected := old.google_connected;
  end if;
  if current_user = 'authenticated' then new.owner := old.owner; end if;
  new.id := old.id;
  return new;
end;
$$;
alter policy "read own profile or admin" on public.profiles using (id = (select auth.uid()) or (select public.is_owner()));
alter policy "update own profile or admin" on public.profiles using (id = (select auth.uid()) or (select public.is_owner())) with check (id = (select auth.uid()) or (select public.is_owner()));
alter policy "read own bookings or admin" on public.bookings using (user_id = (select auth.uid()) or (select public.is_owner()));
alter policy "update own bookings or admin" on public.bookings using (user_id = (select auth.uid()) or (select public.is_owner())) with check (user_id = (select auth.uid()) or (select public.is_owner()));
alter policy "admin reads open slots" on public.open_slots using ((select public.is_owner()));
alter policy "admin manages visit schools" on public.visit_schools using ((select public.is_owner())) with check ((select public.is_owner()));
alter policy "admin manages settings" on public.app_settings using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "admins read settings" on public.app_settings for select to authenticated using ((select public.is_admin()));
-- 다른 관리자용 가입자 목록 (이름·권한·상태만)
create or replace function public.admin_basic_users()
returns table(id uuid, name text, role text, owner boolean, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요.'; end if;
  return query select p.id, p.name, p.role, p.owner, p.active from public.profiles p order by p.created_at;
end $$;
