-- ============================================================
-- 0005 · 创建机构 RPC（修复「创建机构被 RLS 拒绝」）
-- 问题：0003 只在 organizations 上开放了 owner 自建策略，而 org_members
--      刻意不开放 insert（唯一入口是 join_org_by_invite 邀请码加入），
--      于是「建机构的人把自己写成 admin」这一步没有任何合法通道，必然报
--      new row violates row-level security policy for table "org_members"；
--      此时 organizations 那一行已经写入成功，留下 0 成员的孤儿机构。
-- 修复：与 join_org_by_invite 同风格，把「建机构 + 写 admin 成员」收进一个
--      SECURITY DEFINER 函数原子完成，并复用此前失败留下的同名空机构。
-- 说明：返回类型必须是 jsonb，不能是 returns table(org_id, ...)——那会让
--      on conflict (org_id, user_id) 的列名解析与返回变量冲突，报
--      column reference "org_id" is ambiguous。
-- ============================================================

drop function if exists public.create_organization(text);

create or replace function public.create_organization(p_name text)
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare
  v_uid text := auth.uid()::text;
  v_name text := btrim(coalesce(p_name, ''));
  v_org public.organizations%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'NAME_INVALID';
  end if;
  if exists (select 1 from public.org_members m where m.user_id = v_uid and m.status = 'active') then
    raise exception 'ALREADY_IN_ORG';
  end if;

  -- 复用此前创建失败留下的同名空机构（owner 本人 + 0 成员），避免重复堆脏数据
  select * into v_org from public.organizations o
    where o.owner_id = v_uid and o.name = v_name
      and not exists (select 1 from public.org_members m2 where m2.org_id = o.id)
    order by o.created_at desc
    limit 1;

  if v_org.id is null then
    insert into public.organizations(name, owner_id, invite_code)
    values (v_name, v_uid, upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)))
    returning * into v_org;
  end if;

  insert into public.org_members(org_id, user_id, role, status, display_name)
  values (v_org.id, v_uid, 'admin', 'active',
          nullif(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name',
                          split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1)), ''))
  on conflict (org_id, user_id) do update
    set role = 'admin', status = 'active', updated_at = now();

  return jsonb_build_object('org_id', v_org.id, 'name', v_org.name, 'invite_code', v_org.invite_code);
end $function$;

-- 只允许登录用户调用；匿名调用由函数内的 auth.uid() 拦截
revoke all on function public.create_organization(text) from public;
grant execute on function public.create_organization(text) to authenticated;

-- ============================================================
-- 反证（执行后验证）：
-- 1) 未登录调用 → UNAUTHENTICATED。
-- 2) 名称 <2 或 >80 字 → NAME_INVALID。
-- 3) 已在机构中再调 → ALREADY_IN_ORG。
-- 4) 同名空机构已存在 → 复用该机构并补 admin 成员，不再新建。
-- 5) 成功后 org_members 有且仅有本人一行 role=admin，
--    返回 {"org_id","name","invite_code"}。
-- ============================================================
