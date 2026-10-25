import type { Metadata } from 'next';
import AuthShell from '@/components/auth/AuthShell';

export const metadata: Metadata = { title: '找回密码' };

export default function ForgotPasswordPage() {
  return <AuthShell mode="forgot" />;
}
