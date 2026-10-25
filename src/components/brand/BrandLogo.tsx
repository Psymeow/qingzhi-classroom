import { Sprout } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 情智相长品牌标识：indigo→violet 渐变底 + 生长嫩芽（智慧 × 情感 · 相长共生）。
 * 纯展示组件，可同时用于顶栏（sm）与登录页（lg）。
 */
const SIZES = {
  sm: { box: 'h-8 w-8 rounded-lg', icon: 'h-[18px] w-[18px]' },
  md: { box: 'h-10 w-10 rounded-xl', icon: 'h-5 w-5' },
  lg: { box: 'h-14 w-14 rounded-2xl', icon: 'h-7 w-7' },
} as const;

export default function BrandLogo({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <span
      aria-hidden
      className={cn(
        'bg-brand-gradient inline-flex shrink-0 items-center justify-center text-white shadow-sm',
        'ring-1 ring-inset ring-white/20',
        s.box,
        className,
      )}
    >
      <Sprout className={s.icon} strokeWidth={2.25} />
    </span>
  );
}
