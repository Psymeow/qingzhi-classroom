import type { Metadata } from 'next';
import AuthShell from '@/components/auth/AuthShell';

export const metadata: Metadata = { title: '登录' };

export default function LoginPage() {
  return <AuthShell mode="login" />;
}
