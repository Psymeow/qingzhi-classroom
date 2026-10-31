-- ============================================================
-- 0001 · RLS 策略全集（反向导出版）
-- 本文件由 2026-10-28 从生产库反向导出，对应当前生效的对象定义。
--
-- 范围：public schema 11 张业务表的 RLS 启用 + 41 条策略 + 表级授权。
-- 策略分组：lessons/lesson_assets/ai_analysis_inputs/annotations/reports 各 5，
--          standard_sets 4，profiles 3，organizations 3，report_runs 3,
--          org_members 2，platform_admins 1，合计 41 条。
-- 幂等：drop policy if exists + create policy，可重复执行。
--
-- 归属备注：
--   - platform_admins 表结构见 0006，此处仅为策略全集完整性保留。
--   - report_runs 表结构与策略见 0007，此处冗余一份保证 0001 自洽。
--   - standard_sets_insert_own / update_own 的现行版本由 0002 重定义，此处为现行定义。
--   - organizations / org_members 表结构见 0003。
-- ============================================================

-- ============================================================
-- 前置依赖：机构归属判定函数
-- 以下三个函数与 0003 重复定义，内容完全一致、幂等；
-- 仅为让本文件可独立执行，不依赖文件编号顺序（0001 < 0003）。
-- ============================================================

create or replace function public.my_org_ids()
returns setof character varying
language sql
stable security definer
set search_path to 'public'
as $function$
  select org_id from public.org_members
  where user_id = auth.uid()::text and status = 'active';
$function$;

create or replace function public.my_leader_org_ids()
returns setof character varying
language sql
stable security definer
set search_path to 'public'
as $function$
  select org_id from public.org_members
  where user_id = auth.uid()::text and status = 'active' and role in ('admin','leader');
$function$;

create or replace function public.my_admin_org_ids()
returns setof character varying
language sql
stable security definer
set search_path to 'public'
as $function$
  select org_id from public.org_members
  where user_id = auth.uid()::text and status = 'active' and role = 'admin';
$function$;

-- ---------- lessons ----------
alter table public.lessons enable row level security;
grant select, insert, update, delete, references, trigger, truncate on public.lessons to anon, authenticated, service_role;

drop policy if exists lessons_select_own on public.lessons;
create policy lessons_select_own on public.lessons for select
  using (auth.uid()::text = user_id);
drop policy if exists lessons_insert_own on public.lessons;
create policy lessons_insert_own on public.lessons for insert
  with check (auth.uid()::text = user_id);
drop policy if exists lessons_update_own on public.lessons;
create policy lessons_update_own on public.lessons for update
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
drop policy if exists lessons_delete_own on public.lessons;
create policy lessons_delete_own on public.lessons for delete
  using (auth.uid()::text = user_id);
-- 机构可见课例：本机构全员可读；教研组长/管理员可跨 visibility 读本机构全部课例
drop policy if exists lessons_org_read on public.lessons;
create policy lessons_org_read on public.lessons for select
  using (
    (visibility = 'org' and org_id in (select my_org_ids()))
    or (org_id in (select my_leader_org_ids()))
  );

-- ---------- lesson_assets ----------
alter table public.lesson_assets enable row level security;
grant select, insert, update, delete, references, trigger, truncate on public.lesson_assets to anon, authenticated, service_role;

drop policy if exists assets_select_own on public.lesson_assets;
create policy assets_select_own on public.lesson_assets for select
  using (auth.uid()::text = user_id);
drop policy if exists assets_insert_own on public.lesson_assets;
create policy assets_insert_own on public.lesson_assets for insert
  with check (auth.uid()::text = user_id);
drop policy if exists assets_update_own on public.lesson_assets;
create policy assets_update_own on public.lesson_assets for update
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);
drop policy if exists assets_delete_own on public.lesson_assets;
create policy assets_delete_own on public.lesson_assets for delete
  using (auth.uid()::text = user_id);
drop policy if exists assets_org_read on public.lesson_assets;
create policy assets_org_read on public.lesson_assets for select
  using (exists (
    select 1 from lessons l
    where l.id = lesson_assets.lesson_id
      and ((l.visibility = 'org' and l.org_id in (select my_org_ids()))
           or (l.org_id in (select my_leader_org_ids())))
  ));
