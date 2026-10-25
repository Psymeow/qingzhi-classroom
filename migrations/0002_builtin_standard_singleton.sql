-- ============================================================
-- 情智相长课堂分析工作台 · 内置标准收敛为「系统单例」
-- 背景：内置标准原先按用户逐份播种（ensureBuiltinStandard 以 code+owner_id 为键查找，
--       每个账号首次打开工作台都会各自插一份 v5.1 副本）；而读策略是
--       is_active = true 或 auth.uid() = owner_id，启用行全员可读，
--       于是同一份标准在「评价标准」下拉里重复出现 N 次（N = 用过的账号数）。
-- 本迁移：合并重复副本 -> 保留一份 owner_id 为空的系统单例 -> 加唯一索引
--         -> 放开内置单例的写入策略（供版本升级自愈）。
-- 幂等：可重复执行。执行前请备份 standard_sets 与 lessons.standard_set_id。
-- ============================================================

begin;

-- 1) 课例改指向保留行（避免外键指向即将删除的行）
update public.lessons
   set standard_set_id = 'd635ffba-0757-47c8-a284-cf7b41ad1b02'
 where standard_set_id in (
   'e677c2e4-c525-43a3-89cd-815cd4b18a1c',
   'aabe6555-3519-4d5b-a7d9-708a61bd97b0'
 );

-- 2) 删除重复副本（三份 v5.1 的 content md5 一致：261639d8c65e0450e73cac1e657df1db）
delete from public.standard_sets
 where id in (
   'e677c2e4-c525-43a3-89cd-815cd4b18a1c',
   'aabe6555-3519-4d5b-a7d9-708a61bd97b0'
 );

-- 3) 保留行转为系统单例（owner 为空 = 系统内置，不再绑定某个账号）
update public.standard_sets
   set owner_id = null,
       is_active = true,
       updated_at = now()
 where code = 'qzxc-math-v5' and version = '5.1';

-- 4) 同一 code+version 的系统内置行只允许一份（并发播种时由唯一索引兜底）
create unique index if not exists standard_sets_builtin_singleton_uk
  on public.standard_sets (code, version)
  where scope = 'builtin' and owner_id is null;

-- 5) 写入策略：本人行照旧；系统内置单例（owner 为空）允许登录用户维护，便于版本升级自愈
drop policy if exists standard_sets_insert_own on public.standard_sets;
drop policy if exists standard_sets_update_own on public.standard_sets;
drop policy if exists standard_sets_delete_own on public.standard_sets;
create policy standard_sets_insert_own on public.standard_sets for insert
  with check (auth.uid()::text = owner_id or (scope = 'builtin' and owner_id is null));
create policy standard_sets_update_own on public.standard_sets for update
  using (auth.uid()::text = owner_id or (scope = 'builtin' and owner_id is null))
  with check (auth.uid()::text = owner_id or (scope = 'builtin' and owner_id is null));
create policy standard_sets_delete_own on public.standard_sets for delete
  using (auth.uid()::text = owner_id);

-- 6) 停用 v4.0 旧版标准（早期五维模型，无课型分型；数据保留，仅不再出现在选择列表）
update public.standard_sets set is_active = false where code = 'qzxc-math-v4';

commit;
