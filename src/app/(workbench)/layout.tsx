import { AuthGuard } from '@/components/auth/AuthGuard';
import WorkbenchShell from '@/components/auth/WorkbenchShell';

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <WorkbenchShell>{children}</WorkbenchShell>
    </AuthGuard>
  );
}
