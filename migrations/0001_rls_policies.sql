-- ============================================================
-- 情智相长课堂分析工作台 · RLS 行级安全（权威版本化迁移）
-- 说明：drizzle-kit 0.31.x push 会把 pgPolicy 建成 USING/CHECK 为 NULL
--       的空壳策略（NULL 在 permissive 策略中等价于 FALSE，导致读 0 行、
--       写被 42501 拒绝）。因此 RLS 以本原生 SQL 为准，建表后必须执行本文件。
-- 幂等：可重复执行。执行后必须做合闸反证（见文件末尾注释）。
-- ============================================================

-- ---------- standard_sets：内置标准(is_active)公开读；写仅 owner ----------
drop policy if exists standard_sets_read on public.standard_sets;
drop policy if exists standard_sets_insert_own on public.standard_sets;
drop policy if exists standard_sets_update_own on public.standard_sets;
drop policy if exists standard_sets_delete_own on public.standard_sets;
create policy standard_sets_read        on public.standard_sets for select using (is_active = true or auth.uid()::text = owner_id);
create policy standard_sets_insert_own  on public.standard_sets for insert with check (auth.uid()::text = owner_id);
create policy standard_sets_update_own  on public.standard_sets for update using (auth.uid()::text = owner_id) with check (auth.uid()::text = owner_id);
create policy standard_sets_delete_own  on public.standard_sets for delete using (auth.uid()::text = owner_id);

-- ---------- profiles：行 id = auth.users.id，仅本人 ----------
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid()::text = id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid()::text = id);
create policy profiles_update_own on public.profiles for update using (auth.uid()::text = id) with check (auth.uid()::text = id);

-- ---------- lessons：仅归属用户本人 ----------
drop policy if exists lessons_select_own on public.lessons;
drop policy if exists lessons_insert_own on public.lessons;
drop policy if exists lessons_update_own on public.lessons;
drop policy if exists lessons_delete_own on public.lessons;
create policy lessons_select_own on public.lessons for select using (auth.uid()::text = user_id);
create policy lessons_insert_own on public.lessons for insert with check (auth.uid()::text = user_id);
create policy lessons_update_own on public.lessons for update using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy lessons_delete_own on public.lessons for delete using (auth.uid()::text = user_id);

-- ---------- lesson_assets：仅归属用户本人 ----------
drop policy if exists assets_select_own on public.lesson_assets;
drop policy if exists assets_insert_own on public.lesson_assets;
drop policy if exists assets_update_own on public.lesson_assets;
drop policy if exists assets_delete_own on public.lesson_assets;
create policy assets_select_own on public.lesson_assets for select using (auth.uid()::text = user_id);
create policy assets_insert_own on public.lesson_assets for insert with check (auth.uid()::text = user_id);
create policy assets_update_own on public.lesson_assets for update using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy assets_delete_own on public.lesson_assets for delete using (auth.uid()::text = user_id);

-- ---------- ai_analysis_inputs：AI/解析数据与人工分离，仅归属用户 ----------
drop policy if exists ai_inputs_select_own on public.ai_analysis_inputs;
drop policy if exists ai_inputs_insert_own on public.ai_analysis_inputs;
drop policy if exists ai_inputs_update_own on public.ai_analysis_inputs;
drop policy if exists ai_inputs_delete_own on public.ai_analysis_inputs;
create policy ai_inputs_select_own on public.ai_analysis_inputs for select using (auth.uid()::text = user_id);
create policy ai_inputs_insert_own on public.ai_analysis_inputs for insert with check (auth.uid()::text = user_id);
create policy ai_inputs_update_own on public.ai_analysis_inputs for update using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy ai_inputs_delete_own on public.ai_analysis_inputs for delete using (auth.uid()::text = user_id);

-- ---------- annotations：人工标注，仅归属用户 ----------
drop policy if exists annotations_select_own on public.annotations;
drop policy if exists annotations_insert_own on public.annotations;
drop policy if exists annotations_update_own on public.annotations;
drop policy if exists annotations_delete_own on public.annotations;
create policy annotations_select_own on public.annotations for select using (auth.uid()::text = user_id);
create policy annotations_insert_own on public.annotations for insert with check (auth.uid()::text = user_id);
create policy annotations_update_own on public.annotations for update using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy annotations_delete_own on public.annotations for delete using (auth.uid()::text = user_id);

-- ---------- reports：分析报告，仅归属用户 ----------
drop policy if exists reports_select_own on public.reports;
drop policy if exists reports_insert_own on public.reports;
drop policy if exists reports_update_own on public.reports;
drop policy if exists reports_delete_own on public.reports;
create policy reports_select_own on public.reports for select using (auth.uid()::text = user_id);
create policy reports_insert_own on public.reports for insert with check (auth.uid()::text = user_id);
create policy reports_update_own on public.reports for update using (auth.uid()::text = user_id) with check (auth.uid()::text = user_id);
create policy reports_delete_own on public.reports for delete using (auth.uid()::text = user_id);

-- ============================================================
-- 合闸反证（必须全部符合预期）：
--  1) 无身份(anon/authenticated 无 JWT)：
--     select lessons/profiles/... 必须 0 行；insert 必须 42501 拒绝。
--  2) anon select standard_sets(is_active=true) 必须 ≥1（内置标准可见）。
--  3) 登录用户 A：只能 select/insert/update/delete user_id = auth.uid() 的行，
--     访问用户 B 的课例必须 0 行。
--  校验表达式已落库：
--     select polname, pg_get_expr(polqual,polrelid), pg_get_expr(polwithcheck,polrelid)
--     from pg_policy where polrelid='public.lessons'::regclass;
-- ============================================================
