import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  FileCode2,
  FileSearch,
  Globe,
  Layers,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { TOOL_CATALOG, TOOL_ENGINE_LABELS, type ToolEngineKey } from '@indexpilot/shared/client';
import { PublicShell } from '@/components/layout/public-shell';
import { ToolRunner } from '@/components/tools/tool-runner';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  title: 'Free SEO Micro-Tools — Robots.txt, Meta Tags & Sitemap Checkers',
  description:
    'Free technical SEO micro-tools for marketers and developers. Test robots.txt directives, check title and description length by pixel width, inspect canonical tags, and validate XML sitemaps. 100% free with no login required.',
  robots: { index: true, follow: true },
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: 'Free SEO Micro-Tools — Robots.txt, Meta & Sitemap Checkers',
    description:
      'Fast, accurate technical SEO diagnostics for marketers and developers. No login, no credit card, 100% free.',
    url: SITE_URL,
    type: 'website',
  },
};

const FEATURED_TOOLS = [
  {
    slug: 'robots-txt-tester',
    name: 'Robots.txt Tester & Validator',
    engine: 'ROBOTS_TXT' as ToolEngineKey,
    volume: '26,090/mo cluster',
    icon: ShieldCheck,
    headline: 'Validate robots.txt & test crawl rules',
    description:
      'Read any site’s robots.txt, test whether a specific path is crawlable by Googlebot or other user-agents, and trace the exact directive that allowed or blocked it.',
    features: [
      'Line-by-line syntax checking',
      'Directive attribution for URL paths',
      'Detects fatal Disallow: / mistakes',
      'Auto-extracts declared sitemaps',
    ],
  },
  {
    slug: 'meta-title-checker',
    name: 'Meta Title & Description Checker',
    engine: 'PAGE_META' as ToolEngineKey,
    volume: '18,930/mo cluster',
    icon: FileSearch,
    headline: 'Check SERP snippet pixel widths',
    description:
      'Google truncates titles by rendered pixel width, not arbitrary character limits. Check exact pixel widths and preview your Google search snippet in real-time.',
    features: [
      'Arial desktop advance-width calculation',
      'Simulated Google SERP snippet preview',
      'Title and description length evaluation',
      'Social Graph & Twitter Card signals',
    ],
  },
  {
    slug: 'canonical-checker',
    name: 'Canonical Tag Checker',
    engine: 'PAGE_META' as ToolEngineKey,
    volume: '3,280/mo cluster',
    icon: Layers,
    headline: 'Inspect rel="canonical" tags',
    description:
      'Ensure search engines consolidate indexing signals to the correct page. Flag missing canonicals, non-self-referencing tags, and cross-domain duplicate directives.',
    features: [
      'Self-referential vs cross-domain detection',
      'Catches duplicate canonical definitions',
      'Follows redirect chains to destination',
      'Evaluates HTTP X-Robots-Tag canonicals',
    ],
  },
  {
    slug: 'sitemap-checker',
    name: 'XML Sitemap Checker & Validator',
    engine: 'SITEMAP' as ToolEngineKey,
    volume: '12,030/mo cluster',
    icon: FileCode2,
    headline: 'Deep XML validation & URL status checks',
    description:
      'Auto-discover your sitemap from robots.txt, validate XML syntax against the sitemaps.org protocol, and test the HTTP status of URLs inside it.',
    features: [
      'Auto-discovery via robots.txt and common paths',
      'Sitemap index expansion & child discovery',
      'Live HTTP status checks (flags 404s, redirects)',
      'Strict compliance with robots.txt rules',
    ],
  },
];

