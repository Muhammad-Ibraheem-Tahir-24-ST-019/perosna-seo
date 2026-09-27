'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  FileCode2,
  FileSearch,
  Layers,
  Menu,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Logo } from '@/components/brand';
import { ToolsNav } from '@/components/tools/tools-nav';
import { cn } from '@/lib/utils';

export function PublicHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  // Close mobile menu on route change
  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const isRobotsActive = pathname.includes('/robots-txt');
  const isMetaActive =
    pathname.includes('/meta') ||
    pathname.includes('/title') ||
    pathname.includes('/seo-title');
  const isCanonicalActive = pathname.includes('/canonical');
  const isSitemapActive =
    pathname.includes('/sitemap') || pathname.includes('/xml-sitemap');
  const isAboutActive = pathname === '/about';

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: Brand + Desktop Navigation */}
        <div className="flex items-center gap-5 lg:gap-7">
          <Logo href="/" markClassName="h-7 w-7" />

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main Navigation">
            <ToolsNav />

            <Link
              href="/tools/robots-txt-tester"
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isRobotsActive
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              Robots.txt
            </Link>

            <Link
              href="/tools/meta-title-checker"
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isMetaActive
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              Meta &amp; SERP
            </Link>

            <Link
              href="/tools/canonical-checker"
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isCanonicalActive
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              Canonical
            </Link>

            <Link
              href="/tools/sitemap-checker"
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isSitemapActive
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              Sitemap
            </Link>

            <Link
              href="/about"
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                isAboutActive
                  ? 'bg-accent text-accent-foreground font-semibold'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              About
            </Link>
          </nav>
        </div>

        {/* Right: Status Pill & Action + Mobile Hamburger */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            100% Free
          </div>

          <Link
            href="/tools"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            All 13 Tools
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="inline-flex items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
            aria-label="Toggle Navigation Menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen ? (
        <div className="border-b bg-background/95 backdrop-blur-md px-4 py-4 md:hidden">
          <nav className="flex flex-col space-y-1.5">
            <div className="mb-2 pb-2 border-b flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Navigation
              </span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                No Login Required
              </span>
            </div>

            <Link
              href="/"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === '/' ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              Home
            </Link>

            <Link
              href="/tools"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname === '/tools' ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <Layers className="h-4 w-4 text-primary" />
              All Tools Directory
            </Link>

            <Link
              href="/tools/robots-txt-tester"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isRobotsActive ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <ShieldCheck className="h-4 w-4 text-primary" />
              Robots.txt Tester
            </Link>

            <Link
              href="/tools/meta-title-checker"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isMetaActive ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <FileSearch className="h-4 w-4 text-primary" />
              Meta Title &amp; SERP Preview
            </Link>

            <Link
              href="/tools/canonical-checker"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isCanonicalActive ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <Layers className="h-4 w-4 text-primary" />
              Canonical Tag Checker
            </Link>

            <Link
              href="/tools/sitemap-checker"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isSitemapActive ? 'bg-accent font-semibold text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <FileCode2 className="h-4 w-4 text-primary" />
              XML Sitemap Validator
            </Link>

            <div className="pt-2 border-t mt-2 flex flex-col space-y-1">
              <Link
                href="/about"
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground',
                  isAboutActive && 'font-semibold text-foreground',
                )}
              >
                About
              </Link>
              <Link
                href="/contact"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Contact &amp; Feedback
              </Link>
              <Link
                href="/privacy"
                className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Privacy Policy
              </Link>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t bg-muted/20">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Logo href="/" markClassName="h-7 w-7" />
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Free, professional technical SEO micro-tools designed specifically for SEO
              practitioners, marketers, and web developers. 100% free with no account or sign-up
              required.
            </p>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
              <span>Free forever • Server-side SSRF protected • Pixel-width accurate</span>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Robots &amp; Discovery
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  href="/tools/robots-txt-tester"
                  className="transition-colors hover:text-foreground"
                >
                  Robots.txt Tester
                </Link>
              </li>
              <li>
                <Link
                  href="/tools/robots-txt-checker"
                  className="transition-colors hover:text-foreground"
                >
                  Robots.txt Checker
                </Link>
              </li>
              <li>
                <Link
                  href="/tools/robots-txt-validator"
                  className="transition-colors hover:text-foreground"
                >
                  Robots.txt Validator
                </Link>
              </li>
              <li>
                <Link
                  href="/tools/sitemap-finder"
                  className="transition-colors hover:text-foreground"
                >
                  XML Sitemap Finder
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
              On-Page &amp; Meta
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link
                  href="/tools/meta-checker"
                  className="transition-colors hover:text-foreground"
                >
                  Meta Tag Checker
                </Link>
              </li>
              <li>
                <Link
                  href="/tools/meta-title-checker"
                  className="transition-colors hover:text-foreground"
                >
                  Meta Title Checker
                </Link>
              </li>
              <li>
                <Link
                  href="/tools/meta-description-checker"
                  className="transition-colors hover:text-foreground"
                >
                  Meta Description Checker
                </Link>
              </li>
              <li>
                <Link
                  href="/tools/canonical-checker"
                  className="transition-colors hover:text-foreground"
                >
                  Canonical Tag Checker
                </Link>
              </li>
              <li>
                <Link
                  href="/tools/sitemap-checker"
                  className="transition-colors hover:text-foreground"
                >
                  XML Sitemap Checker
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Company &amp; Legal
            </p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/about" className="transition-colors hover:text-foreground">
                  About the Project
                </Link>
              </li>
              <li>
                <Link href="/contact" className="transition-colors hover:text-foreground">
                  Contact Us
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="transition-colors hover:text-foreground">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="transition-colors hover:text-foreground">
                  Terms of Service
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 border-t pt-6 text-xs leading-relaxed text-muted-foreground">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <p>
              &copy; {new Date().getFullYear()} SEO Micro-Tools. Built for technical SEO
              professionals worldwide. All checks execute server-side in compliance with web
              crawling standards.
            </p>
            <div className="flex items-center gap-4">
              <Link href="/privacy" className="hover:underline">
                Privacy
              </Link>
              <Link href="/terms" className="hover:underline">
                Terms
              </Link>
              <Link href="/contact" className="hover:underline">
                Contact
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicHeader />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
