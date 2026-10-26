-- ============================================================
-- 0008 · 平台后台健康自检（schema 探针）
-- 目标：部署后第一条命令就能确认「迁移先于代码」这条纪律被执行了。
--      检查后台与核心业务链路实际依赖的表 / 列 / 函数是否存在，
--      任一项缺失就说明有迁移没跑，而不是等用户点进页面才 500。
-- 角色：仅 platform_admins 白名单可调用（函数体内显式校验）。
-- 安全：security definer + revoke from public/anon，只 grant 给 authenticated。
-- 幂等：create or replace，可重复执行。
-- ============================================================

create or replace function public.platform_schema_check() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if auth.uid()::text is null
     or not exists (select 1 from public.platform_admins p where p.user_id = auth.uid()::text) then
    raise exception 'FORBIDDEN';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'name', t.n,
               'ok', t.ok,
               'detail', case when t.ok then '' else t.fix end
             ) order by t.ok, t.n
           ),
           '[]'::jsonb
         )
  into v_out
  from (
    -- ---------- 核心表 ----------
    select '表 lessons'::text as n,
           (to_regclass('public.lessons') is not null) as ok,
           '缺表：先执行 0001 迁移'::text as fix
    union all
    select '表 lesson_assets',
           (to_regclass('public.lesson_assets') is not null),
           '缺表：先执行 0001 迁移'
    union all
    select '表 ai_analysis_inputs',
           (to_regclass('public.ai_analysis_inputs') is not null),
           '缺表：先执行 0001 迁移'
    union all
    select '表 annotations',
           (to_regclass('public.annotations') is not null),
           '缺表：先执行 0001 迁移'
    union all
    select '表 reports',
           (to_regclass('public.reports') is not null),
           '缺表：先执行 0001 迁移'
    union all
    select '表 standard_sets',
           (to_regclass('public.standard_sets') is not null),
           '缺表：先执行 0001 迁移'
    union all
    select '表 organizations',
           (to_regclass('public.organizations') is not null),
           '缺表：先执行 0003 迁移'
    union all
    select '表 org_members',
           (to_regclass('public.org_members') is not null),
           '缺表：先执行 0003 迁移'
    union all
    -- 运行历史是「可选增强」：缺表时后端自动降级，不阻塞分析，但界面不显示轨迹
    select '表 report_runs（运行历史，可选）',
           (to_regclass('public.report_runs') is not null),
           '缺表：执行 0007 迁移后才会记录运行历史，缺表时界面显示「未启用」'
    union all
    select '表 platform_admins',
           (to_regclass('public.platform_admins') is not null),
           '缺表：先执行 0006 迁移'
    -- ---------- 后台聚合实际读取的列 ----------
    union all
    select '列 lessons.org_id',
           exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'lessons' and c.column_name = 'org_id'),
           '缺列：执行 0003 迁移（后台按机构统计依赖它）'
    union all
    select '列 lessons.visibility',
           exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'lessons' and c.column_name = 'visibility'),
           '缺列：执行 0003 迁移（后台可见性列依赖它）'
    union all
    select '列 reports.total_score',
           exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'reports' and c.column_name = 'total_score'),
           '缺列：先执行 0001 迁移（后台平均分依赖它）'
    union all
    select '列 org_members.status',
           exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'org_members' and c.column_name = 'status'),
           '缺列：执行 0003 迁移（在职成员数依赖它）'
    union all
    select '列 report_runs.run_no（运行历史，可选）',
           exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'report_runs' and c.column_name = 'run_no'),
           '缺列：执行 0007 迁移'
    union all
    select '列 ai_analysis_inputs.segments',
           exists (select 1 from information_schema.columns c
                    where c.table_schema = 'public' and c.table_name = 'ai_analysis_inputs' and c.column_name = 'segments'),
           '缺列：执行 0004 迁移（课堂切片时间轴依赖它）'
    -- ---------- 后台依赖的函数 ----------
    union all
    select '函数 is_platform_admin()',
           (to_regprocedure('public.is_platform_admin()') is not null),
           '缺函数：执行 0006 迁移'
    union all
    select '函数 platform_overview()',
           (to_regprocedure('public.platform_overview()') is not null),
           '缺函数：执行 0006 迁移'
    union all
    select '函数 platform_orgs()',
           (to_regprocedure('public.platform_orgs()') is not null),
           '缺函数：执行 0006 迁移'
    union all
    select '函数 platform_users()',
           (to_regprocedure('public.platform_users()') is not null),
           '缺函数：执行 0006 迁移'
    union all
    select '函数 platform_lessons(integer)',
           (to_regprocedure('public.platform_lessons(integer)') is not null),
           '缺函数：执行 0006 迁移'
  ) t;

  return v_out;
end $$;

revoke all on function public.platform_schema_check() from public;
revoke all on function public.platform_schema_check() from anon;
grant execute on function public.platform_schema_check() to authenticated;

comment on function public.platform_schema_check() is
  '平台后台健康自检：返回表/列/函数的探针结果数组，供 /api/admin/health/schema 使用';
