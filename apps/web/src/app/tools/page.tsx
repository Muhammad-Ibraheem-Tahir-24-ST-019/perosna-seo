import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, FileCode2, FileSearch, ShieldCheck } from 'lucide-react';
import {
  TOOL_CATALOG,
  TOOL_ENGINE_LABELS,
  type ToolCatalogEntry,
  type ToolEngineKey,
} from '@indexpilot/shared/client';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Free SEO Tools - robots.txt, meta tags, sitemaps | IndexPilot',
  description:
    'Free technical SEO tools. Test robots.txt rules, check meta titles and descriptions by pixel width, verify canonical tags and validate XML sitemaps.',
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_URL}/tools` },
};

const ENGINE_ICONS: Record<ToolEngineKey, React.ComponentType<{ className?: string }>> = {
  ROBOTS_TXT: ShieldCheck,
  PAGE_META: FileSearch,
  SITEMAP: FileCode2,
};

const ENGINE_BLURBS: Record<ToolEngineKey, string> = {
  ROBOTS_TXT:
    'Read any site’s robots.txt, test whether a specific path is crawlable, and find the syntax mistakes that silently disable your rules.',
  PAGE_META:
    'Check titles and descriptions by rendered pixel width rather than character count, inspect canonical tags, and preview the search result.',
  SITEMAP:
    'Find and validate XML sitemaps, then check the URLs inside them for 404s, redirects and robots.txt blocks.',
};

export default function ToolsIndexPage() {
  const groups = new Map<ToolEngineKey, ToolCatalogEntry[]>();
  for (const tool of TOOL_CATALOG) {
    if (!tool.listed) continue;
    const existing = groups.get(tool.engine);
    if (existing) existing.push(tool);
    else groups.set(tool.engine, [tool]);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Free SEO tools</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Technical checks that run against any URL, with no account and no sign-up. Each one
          explains what it found and what to change — not just a pass or fail.
        </p>
      </header>

      <div className="mt-10 space-y-10">
        {[...groups.entries()].map(([engine, tools]) => {
          const Icon = ENGINE_ICONS[engine];
          return (
            <section key={engine}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-card">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">
                    {TOOL_ENGINE_LABELS[engine]}
                  </h2>
                  <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {ENGINE_BLURBS[engine]}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((tool) => (
                  <Link
                    key={tool.slug}
                    href={`/tools/${tool.slug}`}
                    className="group flex flex-col rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
                  >
                    <p className="text-sm font-medium">{tool.name}</p>
                    <p className="mt-1.5 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">
                      {tool.intro}
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                      Open tool
                      <ArrowRight
                        className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <section className="mt-14 rounded-lg border bg-muted/30 px-5 py-6 sm:px-6">
        <h2 className="text-base font-semibold tracking-tight">
          Need to check thousands of URLs, not one?
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          IndexPilot handles bulk submission, validation and index-status verification for URLs you
          own and URLs you do not. Discovery and indexing are reported as separate things, because
          a provider accepting a submission is not the same as a page being indexed.
        </p>
        <Link
          href="/register"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Create a free account
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </section>
    </div>
  );
}
