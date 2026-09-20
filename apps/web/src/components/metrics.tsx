'use client';

import * as React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardSeriesPoint } from '@indexpilot/shared/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/core';
import { cn, formatNumber } from '@/lib/utils';

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
  }[tone];

  // The icon chip carries the tone colour so the figure itself stays readable.
  const chipClass = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  }[tone];

  return (
    <Card className="transition-shadow hover:shadow-raised">
      <CardContent className="flex items-start gap-3 p-4 sm:p-5">
        {Icon ? (
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
              chipClass,
            )}
            aria-hidden
          >
            <Icon className="h-[1.125rem] w-[1.125rem]" />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] font-medium text-muted-foreground">{label}</p>
          <p className={cn('metric mt-0.5', toneClass)}>
            {typeof value === 'number' ? formatNumber(value) : value}
          </p>
          {hint ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Consistent page heading with an optional action slot. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const CHART_COLORS = {
  submitted: 'hsl(221 83% 53%)',
  processed: 'hsl(199 89% 48%)',
  crawlDetected: 'hsl(262 83% 58%)',
  indexedConfirmed: 'hsl(152 60% 40%)',
  failed: 'hsl(0 72% 51%)',
};

function chartTooltipStyle() {
  return {
    contentStyle: {
      background: 'hsl(var(--popover))',
      border: '1px solid hsl(var(--border))',
      borderRadius: '0.5rem',
      fontSize: '0.8rem',
      color: 'hsl(var(--popover-foreground))',
    },
  };
}

export function SubmissionsChart({ data }: { data: DashboardSeriesPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>URLs submitted</CardTitle>
        <CardDescription>Daily submission volume across all projects.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="submitted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.submitted} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={CHART_COLORS.submitted} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(value: string) => value.slice(5)}
                stroke="hsl(var(--muted-foreground))"
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
              <Tooltip {...chartTooltipStyle()} />
              <Area
                type="monotone"
                dataKey="submitted"
                name="Submitted"
                stroke={CHART_COLORS.submitted}
                fill="url(#submitted)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function PipelineChart({ data }: { data: DashboardSeriesPoint[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline outcomes</CardTitle>
        <CardDescription>
          Processed, crawl-detected, confirmed indexed and failed URLs per day.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(value: string) => value.slice(5)}
                stroke="hsl(var(--muted-foreground))"
                minTickGap={24}
              />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
              <Tooltip {...chartTooltipStyle()} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              <Line
                type="monotone"
                dataKey="processed"
                name="Processed"
                stroke={CHART_COLORS.processed}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="crawlDetected"
                name="Crawl detected"
                stroke={CHART_COLORS.crawlDetected}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="indexedConfirmed"
                name="Indexed (confirmed)"
                stroke={CHART_COLORS.indexedConfirmed}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="failed"
                name="Failed"
                stroke={CHART_COLORS.failed}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
