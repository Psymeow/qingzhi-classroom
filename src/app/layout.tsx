import type { Metadata } from 'next';
import './globals.css';
import { SupabaseConfigProvider } from '@/lib/supabase-config-inject';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: {
    default: '情智相长 · 课堂分析工作台',
    template: '%s | 情智相长课堂分析',
  },
  description:
    '面向数学课堂的「情智相长」分析工作台：AI 自动分析与人工标注融合，依据五维评价体系生成课堂分析报告。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      {/* Via/部分浏览器的广告过滤、夜间模式等扩展会在 hydrate 前往 html/body 注入属性/类名
          （夜间模式扩展最常给 html 加 class/data-theme，报错即落在 html 上）。
          用两层 suppressHydrationWarning 静默（Next 官方推荐做法）：它只作用于该元素自身、不递归，
          因此仅抹平 html 与 body 自身的外部注入差异，内部组件真实的 hydration 错误仍会正常上报。 */}
      <body className="antialiased" suppressHydrationWarning>
        <SupabaseConfigProvider>{children}</SupabaseConfigProvider>
        {/* 全局操作反馈：sonner Toaster 必须挂在根布局，业务页面只调 toast.success/error。
            位置 top-center（老师视线焦点在页面上方），closeButton 便于手动关闭。 */}
        <Toaster position="top-center" closeButton />
      </body>
    </html>
  );
}