export default function HomePage() {
  return (
    <PublicShell>
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b bg-gradient-to-b from-muted/50 via-background to-background py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-1 text-xs font-medium shadow-sm">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
              <span className="text-foreground">SEO Micro-Tools Platform</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                100% Free Forever
              </span>
            </div>

            <h1 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">
              Professional SEO micro-tools.{' '}
              <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Free &amp; instant.
              </span>
            </h1>

            <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
              Engineered for SEO specialists, growth marketers, and web engineers. Test robots.txt
              directives, measure title and meta description pixel lengths, verify canonical tags,
              and validate XML sitemaps without login walls or artificial paygates.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/tools/robots-txt-tester"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Test Robots.txt
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/tools/meta-title-checker"
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-accent"
              >
                Check Meta &amp; SERP
              </Link>
              <Link
                href="/tools/sitemap-checker"
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-accent"
              >
                Audit XML Sitemap
              </Link>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                <span>No sign-up or credit card</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                <span>True pixel-width calculation</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                <span>Safe server-side fetches (No CORS)</span>
              </div>
            </div>
          </div>

          {/* Quick Runner Preview above the fold */}
          <div className="mt-12 mx-auto max-w-3xl rounded-xl border bg-card/60 p-4 shadow-sm backdrop-blur sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Instant Diagnostics</p>
                <p className="text-xs text-muted-foreground">
                  Run a live check right here, or explore individual tool pages below.
                </p>
              </div>
              <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                Live Engine
              </span>
            </div>
            <ToolRunner slug="robots-txt-tester" engine="ROBOTS_TXT" />
          </div>
        </div>
      </section>

      {/* Featured Core Tools Section */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Four Core Diagnostics Engines
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Each tool provides concrete technical answers and plain-English fix recommendations,
              not opaque scores.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {FEATURED_TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <div
                  key={tool.slug}
                  className="flex flex-col rounded-xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                      <Icon className="h-5 w-5 text-primary" aria-hidden />
                    </span>
                    <span className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {tool.volume}
                    </span>
                  </div>

                  <h3 className="mt-4 text-lg font-semibold">{tool.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {tool.description}
                  </p>

                  <ul className="mt-4 space-y-2 border-t pt-4 text-xs text-muted-foreground">
                    {tool.features.map((feat, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-hidden />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-6 pt-2">
                    <Link
                      href={`/tools/${tool.slug}`}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-secondary px-4 py-2 text-sm font-semibold transition-colors hover:bg-secondary/80"
                    >
                      Open {tool.name.split(' ')[0]} Tool
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Complete 13 Keyword Tools Directory */}
      <section className="border-t bg-muted/10 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Complete Tools Directory
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Thirteen specialized landing pages tailored to specific technical SEO search
              intentions. Every tool is completely free with no limits.
            </p>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TOOL_CATALOG.filter((tool) => tool.listed).map((tool) => (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                className="group flex flex-col rounded-lg border bg-card p-5 transition-all hover:border-primary/50 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {TOOL_ENGINE_LABELS[tool.engine]}
                  </span>
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    Free
                  </span>
                </div>
                <h3 className="mt-2 text-base font-semibold group-hover:text-primary">
                  {tool.name}
                </h3>
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {tool.intro}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  Launch tool
                  <ArrowRight
                    className="h-3 w-3 transition-transform group-hover:translate-x-1"
                    aria-hidden
                  />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Technical Standards Section */}
      <section className="border-t py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-3">
            <div className="space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
                <Zap className="h-5 w-5 text-amber-500" aria-hidden />
              </div>
              <h3 className="text-base font-semibold">Pixel Widths, Not Character Counts</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Google truncates desktop search snippet titles at approximately 580–600 pixels.
                Because an uppercase &lsquo;W&rsquo; is three times wider than a lowercase &lsquo;l&rsquo;,
                character limits are fundamentally inaccurate. Our engine calculates advance widths
                using the true Arial desktop rendering font.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
                <ShieldCheck className="h-5 w-5 text-emerald-500" aria-hidden />
              </div>
              <h3 className="text-base font-semibold">SSRF-Safe Server Fetches</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Browser-based tools fail because cross-origin resource sharing (CORS) blocks
                third-party fetches. Our secure backend fetch engine safely pulls robots.txt, HTML
                headers, and XML sitemaps while enforcing strict SSRF protections against private
                networks.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
                <Globe className="h-5 w-5 text-blue-500" aria-hidden />
              </div>
              <h3 className="text-base font-semibold">Respects Robots Protocol</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                When auditing XML sitemaps, our crawler fetches and respects the target domain’s
                robots.txt rules, honoring Crawl-delay directives and Disallow statements so your
                server is never an abusive crawler.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* AdSense Fixed Slot (Zero CLS) */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div
          className="flex h-[90px] w-full items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground"
          data-ad-slot="home-bottom"
          aria-hidden
        >
          Advertisement
        </div>
      </div>
    </PublicShell>
  );
}
