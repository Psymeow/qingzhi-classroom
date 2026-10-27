-- ============================================================
-- 0009_platform_lesson_filters.sql
-- 平台总控台课例列表支持服务端筛选（状态 / 时间范围 / 有无报告）。
--
-- 为什么走服务端而不是前端本地筛：
-- platform_lessons 只返回最近 1000 条，前端本地筛会出现「看起来能筛、
-- 实际漏掉更早数据」的假象——比不筛更危险（善研坑 4「参数静默忽略」的同类问题）。
-- 因此筛选条件全部下推到 SQL，前端拿到的就是完整的筛选结果。
--
-- 与 /api/admin 的参数约定（全部可选，非法值一律 400，不静默退化）：
--   lesson_status      : draft | analyzed | reviewed
--   lesson_from        : YYYY-MM-DD（含当日，按 UTC 比对，与列表展示格式一致）
--   lesson_to          : YYYY-MM-DD（含当日）
--   lesson_has_report  : true | false
--
-- 参数白名单在两层都校验：接口层校验格式，函数体内再校验一次。
-- ============================================================

create or replace function public.platform_lessons(
  p_limit integer default 200,
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_has_report boolean default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  -- 第一层：平台白名单
  if auth.uid()::text is null or not exists (select 1 from public.platform_admins p where p.user_id = auth.uid()::text) then
    raise exception 'FORBIDDEN';
  end if;

  -- 第二层：枚举白名单。非法状态不能被当作「无筛选」处理。
  if p_status is not null and p_status not in ('draft', 'analyzed', 'reviewed') then
    raise exception 'INVALID_STATUS';
  end if;

  -- 日期参数自相矛盾时直接报错，不静默交换
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'INVALID_RANGE';
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
    where (p_status is null or l.status = p_status)
      and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'UTC'))
      and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone 'UTC'))
      and (p_has_report is null
           or (exists (select 1 from public.reports r3 where r3.lesson_id = l.id) = p_has_report))
    order by l.created_at desc
    limit least(greatest(coalesce(p_limit, 200), 1), 1000)
  ) sub;

  return v_out;
end $$;

comment on function public.platform_lessons(integer, text, date, date, boolean) is
  '平台总控台课例列表（只读元数据）。筛选参数白名单在函数体内二次校验，非法枚举抛 INVALID_STATUS。';

-- 授权保持不变（0006 已授予，create or replace 保留权限），此处仅显式确认边界：
revoke all on function public.platform_lessons(integer, text, date, date, boolean) from public;
revoke all on function public.platform_lessons(integer, text, date, date, boolean) from anon;
