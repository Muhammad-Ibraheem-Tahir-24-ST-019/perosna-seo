'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Clock, Loader2, Search } from 'lucide-react';
import type {
  MetaToolResult,
  RobotsToolResult,
  SitemapToolResult,
  ToolEngineKey,
  ToolQuota,
  ToolRunMeta,
} from '@indexpilot/shared/client';
import { Button, Input, Label } from '@/components/ui/core';
import { api, ApiError } from '@/lib/api';
import { MetaResult, RobotsResult, SitemapResult } from './results';

/**
 * The interactive half of a tool page.
 *
 * Results render in place without a navigation — the brief calls for an
 * app-like tool above the fold, and this audience abandons a full form POST.
 * The heavy lifting all happens server-side; this component only collects the
 * input, shows progress honestly, and renders whatever came back.
 */

type AnyResult = RobotsToolResult | MetaToolResult | SitemapToolResult;

interface RunState {
  result: AnyResult;
  meta: ToolRunMeta;
  quota: ToolQuota;
}

const PLACEHOLDERS: Record<ToolEngineKey, string> = {
  ROBOTS_TXT: 'example.com',
  PAGE_META: 'example.com/page-to-check',
  SITEMAP: 'example.com',
};

const LABELS: Record<ToolEngineKey, string> = {
  ROBOTS_TXT: 'Domain or URL',
  PAGE_META: 'Page URL',
  SITEMAP: 'Domain or sitemap URL',
};

const BUTTONS: Record<ToolEngineKey, string> = {
  ROBOTS_TXT: 'Test robots.txt',
  PAGE_META: 'Check page',
  SITEMAP: 'Check sitemap',
};

export function ToolRunner({
  slug,
  engine,
}: {
  slug: string;
  engine: ToolEngineKey;
}) {
  const [url, setUrl] = React.useState('');
  const [testPath, setTestPath] = React.useState('');
  const [userAgent, setUserAgent] = React.useState('Googlebot');
  const [run, setRun] = React.useState<RunState | null>(null);
  const resultsRef = React.useRef<HTMLDivElement>(null);

  const mutation = useMutation<RunState, Error, void>({
    mutationFn: async () => {
      if (engine === 'ROBOTS_TXT') {
        return api.tools.robots({
          url,
          slug,
          paths: testPath.trim() ? [testPath.trim()] : undefined,
          userAgent: userAgent.trim() || undefined,
        });
      }
      if (engine === 'PAGE_META') {
        return api.tools.meta({ url, slug });
      }
      return api.tools.sitemap({ url, slug, checkUrls: true });
    },
    onSuccess: (data) => {
      setRun(data);
      // Move focus to the results so keyboard and screen-reader users are not
      // left at the top of the page wondering whether anything happened.
      window.requestAnimationFrame(() => {
        resultsRef.current?.focus({ preventScroll: true });
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim() || mutation.isPending) return;
    mutation.mutate();
  };

  const errorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error
        ? 'Something went wrong running this check. Please try again.'
        : null;

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="space-y-4">
          <div>
            <Label htmlFor="tool-url">{LABELS[engine]}</Label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <Input
                id="tool-url"
                name="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder={PLACEHOLDERS[engine]}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                aria-describedby="tool-url-hint"
                className="flex-1"
              />
              <Button type="submit" loading={mutation.isPending} className="sm:w-auto">
                {!mutation.isPending ? <Search className="h-4 w-4" aria-hidden /> : null}
                {mutation.isPending ? 'Checking…' : BUTTONS[engine]}
              </Button>
            </div>
            <p id="tool-url-hint" className="mt-1.5 text-xs text-muted-foreground">
              No account needed. https:// is assumed if you leave it off.
            </p>
          </div>

          {engine === 'ROBOTS_TXT' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tool-path">Test a path (optional)</Label>
                <Input
                  id="tool-path"
                  name="path"
                  spellCheck={false}
                  placeholder="/admin/settings"
                  value={testPath}
                  onChange={(event) => setTestPath(event.target.value)}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="tool-agent">Crawler</Label>
                <Input
                  id="tool-agent"
                  name="userAgent"
                  spellCheck={false}
                  placeholder="Googlebot"
                  value={userAgent}
                  onChange={(event) => setUserAgent(event.target.value)}
                  className="mt-1.5"
                />
              </div>
            </div>
          ) : null}
        </div>

        {errorMessage ? (
          <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
      </form>

      {mutation.isPending ? (
        <div className="flex items-center justify-center gap-2.5 rounded-lg border bg-card px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {engine === 'SITEMAP'
            ? 'Finding the sitemap and checking the URLs inside it…'
            : 'Fetching the page…'}
        </div>
      ) : null}

      <div ref={resultsRef} tabIndex={-1} className="scroll-mt-20 focus:outline-none">
        {run && !mutation.isPending ? (
          <div className="space-y-4">
            <RunMetaLine meta={run.meta} quota={run.quota} />
            {engine === 'ROBOTS_TXT' ? (
              <RobotsResult result={run.result as RobotsToolResult} />
            ) : null}
            {engine === 'PAGE_META' ? <MetaResult result={run.result as MetaToolResult} /> : null}
            {engine === 'SITEMAP' ? (
              <SitemapResult result={run.result as SitemapToolResult} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Provenance line. Says when the check ran and whether it came from cache,
 * because a cached answer for a page the user just edited is confusing unless
 * you say so.
 */
function RunMetaLine({ meta, quota }: { meta: ToolRunMeta; quota: ToolQuota }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Clock className="h-3 w-3" aria-hidden />
        {meta.cached
          ? `Cached result from ${formatAge(meta.cacheAgeSeconds)} ago`
          : `Checked just now in ${(meta.durationMs / 1000).toFixed(1)}s`}
      </span>
      <span className="tabular-nums">
        {quota.remaining} of {quota.limit} checks left this hour
      </span>
    </div>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  return `${Math.round(seconds / 60)}m`;
}
