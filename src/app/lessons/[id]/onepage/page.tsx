import type { Metadata } from 'next';
import { AuthGuard } from '@/components/auth/AuthGuard';
import OnePageClient from './OnePageClient';

export const metadata: Metadata = {
  title: '一页速读',
};

// 放在 (workbench) 路由组之外：单页版要能直接打印/存 PDF，
// 不继承侧边栏与顶栏，纸质件上只有结论、动作和落款。
export default function OnePageReportPage() {
  return (
    <AuthGuard>
      <OnePageClient />
    </AuthGuard>
  );
}
