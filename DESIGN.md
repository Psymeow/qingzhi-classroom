# DESIGN.md

## 品牌与视觉方向

- 品牌：情智相长 · 课堂分析工作台（数学课堂五维评价）
- 气质：极简专业、克制温暖；多留白、精致卡片层级、文字层级驱动的 UI
- Logo：BrandLogo（SVG，品牌渐变 rounded square + 情/志双字，配品牌名与标语）

## Design Tokens

### 色彩（oklch，见 globals.css @theme）
- 主品牌渐变：`--color-brand-from`（琥珀）→ `--color-brand-via`（橙）→ `--color-brand-to`（朱红），对应类 `.bg-brand-gradient`
- 强调色：翡翠绿（av_transcript 数据源）、琥珀/橙（task_sheet、警示）、紫（observer_note）、品牌橙（manual_annotation）
- 中性色：极简灰阶 + 暖白底（`--background` 近白暖调）
- 语义色：success / warning / destructive 均为低饱和现代色

### 自定义组件类（@layer components，保持原样勿改 @utility）
- `.bg-brand-gradient`：品牌渐变背景
- `.shadow-card` / `.shadow-card-hover`：卡片柔和投影与悬浮加深
- `.app-surface` / `.auth-surface`：工作台与登录页底纹表面

### 形状与字体
- 圆角：`--radius: 0.625rem`
- 字体族：Geist Sans / Geist Mono（`--font-sans` / `--font-mono`）

## 交互与状态
- 卡片 hover 微浮起（shadow 过渡），按钮品牌渐变填充
- 状态徽标语义化配色（草稿/就绪/分析中/完成）
- 页面切换使用 tabs 三页签（数据导入 → 标注 → 分析）
