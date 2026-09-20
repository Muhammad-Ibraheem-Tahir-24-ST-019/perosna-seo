'use client';

import * as React from 'react';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  ExternalLink,
  FileCode2,
  XCircle,
} from 'lucide-react';
import type {
  MetaToolResult,
  RobotsToolResult,
  SitemapToolResult,
  SitemapUrlState,
} from '@indexpilot/shared/client';
import { Badge } from '@/components/ui/core';
import { cn, formatNumber } from '@/lib/utils';
import {
  FetchError,
  FixSection,
  IssueList,
  LengthMeter,
  ResultRow,
  SectionCard,
  StatTile,
  ValueBlock,
} from './primitives';
import { SerpPreview } from './serp-preview';

// ---------------------------------------------------------------------------
// Robots.txt
// ---------------------------------------------------------------------------

export function RobotsResult({ result }: { result: RobotsToolResult }) {
  const { audit, tests } = result;
  const errors = audit.issues.filter((issue) => issue.severity === 'error').length;
  const warnings = audit.issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <div className="space-y-4">
      {result.error ? <FetchError message={result.error.message} /> : null}

      {audit.blocksEverything ? (
        <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-destructive">
              This site is blocking all crawlers
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              A <code className="font-mono text-xs">Disallow: /</code> rule applies to Googlebot.
              Nothing on this domain will be crawled while it is live.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="robots.txt"
          value={result.exists ? `HTTP ${result.status}` : 'Not found'}
          tone={result.exists ? 'success' : 'warning'}
        />
        <StatTile label="Rules" value={formatNumber(audit.stats.rules)} />
        <StatTile label="Errors" value={errors} tone={errors > 0 ? 'destructive' : 'success'} />
        <StatTile
          label="Warnings"
          value={warnings}
          tone={warnings > 0 ? 'warning' : 'success'}
        />
      </div>

      {tests.length > 0 ? (
        <SectionCard
          title="URL test"
          description="Whether each path is crawlable, and the rule that decides it."
        >
          <ul className="divide-y">
            {tests.map((test) => (
              <li key={`${test.path}-${test.userAgent}`} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center gap-2">
                  {test.allowed ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <span
                    className={cn(
                      'text-sm font-semibold',
                      test.allowed ? 'text-success' : 'text-destructive',
                    )}
                  >
                    {test.allowed ? 'Allowed' : 'Blocked'}
                  </span>
                  <code className="mono-value rounded bg-muted px-1.5 py-0.5">{test.path}</code>
                  <Badge variant="outline">{test.userAgent}</Badge>
                </div>
                {test.matchedRule ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Matched rule:{' '}
                    <code className="mono-value rounded bg-muted px-1.5 py-0.5 text-foreground">
                      {test.matchedRule}
                    </code>
                  </p>
                ) : null}
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {test.explanation}
                </p>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <SectionCard
        title="File analysis"
        description={`${audit.stats.groups} group(s), ${audit.stats.rules} rule(s), ${audit.stats.sitemaps} sitemap directive(s).`}
      >
        <IssueList issues={audit.issues} />
      </SectionCard>

      {result.sitemaps.length > 0 ? (
        <SectionCard title="Sitemaps declared" description="Listed via the Sitemap directive.">
          <ul className="divide-y">
            {result.sitemaps.map((sitemap) => (
              <li key={sitemap} className="px-4 py-3 sm:px-5">
                <a
                  href={sitemap}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mono-value inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  {sitemap}
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {result.content ? (
        <SectionCard
          title="The file itself"
          description={result.finalUrl}
          action={
            <a
              href={result.finalUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          }
        >
          <pre className="mono-value max-h-96 overflow-auto px-4 py-3 scrollbar-thin sm:px-5">
            {result.content}
          </pre>
        </SectionCard>
      ) : null}

      <FixSection codes={audit.issues.map((issue) => issue.code)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page meta
// ---------------------------------------------------------------------------

export function MetaResult({ result }: { result: MetaToolResult }) {
  const report = result.report;

  if (!report) {
    return (
      <FetchError
        message={result.error?.message ?? 'The page could not be read, so there is nothing to check.'}
      />
    );
  }

  return (
    <div className="space-y-4">
      {result.error ? <FetchError message={result.error.message} /> : null}

      <SerpPreview
        title={report.serpPreview.title}
        description={report.serpPreview.description}
        displayUrl={report.serpPreview.displayUrl}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="HTTP status" value={result.status} tone={result.status === 200 ? 'success' : 'warning'} />
        <StatTile
          label="Redirects"
          value={result.redirectCount}
          tone={result.redirectCount > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label="Indexable"
          value={report.robots.noindex ? 'No' : 'Yes'}
          tone={report.robots.noindex ? 'destructive' : 'success'}
        />
        <StatTile
          label="Canonical"
          value={report.canonical.present ? 'Present' : 'Missing'}
          tone={report.canonical.present ? 'success' : 'warning'}
        />
      </div>

      {report.robots.noindex || result.xRobotsTag ? (
        <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-4">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-destructive">This page asks not to be indexed</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {report.robots.metaRobots ? (
                <>
                  A robots meta tag is set to{' '}
                  <code className="mono-value rounded bg-muted px-1.5 py-0.5">
                    {report.robots.metaRobots}
                  </code>
                  .{' '}
                </>
              ) : null}
              {result.xRobotsTag ? (
                <>
                  The server sends{' '}
                  <code className="mono-value rounded bg-muted px-1.5 py-0.5">
                    X-Robots-Tag: {result.xRobotsTag}
                  </code>
                  , which overrides anything in the HTML.
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : null}

      <SectionCard title="Tags found on this page" description={result.finalUrl}>
        <ResultRow label="Title" verdict={report.title.verdict} message={report.title.message}>
          <ValueBlock value={report.title.value} empty="No <title> tag" />
          {report.title.value ? (
            <LengthMeter
              charCount={report.title.charCount}
              pixelWidth={report.title.pixelWidth}
              pixelLimit={report.title.pixelLimit}
            />
          ) : null}
        </ResultRow>

        <ResultRow
          label="Meta description"
          verdict={report.description.verdict}
          message={report.description.message}
        >
          <ValueBlock value={report.description.value} empty="No meta description" />
          {report.description.value ? (
            <LengthMeter
              charCount={report.description.charCount}
              pixelWidth={report.description.pixelWidth}
              pixelLimit={report.description.pixelLimit}
            />
          ) : null}
        </ResultRow>

        <ResultRow
          label="Canonical"
          verdict={report.canonical.verdict}
          message={report.canonical.message}
        >
          <ValueBlock value={report.canonical.resolved ?? report.canonical.value} empty="No rel=canonical" />
        </ResultRow>

        <ResultRow
          label="Headings"
          verdict={report.headings.verdict}
          message={report.headings.message}
        >
          {report.headings.h1.length > 0 ? (
            <div className="space-y-1.5">
              {report.headings.h1.map((heading, index) => (
                <ValueBlock key={`${heading}-${index}`} value={heading} />
              ))}
            </div>
          ) : (
            <ValueBlock value={null} empty="No <h1> on the page" />
          )}
        </ResultRow>
      </SectionCard>

      <SectionCard
        title="Other head signals"
        description="Not graded, but useful context when something looks wrong."
      >
        <dl className="divide-y">
          <MetaRow label="Language" value={report.lang} />
          <MetaRow label="Charset" value={report.charset} />
          <MetaRow label="Viewport" value={report.viewport} />
          <MetaRow label="Content type" value={result.contentType} />
          <MetaRow label="og:title" value={report.social.ogTitle} />
          <MetaRow label="og:description" value={report.social.ogDescription} />
          <MetaRow label="og:image" value={report.social.ogImage} />
          <MetaRow label="twitter:card" value={report.social.twitterCard} />
        </dl>
      </SectionCard>

      {result.redirectChain.length > 0 ? (
        <SectionCard
          title="Redirect chain"
          description="The tags above were read from the final URL."
        >
          <ol className="divide-y">
            {[...result.redirectChain, result.finalUrl].map((url, index, all) => (
              <li key={`${url}-${index}`} className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
                <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="mono-value min-w-0 flex-1 truncate">{url}</span>
                {index < all.length - 1 ? (
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <Badge variant="secondary">final</Badge>
                )}
              </li>
            ))}
          </ol>
        </SectionCard>
      ) : null}

      <FixSection
        codes={[
          report.title.issueCode,
          report.description.issueCode,
          report.canonical.issueCode,
          report.headings.issueCode,
        ]}
      />
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
      <dt className="w-32 shrink-0 text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mono-value min-w-0 flex-1">
        {value ? value : <span className="font-sans italic text-muted-foreground">Not set</span>}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

const URL_STATE_META: Record<
  SitemapUrlState,
  { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }
> = {
  ok: { label: 'OK', variant: 'success' },
  redirect: { label: 'Redirect', variant: 'warning' },
  'client-error': { label: 'Broken', variant: 'destructive' },
  'server-error': { label: 'Server error', variant: 'destructive' },
  blocked: { label: 'Robots blocked', variant: 'warning' },
  unreachable: { label: 'Unreachable', variant: 'destructive' },
};

export function SitemapResult({ result }: { result: SitemapToolResult }) {
  const { summary } = result;
  const problems = result.checked.filter((row) => row.state !== 'ok');

  if (result.error && !result.sitemapUrl) {
    return (
      <div className="space-y-4">
        <FetchError message={result.error.message} />
        {result.discovery.length > 0 ? (
          <SectionCard title="Where we looked" description="Checked in this order.">
            <ul className="divide-y">
              {result.discovery.map((candidate) => (
                <li key={candidate.url} className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
                  <Badge variant="outline">{candidate.source.replace('-', ' ')}</Badge>
                  <span className="mono-value min-w-0 flex-1">{candidate.url}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {result.error ? <FetchError message={result.error.message} /> : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="URLs in sitemap" value={formatNumber(result.totalEntries)} />
        <StatTile label="Checked" value={formatNumber(summary.checkedCount)} />
        <StatTile
          label="Broken"
          value={formatNumber(summary.brokenCount)}
          tone={summary.brokenCount > 0 ? 'destructive' : 'success'}
        />
        <StatTile
          label="Redirects"
          value={formatNumber(summary.redirectCount)}
          tone={summary.redirectCount > 0 ? 'warning' : 'success'}
        />
      </div>

      {result.sitemapUrl ? (
        <SectionCard
          title="Sitemap found"
          description={result.kind === 'sitemapindex' ? 'This is a sitemap index.' : 'Standard urlset sitemap.'}
          action={
            <a
              href={result.sitemapUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              Open <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          }
        >
          <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
            <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="mono-value min-w-0 flex-1">{result.sitemapUrl}</span>
          </div>
          {result.childSitemaps.length > 0 ? (
            <ul className="divide-y border-t">
              {result.childSitemaps.map((child) => (
                <li key={child.url} className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
                  <span className="mono-value min-w-0 flex-1">{child.url}</span>
                  {child.error ? (
                    <Badge variant="destructive">{child.error}</Badge>
                  ) : (
                    <Badge variant="secondary">{formatNumber(child.entries)} URLs</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </SectionCard>
      ) : null}

      <SectionCard
        title="XML validation"
        description="Checked against the sitemaps.org protocol."
      >
        <IssueList
          issues={result.issues.map((issue) => ({
            severity: issue.severity,
            code: issue.code,
            message: issue.message,
            excerpt: issue.excerpt,
          }))}
        />
      </SectionCard>

      {summary.checkedCount > 0 ? (
        <SectionCard
          title="URL status checks"
          description={
            summary.notCheckedCount > 0
              ? `First ${formatNumber(summary.checkedCount)} of ${formatNumber(result.totalEntries)} URLs. ${formatNumber(summary.notCheckedCount)} not checked — the per-run cap keeps this tool from flooding the target site.`
              : `All ${formatNumber(summary.checkedCount)} URLs checked.`
          }
        >
          {problems.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-5">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
              Every URL checked returned a healthy 2xx response.
            </div>
          ) : (
            <ul className="divide-y">
              {problems.slice(0, 200).map((row) => {
                const meta = URL_STATE_META[row.state];
                return (
                  <li key={row.url} className="px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {row.status ? (
                        <span className="text-xs font-medium tabular-nums text-muted-foreground">
                          HTTP {row.status}
                        </span>
                      ) : null}
                      <span className="mono-value min-w-0 flex-1">{row.url}</span>
                    </div>
                    {row.note ? (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{row.note}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      ) : null}

      {result.discovery.length > 1 ? (
        <SectionCard title="How the sitemap was found" description="Candidates tried, in order.">
          <ul className="divide-y">
            {result.discovery.map((candidate) => (
              <li key={candidate.url} className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
                <Badge variant={candidate.used ? 'success' : 'outline'}>
                  {candidate.used ? 'used' : candidate.source.replace('-', ' ')}
                </Badge>
                <span className="mono-value min-w-0 flex-1">{candidate.url}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <FixSection codes={result.issues.map((issue) => issue.code)} />
    </div>
  );
}
