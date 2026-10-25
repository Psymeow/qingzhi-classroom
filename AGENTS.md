# 项目上下文

情智相长 · 课堂分析工作台：数学课堂五维评价，AI 分析与人工标注融合，生成可追溯的课堂观察报告。

## 版本技术栈

- **Framework**: Next.js 16 (App Router, webpack)
- **Core**: React 19
- **Language**: TypeScript 5 (strict)
- **UI 组件**: shadcn/ui (Radix UI)，位于 `src/components/ui/`
- **Styling**: Tailwind CSS 4（`@theme` token + `@layer components` 自定义类）
- **其他依赖**: @supabase/supabase-js（浏览器端认证）、recharts（报告图表）、lucide-react、tw-animate-css

## 目录结构

```
src/
├── app/
│   ├── (workbench)/            # 工作台路由组（AuthGuard + WorkbenchShell 包裹）
│   │   ├── page.tsx            # 课程列表页
│   │   └── lessons/[id]/page.tsx  # 课程详情三页签（数据导入/标注/分析）
│   ├── login/page.tsx          # 登录（AuthShell mode="login"）
│   ├── register/page.tsx       # 注册（AuthShell mode="register"）
│   └── layout.tsx              # 根布局（引入 globals.css）
├── components/
│   ├── auth/                   # AuthGuard / AuthShell / WorkbenchShell
│   ├── brand/                  # BrandLogo（SVG 商标）
│   ├── lesson/                 # DataIntake / AnnotationWorkbench / AnalysisPanel
│   ├── annotation/             # SeatingCanvas / EventLog / DimensionScores / utils
│   └── report/                 # ReportView / SeatingSnapshot
├── lib/
│   ├── api/client.ts           # 统一 API 客户端（x-session 头、ApiError、lessons/standards/assets/inputs/annotation/analysis 六组 API）
│   ├── supabase-browser.ts     # 浏览器端 Supabase 单例（env 未配置时抛错）
│   ├── evaluation/             # types.ts（DataSource/权重）、annotation-types.ts（标注领域模型）
│   ├── lesson/                 # constants.ts（课程类型/状态）、assets.ts（素材类型）
│   └── annotation/factory.ts   # buildSeating / emptyAnnotation / uid
└── components/ui/              # shadcn/ui 组件
```

## 关键约定

- **样式层**：`globals.css` 使用 `@layer components` 自定义类（`.bg-brand-gradient/.shadow-card/.shadow-card-hover/.app-surface/.auth-surface`）与 oklch token —— 保持原样，不要改为 `@utility`。
- **API 契约**：前端经 `@/lib/api/client` 访问 `/api/**`，鉴权头为 `x-session: <supabase access_token>`，非 2xx 抛 `ApiError(status)`；401 由页面侧统一跳 `/login`。
- **assets/ 目录**：为用户上传暂存区，已在 tsconfig 中 exclude，不参与编译。

## 包管理与命令

- 仅允许 **pnpm**（`pnpm add` / `pnpm add -D`），严禁 npm/yarn。
- 校验：`pnpm ts-check`、`pnpm lint:build`、`pnpm lint:style`、构建 `pnpm build`。

## Hydration 防范

- 动态数据（Date.now/Math.random/typeof window）仅在 `'use client'` + useEffect/useState 中使用；禁止非法 HTML 嵌套；禁止 head 标签，用 metadata。

## 运行与预览

- 预览链路：`.coze[dev]` build=`scripts/prepare.sh`、run=`scripts/dev.sh`；`.preview` 声明 `expose_port = 5000`。dev.sh 自动 `pnpm install` 并起 `next dev --hostname 0.0.0.0 --port ${PORT:-5000}`，绑定 0.0.0.0、具备端口清理幂等与超时回收。
- 部署链路：`.coze[deploy]` build=`scripts/build.sh`（pnpm install + `next build` + `tsup src/server.ts`→`dist/server.js`）、run=`scripts/start.sh`（`node dist/server.js`，端口 5000）。`[deploy.profile] kind="service" flavor="web"`。
- 后端 API Routes 已同仓实现于 `src/app/api/**`（lessons/standards/assets/inputs/annotation/analysis、/api/me 等），前端经 `@/lib/api/client` 相对路径访问。
- `.coze` 为单层结构：`sub_id="a88a1834"`（不可改）、`project_type="web"`、`preview_enable="enabled"`、`[subprojects].path=["."]`。

## 待接入事项

- Supabase 环境变量 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 需在部署环境配置；未配置时 `/api/supabase-config` 会 500。
