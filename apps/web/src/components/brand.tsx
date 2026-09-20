import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The mark: an index bar-stack with a pointer, drawn flat.
 *
 * Deliberately geometric and single-colour — no gradient fill, no glow layer.
 * Those read as decoration, and at 24px they turn to mud anyway. Inline SVG so
 * it inherits theme colour and costs no image request.
 */
export function LogoMark({
  className,
  tone = 'default',
}: {
  className?: string;
  id?: string;
  tone?: 'default' | 'inverted';
}) {
  // On an inverted panel the plate and bars swap, so the mark keeps its
  // contrast instead of turning into a dark square on a dark background.
  const plate = tone === 'inverted' ? 'fill-background' : 'fill-primary';
  const bars = tone === 'inverted' ? 'fill-foreground' : 'fill-primary-foreground';
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('h-8 w-8', className)}
      role="img"
      aria-label="IndexPilot"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="7" className={plate} />
      {/* Three bars rising left to right: the index climbing. */}
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
  href,
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
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark className={markClassName} id={id} tone={tone} />
      {showWordmark ? (
        <span
          className={cn(
            'text-[0.9375rem] font-semibold tracking-tight',
            tone === 'inverted' ? 'text-background' : 'text-foreground',
          )}
        >
          IndexPilot
        </span>
      ) : null}
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring">
      {content}
    </Link>
  );
}
