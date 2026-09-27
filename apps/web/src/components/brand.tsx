import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The mark: an index bar-stack with a pointer, drawn flat.
 *
 * Geometric and crisp SVG that inherits theme colour and scales cleanly.
 */
export function LogoMark({
  className,
  tone = 'default',
}: {
  className?: string;
  id?: string;
  tone?: 'default' | 'inverted';
}) {
  const plate = tone === 'inverted' ? 'fill-background' : 'fill-primary';
  const bars = tone === 'inverted' ? 'fill-foreground' : 'fill-primary-foreground';
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('h-8 w-8 shrink-0', className)}
      role="img"
      aria-label="SEO Micro-Tools"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="7" className={plate} />
      {/* Three bars rising left to right: technical indexing climbing */}
      <rect x="8" y="18" width="3.5" height="7" rx="1.25" className={bars} opacity="0.55" />
      <rect x="14.25" y="13" width="3.5" height="12" rx="1.25" className={bars} opacity="0.78" />
      <rect x="20.5" y="8" width="3.5" height="17" rx="1.25" className={bars} />
    </svg>
  );
}

/** Mark plus wordmark. `href` makes it a link; omit it for static contexts. */
export function Logo({
  className,
  markClassName,
  showWordmark = true,
  href = '/',
  id,
  tone = 'default',
}: {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  href?: string;
  id?: string;
  tone?: 'default' | 'inverted';
}) {
  const content = (
    <span className={cn('flex items-center gap-2.5 select-none', className)}>
      <LogoMark className={markClassName} id={id} tone={tone} />
      {showWordmark ? (
        <span className="flex items-baseline gap-1 font-bold tracking-tight text-foreground text-base">
          <span className="font-extrabold text-foreground">SEO</span>
          <span className="text-muted-foreground font-semibold text-sm">MicroTools</span>
        </span>
      ) : null}
    </span>
  );

  if (!href) return content;
  return (
    <Link
      href={href}
      className="flex items-center rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </Link>
  );
}
