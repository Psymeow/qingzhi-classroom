'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  LogOut,
  ChevronDown,
  Library,
  UserRound,
  BookOpen,
  Building2,
  ShieldCheck,
  FlaskConical,
} from 'lucide-react';
import { getSupabaseBrowserClientAsync } from '@/lib/supabase-browser';
import { meApi } from '@/lib/api/client';
import BrandLogo from '@/components/brand/BrandLogo';

export default function WorkbenchShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [email, setEmail] = useState<string>('');
  const [confirm, setConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // 平台总控入口只对平台白名单账号显示；/api/me 失败时保持隐藏，不影响正常使用
  const [platformAdmin, setPlatformAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = await getSupabaseBrowserClientAsync();
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (user?.email) setEmail(user.email);
      try {
        const me = await meApi.get();
        setPlatformAdmin(me.platform_admin === true);
      } catch {
        setPlatformAdmin(false);
      }
    })();
  }, [pathname]);

  async function doLogout() {
    setLoggingOut(true);
    try {
      const sb = await getSupabaseBrowserClientAsync();
      await sb.auth.signOut();
    } finally {
      setLoggingOut(false);
      setConfirm(false);
      window.location.href = '/login';
    }
  }

  return (
    <div className="app-surface min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            <BrandLogo size="sm" />
            {/* 窄屏只留 logo：右侧图标 + 账户胶囊已占满一行，文字会被挤成竖排重叠 */}
            <span className="hidden whitespace-nowrap sm:flex sm:flex-col sm:leading-none">
              <span className="text-[15px] font-semibold text-foreground">情智相长</span>
              <span className="mt-0.5 text-[11px] tracking-wide text-muted-foreground">
                课堂分析工作台
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/">
                <Library className="h-4 w-4" />
                <span className="hidden sm:inline">我的课例</span>
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/research">
                <FlaskConical className="h-4 w-4" />
                <span className="hidden sm:inline">教研中心</span>
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/org">
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">机构</span>
              </Link>
            </Button>
            {platformAdmin && (
              <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
                <Link href="/admin">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="hidden sm:inline">平台总控</span>
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/help">
                <BookOpen className="h-4 w-4" />
                <span className="hidden sm:inline">使用指南</span>
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2 rounded-full border-border bg-card/60 pl-1.5 pr-2.5 font-normal"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-gradient text-white">
                    <UserRound className="h-3.5 w-3.5" />
                  </span>
                  <span className="max-w-[88px] truncate text-xs text-foreground sm:max-w-[160px]">
                    {email || '账户'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span className="text-xs font-normal text-muted-foreground">当前账户</span>
                  <span className="truncate font-medium text-foreground">{email || '未登录'}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirm(true);
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-9">{children}</main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-2 text-center sm:px-6">
        <p className="text-xs text-muted-foreground/70">
          情智相长课堂分析工作台 · 试用环境
        </p>
      </footer>

      <AlertDialog open={confirm} onOpenChange={(o) => !loggingOut && setConfirm(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认退出登录？</AlertDialogTitle>
            <AlertDialogDescription>退出后需要重新登录才能继续查看和编辑你的课例。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loggingOut}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                doLogout();
              }}
              disabled={loggingOut}
              className="bg-destructive text-white hover:bg-destructive/90 focus:ring-destructive"
            >
              {loggingOut && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              退出登录
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
