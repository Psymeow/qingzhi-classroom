-- ============================================================
-- 0004 · 课堂切片时间轴（V1.14）
-- 目标：ASR 识别时保留 uttrances 的毫秒级分段时间轴，让报告里的转写证据可以挂到视频上
-- 兼容：segments 可空；存量课例回退到「解析 [mm:ss] 逐行转写」得到秒级时间轴
-- 说明：只加列不加表——一条 ai_analysis_inputs 对应一份转写，时间轴天然属于它；
--      结构为 [{s: 起毫秒, e: 止毫秒, t: 段文本}]，短键省体积（一节课约 400-800 段）
-- ============================================================

alter table public.ai_analysis_inputs
  add column if not exists segments jsonb;

comment on column public.ai_analysis_inputs.segments is
  '课堂实录分段时间轴（ASR 识别时写入）：[{s,e,t}]，毫秒；为空表示转写来自手动上传/粘贴，需按 [mm:ss] 解析兜底';

-- 服务端已用 service role 读写，无需新增 RLS 策略；
-- 但确认列级权限对 anon/authenticated 与既有列一致（读转写 = 读 segments）。
grant select (segments) on public.ai_analysis_inputs to authenticated;
