'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Eye, EyeOff, ArrowRight, MailCheck } from 'lucide-react';
import { getSupabaseBrowserClientAsync } from '@/lib/supabase-browser';
import BrandLogo from '@/components/brand/BrandLogo';

type Mode = 'login' | 'register' | 'forgot';

const FRIENDLY: Record<string, string> = {
  'Invalid login credentials': '邮箱或密码不正确，请重试。',
  'Email not confirmed': '账号尚未确认，请联系管理员或稍后重试。',
  'User already registered': '该邮箱已注册，请直接登录。',
  'Password should be at least 6 characters': '密码至少需要 6 位。',
  'Email rate limit exceeded': '操作过于频繁，请稍后再试。',
};

function friendly(msg: string) {
  return FRIENDLY[msg] || msg || '操作失败，请重试。';
}

export default function AuthShell({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 忘记密码：重置邮件已发送的确认态
  const [resetSent, setResetSent] = useState(false);

  const isLogin = mode === 'login';
  const isForgot = mode === 'forgot';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResetSent(false);
    if (!email.trim()) {
      setError('请输入邮箱。');
      return;
    }
    if (!isForgot && !password) {
      setError('请输入密码。');
      return;
    }
    if (!isForgot && password.length < 6) {
      setError('密码至少需要 6 位。');
      return;
    }
    setLoading(true);
    try {
      const sb = await getSupabaseBrowserClientAsync();
      if (isForgot) {
        const { error: resetErr } = await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined,
        });
        if (resetErr) throw resetErr;
        setResetSent(true);
        setLoading(false);
        return;
      }
      if (isLogin) {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        // 自动确认环境：signUp 后直接带 session；若无 session 则引导查收确认邮件（闭环，不让用户卡住）
        if (!data.session) {
          setResetSent(true);
          setLoading(false);
          return;
        }
      }
      // 确保服务端 profile 占位存在（失败不阻塞）
      try {
        const { data: sess } = await sb.auth.getSession();
        if (sess.session?.access_token) {
          await fetch('/api/me', { headers: { 'x-session': sess.session.access_token } });
        }
      } catch {
        /* ignore */
      }
      router.replace('/');
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(friendly(msg));
      setLoading(false);
    }
  }

  return (
    <div className="auth-surface flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <BrandLogo size="lg" className="shadow-lg shadow-primary/25" />
          <h1 className="mt-4 text-[22px] font-semibold text-foreground">情智相长 · 课堂分析工作台</h1>
          <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-muted-foreground">
            课堂五维素养评价 · AI 分析与人工标注融合，生成可追溯的课堂观察报告
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-card sm:p-7">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-foreground">
              {isLogin ? '欢迎回来' : isForgot ? '找回密码' : '创建账号'}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLogin
                ? '使用邮箱密码登录，进入你的课例工作台'
                : isForgot
                  ? '输入注册邮箱，我们会发送一封重置密码的邮件'
                  : '用邮箱创建账号，注册成功后自动登录'}
            </p>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {resetSent && (
                <Alert>
                  <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <AlertDescription>
                    {isForgot
                      ? '重置邮件已发送，请查收邮箱（含垃圾邮件），按邮件提示重置密码后重新登录。'
                      : '注册成功。若未自动进入工作台，请查收邮箱中的确认邮件（含垃圾邮件），完成确认后登录；如长时间未收到，请联系管理员。'}
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[13px] font-medium">
                  邮箱
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  className="h-10"
                  required
                />
              </div>
              {!isForgot && (
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[13px] font-medium">
                  密码
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    placeholder={isLogin ? '请输入密码' : '至少 6 位'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    className="h-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95"
                    tabIndex={-1}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              )}
            </div>
            <Button type="submit" size="lg" className="mt-6 w-full rounded-lg" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading
                ? isLogin
                  ? '正在登录…'
                  : isForgot
                    ? '正在发送邮件…'
                    : '正在注册…'
                : isLogin
                  ? '登录'
                  : isForgot
                    ? '发送重置邮件'
                    : '注册并登录'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
            <div className="mt-5 space-y-2 text-center text-sm text-muted-foreground">
              {isLogin && (
                <div>
                  <Link href="/forgot-password" className="font-medium text-primary hover:underline">
                    忘记密码？
                  </Link>
                </div>
              )}
              <div>
                {isLogin ? (
                  <>
                    还没有账号？{' '}
                    <Link href="/register" className="font-medium text-primary hover:underline">
                      立即注册
                    </Link>
                  </>
                ) : (
                  <>
                    已有账号？{' '}
                    <Link href="/login" className="font-medium text-primary hover:underline">
                      直接登录
                    </Link>
                  </>
                )}
              </div>
              {isForgot && (
                <div>
                  <Link href="/login" className="font-medium text-primary hover:underline">
                    返回登录
                  </Link>
                </div>
              )}
            </div>
          </form>
        </div>
        <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          数据仅限本人课例可见，学生信息请用编号代替真实姓名。详见
          <Link href="/privacy" className="mx-1 text-primary hover:underline">
            《数据与隐私说明》
          </Link>
          <span className="mx-1 text-muted-foreground/50">·</span>
          <Link href="/help" className="text-primary hover:underline">
            使用指南
          </Link>
        </p>
        <p className="mt-3 text-center text-xs text-muted-foreground">
          情智相长课堂观察 · 试用环境
        </p>
      </div>
    </div>
  );
}
