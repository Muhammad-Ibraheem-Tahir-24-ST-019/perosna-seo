'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  MinusCircle,
  XCircle,
} from 'lucide-react';
import type { IssueSeverity, ToolVerdict } from '@indexpilot/shared/client';
import { cn } from '@/lib/utils';
import { collectFixGuides, type FixGuide } from './fixes';

/**
 * Shared display pieces for the public tools.
 *
 * One rule runs through all of them: a verdict is never shown by colour alone.
 * Every state carries an icon and a word, so the results are readable to
 * colour-blind users and survive being screenshotted in greyscale — which is
 * how these results usually get shared.
 */

const VERDICT_META: Record<
  ToolVerdict,
  { icon: React.ComponentType<{ className?: string }>; label: string; className: string }
> = {
  good: { icon: CheckCircle2, label: 'Pass', className: 'text-success' },
  warning: { icon: AlertTriangle, label: 'Warning', className: 'text-warning' },
  problem: { icon: XCircle, label: 'Problem', className: 'text-destructive' },
  missing: { icon: MinusCircle, label: 'Missing', className: 'text-destructive' },
};

const SEVERITY_META: Record<
  IssueSeverity,
  { icon: React.ComponentType<{ className?: string }>; label: string; className: string }
> = {
  error: { icon: XCircle, label: 'Error', className: 'text-destructive' },
  warning: { icon: AlertTriangle, label: 'Warning', className: 'text-warning' },
  info: { icon: Info, label: 'Note', className: 'text-info' },
};

export function VerdictIcon({ verdict, className }: { verdict: ToolVerdict; className?: string }) {
  const meta = VERDICT_META[verdict];
  const Icon = meta.icon;
  return (
    <span title={meta.label}>
      <Icon className={cn('h-4 w-4 shrink-0', meta.className, className)} aria-hidden />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

/** A single graded field: verdict, the value itself, and why. */
export function ResultRow({
  label,
  verdict,
  message,
  children,
}: {
  label: string;
  verdict: ToolVerdict;
  message: string;
  children?: React.ReactNode;
}) {
  const meta = VERDICT_META[verdict];
  return (
    <div className="border-b px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <VerdictIcon verdict={verdict} />
        <h3 className="text-sm font-medium">{label}</h3>
        <span className={cn('text-xs font-medium', meta.className)}>{meta.label}</span>
      </div>
      {children ? <div className="mt-2.5">{children}</div> : null}
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>
    </div>
  );
}

/** The literal value a tool read off the page, shown verbatim. */
export function ValueBlock({ value, empty = 'Not present' }: { value: string | null; empty?: string }) {
  if (value === null || value === '') {
    return <p className="text-sm italic text-muted-foreground">{empty}</p>;
  }
  return (
    <p className="mono-value rounded-md border bg-muted/40 px-3 py-2 text-foreground">{value}</p>
  );
}

/**
 * Length meter for titles and descriptions.
 *
 * The bar is pixel width against Google's limit, because that is what decides
 * truncation; the character count is shown next to it because that is the
 * number people are used to.
 */
export function LengthMeter({
  charCount,
  pixelWidth,
  pixelLimit,
}: {
  charCount: number;
  pixelWidth: number;
  pixelLimit: number;
}) {
  const ratio = pixelLimit > 0 ? pixelWidth / pixelLimit : 0;
  const over = ratio > 1;
  const percent = Math.min(100, Math.round(ratio * 100));

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="tabular-nums text-muted-foreground">
          {charCount} characters &middot;{' '}
          <span className={cn('font-medium', over ? 'text-destructive' : 'text-foreground')}>
            {pixelWidth}px
          </span>{' '}
          of {pixelLimit}px
        </span>
        <span
          className={cn(
            'font-medium tabular-nums',
            over ? 'text-destructive' : ratio > 0.95 ? 'text-warning' : 'text-success',
          )}
        >
          {over ? `+${pixelWidth - pixelLimit}px over` : `${pixelLimit - pixelWidth}px left`}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${pixelWidth} of ${pixelLimit} pixels used`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all',
            over ? 'bg-destructive' : ratio > 0.95 ? 'bg-warning' : 'bg-success',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export interface DisplayIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  line?: number | null;
  excerpt?: string | null;
}

export function IssueList({ issues }: { issues: DisplayIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-5">
        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
        No problems found.
      </div>
    );
  }

  return (
    <ul className="divide-y">
      {issues.map((issue, index) => {
        const meta = SEVERITY_META[issue.severity];
        const Icon = meta.icon;
        return (
          <li key={`${issue.code}-${index}`} className="flex gap-3 px-4 py-3.5 sm:px-5">
            <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', meta.className)} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={cn('text-xs font-semibold uppercase tracking-wide', meta.className)}>
                  {meta.label}
                </span>
                {issue.line ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    line {issue.line}
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-sm leading-relaxed">{issue.message}</p>
              {issue.excerpt ? (
                <pre className="mono-value mt-2 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground scrollbar-thin">
                  {issue.excerpt}
                </pre>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A labelled figure. Used for the summary strip above each result. */
export function StatTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
  }[tone];

  return (
    <div className="rounded-md border px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', toneClass)}>{value}</p>
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border bg-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The "how to fix it" block.
 *
 * Rendered from the issue codes the run actually produced, so it is advice
 * about this page rather than a generic FAQ. When nothing is wrong it renders
 * nothing at all.
 */
export function FixSection({ codes }: { codes: (string | null | undefined)[] }) {
  const guides = collectFixGuides(codes);
  if (guides.length === 0) return null;

  return (
    <SectionCard
      title="How to fix what we found"
      description="One section per problem detected above."
    >
      <div className="divide-y">
        {guides.map((guide) => (
          <FixBlock key={guide.title} guide={guide} />
        ))}
      </div>
    </SectionCard>
  );
}

function FixBlock({ guide }: { guide: FixGuide }) {
  return (
    <article className="px-4 py-4 sm:px-5">
      <h3 className="text-sm font-semibold">{guide.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{guide.what}</p>
      <p className="mt-2 text-sm leading-relaxed">
        <span className="font-medium">The fix: </span>
        {guide.fix}
      </p>
      {guide.example ? (
        <pre className="mono-value mt-2.5 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2.5 scrollbar-thin">
          {guide.example}
        </pre>
      ) : null}
    </article>
  );
}

/** Shown when the target could not be fetched at all. */
export function FetchError({ message }: { message: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4">
      <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
      <div>
        <p className="text-sm font-medium text-destructive">Could not complete the check</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
