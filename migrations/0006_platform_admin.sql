-- ============================================================
-- 0006 · 平台总控台（平台级管理员）
-- 目标：让平台开发者/运营登录后看到全部机构、账号、课例与评分结果。
--      不改动任何既有 RLS——总台数据全部走 SECURITY DEFINER 只读函数。
-- 角色：platform_admins = 平台白名单，与机构内 admin/leader/teacher 完全独立。
-- 安全：
--   1) 表只留「本人读自己」策略，无 insert/update/delete 策略，
--      白名单只能由运维写入（exec_sql / 服务端），客户端改不动。
--   2) 4 个只读函数全部 returns jsonb——沿用 0005 的教训：
--      returns table 的返回变量会与列名解析冲突（column reference ambiguous）。
--   3) 每个函数体内显式校验白名单，杜绝 authenticated 角色直连滥用。
--   4) revoke from public, anon；只 grant 给 authenticated。
-- ============================================================

-- 1. 平台白名单
create table if not exists public.platform_admins (
  user_id varchar(36) primary key,
  email text not null unique,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists platform_admins_read on public.platform_admins;
create policy platform_admins_read on public.platform_admins for select
  using (user_id = auth.uid()::text);

-- 2. 判定函数（接口层与四个 RPC 都靠它把关）
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins p where p.user_id = auth.uid()::text);
$$;

-- 3. 只读 RPC
create or replace function public.platform_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if auth.uid()::text is null or not exists (select 1 from public.platform_admins p where p.user_id = auth.uid()::text) then
    raise exception 'FORBIDDEN';
  end if;
  select jsonb_build_object(
    'org_count', (select count(*) from public.organizations o),
    'user_count', (select count(*) from auth.users u),
    'member_count', (select count(*) from public.org_members m where m.status = 'active'),
    'lesson_count', (select count(*) from public.lessons l),
    'report_count', (select count(*) from public.reports r),
    'avg_score', coalesce((select round(avg(r.total_score)::numeric, 2) from public.reports r), 0)
  ) into v_out;
  return v_out;
end $$;

create or replace function public.platform_orgs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if auth.uid()::text is null or not exists (select 1 from public.platform_admins p where p.user_id = auth.uid()::text) then
    raise exception 'FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(sub.r order by sub.ord desc), '[]'::jsonb) into v_out
  from (
    select o.created_at as ord,
      jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'invite_code', o.invite_code,
        'owner_email', coalesce((select u.email from auth.users u where u.id::text = o.owner_id), ''),
        'member_count', (select count(*) from public.org_members m where m.org_id = o.id and m.status = 'active'),
        'lesson_count', (select count(*) from public.lessons l where l.org_id = o.id),
        'created_at', to_char(o.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
      ) as r
    from public.organizations o
  ) sub;
  return v_out;
end $$;

create or replace function public.platform_users() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if auth.uid()::text is null or not exists (select 1 from public.platform_admins p where p.user_id = auth.uid()::text) then
    raise exception 'FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(sub.r order by sub.ord desc), '[]'::jsonb) into v_out
  from (
    select u.created_at as ord,
      jsonb_build_object(
        'user_id', u.id::text,
        'email', coalesce(u.email, ''),
        'joined_at', to_char(u.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
        'role', coalesce((select m.role from public.org_members m where m.user_id = u.id::text and m.status = 'active' limit 1), ''),
        'org_name', coalesce((select o.name from public.org_members m join public.organizations o on o.id = m.org_id where m.user_id = u.id::text and m.status = 'active' limit 1), ''),
        'lesson_count', (select count(*) from public.lessons l where l.user_id = u.id::text)
      ) as r
    from auth.users u
  ) sub;
  return v_out;
end $$;

create or replace function public.platform_lessons(p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if auth.uid()::text is null or not exists (select 1 from public.platform_admins p where p.user_id = auth.uid()::text) then
    raise exception 'FORBIDDEN';
  end if;
  select coalesce(jsonb_agg(sub.r order by sub.ord desc), '[]'::jsonb) into v_out
  from (
    select l.created_at as ord,
      jsonb_build_object(
        'id', l.id,
        'title', coalesce(l.title, ''),
        'status', l.status,
        'lesson_type', coalesce(l.lesson_type, ''),
        'teacher_name', coalesce(l.teacher_name, ''),
        'visibility', l.visibility,
        'org_id', coalesce(l.org_id, ''),
        'owner_email', coalesce((select u.email from auth.users u where u.id::text = l.user_id), ''),
        'total_score', (select r.total_score from public.reports r where r.lesson_id = l.id order by r.created_at desc limit 1),
        'report_count', (select count(*) from public.reports r2 where r2.lesson_id = l.id),
        'created_at', to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
      ) as r
    from public.lessons l
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  ) sub;
  return v_out;
end $$;

-- 4. 权限收敛
do $d$
begin
  execute 'revoke all on function public.is_platform_admin() from public, anon';
  execute 'revoke all on function public.platform_overview() from public, anon';
  execute 'revoke all on function public.platform_orgs() from public, anon';
  execute 'revoke all on function public.platform_users() from public, anon';
  execute 'revoke all on function public.platform_lessons(integer) from public, anon';
  execute 'grant execute on function public.is_platform_admin() to authenticated';
  execute 'grant execute on function public.platform_overview() to authenticated';
  execute 'grant execute on function public.platform_orgs() to authenticated';
  execute 'grant execute on function public.platform_users() to authenticated';
  execute 'grant execute on function public.platform_lessons(integer) to authenticated';
end $d$;

-- 5. 白名单（仅运维写入；新增管理员复制这一行改 user_id/email 即可）
insert into public.platform_admins(user_id, email)
values ('1f04082a-032f-4332-91b8-d68582b4d953', 'xujingwei0602@163.com')
on conflict (user_id) do update set email = excluded.email;

-- ============================================================
-- 反证（执行后逐条验证）：
-- 1) 匿名或非白名单调用 select public.platform_overview(); → FORBIDDEN。
-- 2) 非白名单账号 GET /api/admin → 403，/admin 页显示「没有平台管理权限」。
-- 3) 非白名单账号直连 select * from public.platform_admins; → 0 行（RLS 本人策略）。
-- 4) 白名单账号调用 4 个 RPC 返回全量数据，/admin 页三张表正常。
-- 5) 机构内 admin（非白名单）访问 /admin 仍是 403——平台权限与机构权限互不传导。
-- ============================================================
