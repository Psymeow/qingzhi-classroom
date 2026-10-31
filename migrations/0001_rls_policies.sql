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
