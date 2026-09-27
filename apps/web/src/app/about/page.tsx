import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Zap, Globe, Cpu } from 'lucide-react';
import { PublicShell } from '@/components/layout/public-shell';

export const metadata: Metadata = {
  title: 'About SEO Micro-Tools — Technical Accuracy & Web Standards',
  description:
    'Learn about SEO Micro-Tools, our mission to provide free, pixel-accurate, and compliant technical SEO diagnostics for marketing professionals and engineers.',
  robots: { index: true, follow: true },
};

export default function AboutPage() {
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            About the Project
          </span>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Engineering-grade technical SEO tools. 100% free.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            SEO Micro-Tools was built to solve a simple frustration: most SEO tools either hide
            basic technical checks behind expensive subscriptions, require bloated registrations,
            or rely on outdated heuristics like 60-character title counts rather than real
            search-engine rendering realities.
          </p>
        </header>

        <div className="mt-12 space-y-12">
          <section className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight">Our Core Principles</h2>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="rounded-lg border bg-card p-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
                    <Zap className="h-4 w-4 text-amber-500" />
                  </span>
                  <h3 className="font-semibold text-sm">Pixel-Width Precision</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Google desktop search results do not truncate titles at 60 characters—they
                  truncate at approximately 580 to 600 pixels. Our tools simulate actual Arial
                  advance widths so you see what users will actually see.
                </p>
              </div>

              <div className="rounded-lg border bg-card p-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  </span>
                  <h3 className="font-semibold text-sm">Strict Web Standards</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  We adhere strictly to the RFC 9309 Robots Exclusion Protocol, sitemaps.org XML
                  schema, and Google Search Central specifications. We explain exactly which
                  directive caused a rule to match.
                </p>
              </div>

              <div className="rounded-lg border bg-card p-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
                    <Globe className="h-4 w-4 text-blue-500" />
                  </span>
                  <h3 className="font-semibold text-sm">No Artificial Paywalls</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Every tool on this website is free to use without requiring an account, email, or
                  credit card. We believe individual technical diagnostic tools should be accessible
                  to every webmaster worldwide.
                </p>
              </div>

              <div className="rounded-lg border bg-card p-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md border bg-muted">
                    <Cpu className="h-4 w-4 text-purple-500" />
                  </span>
                  <h3 className="font-semibold text-sm">Safe Server-Side Fetching</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Because modern browsers block cross-origin requests, our tools execute on
                  isolated, SSRF-protected servers that never hit private IP ranges and cache
                  results politely to avoid overburdening your infrastructure.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-semibold tracking-tight">How We Support This Project</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              To keep these micro-tools completely free for all users, we display non-intrusive
              advertisements in fixed-height layout slots that never cause Cumulative Layout Shift
              (CLS). We never sell your diagnostic queries or collect sensitive browsing data.
            </p>
          </section>

          <section className="rounded-lg border bg-muted/30 p-6 sm:p-8">
            <h2 className="text-lg font-semibold tracking-tight">Ready to test your website?</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Jump straight into our diagnostic tools with no setup required.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/tools/robots-txt-tester"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                Test Robots.txt
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/tools"
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-accent"
              >
                View All Tools
              </Link>
            </div>
          </section>
        </div>
      </div>
    </PublicShell>
  );
}
