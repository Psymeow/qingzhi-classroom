'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getSupabaseBrowserClientAsync } from '@/lib/supabase-browser';
import type { Session } from '@supabase/supabase-js';

/** 包裹需登录的页面：未登录跳 /login，会话确认后渲染子节点 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const sb = await getSupabaseBrowserClientAsync();
      const {
        data: { session: s },
      } = await sb.auth.getSession();
      if (!mounted) return;
      if (!s) {
        router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
        return;
      }
      setSession(s);
      setChecking(false);

      const {
        data: { subscription },
      } = sb.auth.onAuthStateChange((_event, next) => {
        if (!next) router.replace('/login');
      });
      return () => subscription.unsubscribe();
    })();
    return () => {
      mounted = false;
    };
  }, [router, pathname]);

  if (checking || !session) {
    return (
      <div className="app-surface flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <span className="text-sm">正在加载工作台…</span>
      </div>
    );
  }
  return <>{children}</>;
}
