-- ============================================================
-- 0003 · 机构与协作（V1.11）
-- 目标：在不破坏现有单人 RLS 的前提下，引入「机构 → 成员 → 课例可见性」
-- 兼容：lessons.org_id 可空；存量数据 visibility 默认 private
-- 角色：admin（机构管理员/创建者）、leader（教研组长）、teacher（普通教师）
-- 说明：写操作全部走服务端 API + RLS；加入机构必须通过邀请码函数，
--      不在 org_members 上开放 insert 策略，避免猜到 org_id 直接入组。
-- ============================================================

-- 1. 机构
create table if not exists public.organizations (
  id varchar(36) primary key default gen_random_uuid(),
  name varchar(255) not null,
  owner_id varchar(36) not null,
  invite_code varchar(16) not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists organizations_owner_idx on public.organizations(owner_id);

-- 2. 成员
create table if not exists public.org_members (
  id varchar(36) primary key default gen_random_uuid(),
  org_id varchar(36) not null references public.organizations(id) on delete cascade,
  user_id varchar(36) not null,
  display_name varchar(128),
  role varchar(16) not null default 'teacher',
  status varchar(16) not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists org_members_org_idx on public.org_members(org_id);
create index if not exists org_members_user_idx on public.org_members(user_id);

-- 3. 课例归属与可见性
alter table public.lessons add column if not exists org_id varchar(36) references public.organizations(id) on delete set null;
alter table public.lessons add column if not exists visibility varchar(16) not null default 'private';
create index if not exists lessons_org_idx on public.lessons(org_id);

-- 4. 成员身份判定（security definer 规避策略自引用递归）
create or replace function public.my_org_ids() returns setof varchar
language sql stable security definer set search_path = public as $$
  select org_id from public.org_members
  where user_id = auth.uid()::text and status = 'active';
$$;

create or replace function public.my_leader_org_ids() returns setof varchar
language sql stable security definer set search_path = public as $$
  select org_id from public.org_members
  where user_id = auth.uid()::text and status = 'active' and role in ('admin','leader');
$$;

create or replace function public.my_admin_org_ids() returns setof varchar
language sql stable security definer set search_path = public as $$
  select org_id from public.org_members
  where user_id = auth.uid()::text and status = 'active' and role = 'admin';
$$;

-- 5. 邀请码加入（唯一合法入组入口）
create or replace function public.join_org_by_invite(p_code text)
returns table (org_id varchar, role varchar)
language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.uid()::text;
  v_org varchar(36);
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if exists (select 1 from public.org_members m where m.user_id = v_uid and m.status = 'active') then
    raise exception 'ALREADY_IN_ORG';
  end if;
  select o.id into v_org from public.organizations o
    where upper(o.invite_code) = upper(btrim(p_code));
  if v_org is null then
    raise exception 'INVITE_CODE_INVALID';
  end if;
  insert into public.org_members(org_id, user_id, role, status)
  values (v_org, v_uid, 'teacher', 'active')
  on conflict (org_id, user_id) do update set status = 'active', updated_at = now();
  return query
    select m.org_id, m.role from public.org_members m
    where m.org_id = v_org and m.user_id = v_uid;
end $$;

-- 6. RLS：organizations
alter table public.organizations enable row level security;
drop policy if exists organizations_read on public.organizations;
drop policy if exists organizations_insert on public.organizations;
drop policy if exists organizations_update on public.organizations;
create policy organizations_read on public.organizations for select
  using (owner_id = auth.uid()::text or id in (select * from public.my_org_ids()));
create policy organizations_insert on public.organizations for insert
  with check (owner_id = auth.uid()::text);
create policy organizations_update on public.organizations for update
  using (owner_id = auth.uid()::text) with check (owner_id = auth.uid()::text);

-- 7. RLS：org_members（本人可读自己的行；同机构成员可读名单；admin 可改角色/软移除）
alter table public.org_members enable row level security;
drop policy if exists org_members_read on public.org_members;
drop policy if exists org_members_admin_update on public.org_members;
create policy org_members_read on public.org_members for select
  using (user_id = auth.uid()::text or org_id in (select * from public.my_org_ids()));
create policy org_members_admin_update on public.org_members for update
  using (org_id in (select * from public.my_admin_org_ids()))
  with check (org_id in (select * from public.my_admin_org_ids()));

-- 8. RLS：lessons 机构可见（permissive，与既有 own 策略取并集）
--    admin/leader 可读机构全部；teacher 只额外读到 visibility='org' 的共享课例
drop policy if exists lessons_org_read on public.lessons;
create policy lessons_org_read on public.lessons for select using (
  (visibility = 'org' and org_id in (select * from public.my_org_ids()))
  or org_id in (select * from public.my_leader_org_ids())
);

-- 9. RLS：报告/标注/AI输入/素材 跟随课例可见性（只读，写仍限本人）
drop policy if exists reports_org_read on public.reports;
create policy reports_org_read on public.reports for select using (
  exists (
    select 1 from public.lessons l
    where l.id = reports.lesson_id
      and ((l.visibility = 'org' and l.org_id in (select * from public.my_org_ids()))
           or l.org_id in (select * from public.my_leader_org_ids()))
  )
);

drop policy if exists annotations_org_read on public.annotations;
create policy annotations_org_read on public.annotations for select using (
  exists (
    select 1 from public.lessons l
    where l.id = annotations.lesson_id
      and ((l.visibility = 'org' and l.org_id in (select * from public.my_org_ids()))
           or l.org_id in (select * from public.my_leader_org_ids()))
  )
);

drop policy if exists ai_inputs_org_read on public.ai_analysis_inputs;
create policy ai_inputs_org_read on public.ai_analysis_inputs for select using (
  exists (
    select 1 from public.lessons l
    where l.id = ai_analysis_inputs.lesson_id
      and ((l.visibility = 'org' and l.org_id in (select * from public.my_org_ids()))
           or l.org_id in (select * from public.my_leader_org_ids()))
  )
);

drop policy if exists assets_org_read on public.lesson_assets;
create policy assets_org_read on public.lesson_assets for select using (
  exists (
    select 1 from public.lessons l
    where l.id = lesson_assets.lesson_id
      and ((l.visibility = 'org' and l.org_id in (select * from public.my_org_ids()))
           or l.org_id in (select * from public.my_leader_org_ids()))
  )
);

-- ============================================================
-- 反证（执行后验证）：
-- 1) 未登录：select organizations / org_members 必须 0 行。
-- 2) 非成员 A 读机构 B 的 lessons：0 行；加入后按角色变化。
-- 3) teacher 读同机构 visibility='private' 的他人课例：0 行。
-- 4) admin 读同机构任意课例：可见。
-- 5) 重复使用同一邀请码：第二次返回 ALREADY_IN_ORG。
-- ============================================================
