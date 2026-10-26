-- ============================================================
-- 0007 · 分析运行历史（report_runs）
-- 目标：给「同一节课的每次分析」留痕，用于：
--   1) 改了标注/材料再跑一次，能对比改前改后（试教 → 正式课最有价值的对照）；
--   2) 课题数据可复现：记录标准版本、prompt 版本、模型、耗时、是否降级；
--   3) 教研中心未来可做「同一课例多次运行」的轨迹对比。
-- 设计：
--   * reports 仍是「当前结果」（唯一一条），report_runs 只追加历史，不改既有表结构；
--   * summary 是压缩快照（维度分/指标分/内涵/覆盖），不含证据与解读长文，单条约 1-2KB；
--   * 表不存在时代码会优雅降级（不写历史、界面提示未启用），不会影响分析本身。
-- 权限：本人可读写自己的运行记录；无跨用户读取路径。
-- ============================================================

create table if not exists public.report_runs (
  id varchar(36) primary key default gen_random_uuid(),
  lesson_id varchar(36) not null references public.lessons(id) on delete cascade,
  user_id varchar(36) not null,
  -- 该课例的第几次运行（从 1 开始，按 created_at 递增）
  run_no integer not null default 1,
  total_score numeric(5, 1) not null default 0,
  total_level varchar(32),
  standard_code varchar(64),
  standard_version varchar(32),
  model varchar(128),
  -- 评分 prompt 指纹：prompt 改动时由代码里的常量升级，保证「同一份材料为何分数不同」可解释
  prompt_version varchar(32),
  use_llm boolean not null default false,
  ai_used boolean not null default false,
  ai_error text,
  duration_ms integer,
  -- manual / rerun / calibrate
  trigger varchar(24) not null default 'manual',
  source_weights jsonb,
  -- 压缩快照：{ total_score,total_level,dims,cognitive,affective,scored_points,total_points,indicator_scores,sources }
  summary jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists report_runs_lesson_idx on public.report_runs (lesson_id, created_at desc);
create index if not exists report_runs_user_idx on public.report_runs (user_id);

alter table public.report_runs enable row level security;

drop policy if exists report_runs_select_own on public.report_runs;
create policy report_runs_select_own on public.report_runs for select
  using (auth.uid()::text = user_id);

drop policy if exists report_runs_insert_own on public.report_runs;
create policy report_runs_insert_own on public.report_runs for insert
  with check (auth.uid()::text = user_id);

drop policy if exists report_runs_delete_own on public.report_runs;
create policy report_runs_delete_own on public.report_runs for delete
  using (auth.uid()::text = user_id);

comment on table public.report_runs is '课例分析运行历史（每次运行追加一条压缩快照，用于改前改后对比与课题可复现；reports 保留当前结果）';
