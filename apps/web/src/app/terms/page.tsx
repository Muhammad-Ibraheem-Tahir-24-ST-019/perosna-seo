import type { Metadata } from 'next';
import { PublicShell } from '@/components/layout/public-shell';

export const metadata: Metadata = {
  title: 'Terms of Service — SEO Micro-Tools',
  description:
    'Review the terms of service governing the use of SEO Micro-Tools free diagnostics and checkers.',
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="max-w-3xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Legal &amp; Terms
          </span>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Terms of Service</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: September 2026</p>
        </header>

        <article className="prose prose-sm dark:prose-invert mt-8 max-w-none space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">1. Acceptance of Terms</h2>
            <p>
              By accessing and using SEO Micro-Tools (&ldquo;the Service&rdquo;), you agree to be bound
              by these Terms of Service. If you do not agree to these terms, please do not use the
              Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">2. Permitted Use</h2>
            <p>
              The Service provides technical SEO micro-tools including robots.txt validation, meta
              tag auditing, canonical tag verification, and XML sitemap inspection. You may use
              these tools free of charge for lawful diagnostic and optimization purposes.
            </p>
            <p>
              You agree not to abuse the Service by initiating automated high-concurrency requests,
              denial of service attacks, or attempting to probe internal or private networks through
              our fetch infrastructure.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">3. Fair Use &amp; Rate Limits</h2>
            <p>
              To maintain high availability and prevent abuse of destination web servers, we apply
              reasonable hourly rate limits per IP address and caps on the number of URLs crawled per
              sitemap audit. Bypassing or attempting to circumvent rate limits is strictly
              prohibited.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">4. Disclaimer of Warranties</h2>
            <p>
              The Service and its diagnostic results are provided &ldquo;as is&rdquo; and &ldquo;as
              available&rdquo; without warranties of any kind, whether express or implied.
            </p>
            <p>
              While we strive for high technical accuracy based on web standards (such as RFC 9309
              and sitemaps.org schemas), search engine algorithms are proprietary and subject to
              change. We do not guarantee that resolving flagged issues will result in specific
              search rankings or indexation outcomes.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">5. Limitation of Liability</h2>
            <p>
              In no event shall SEO Micro-Tools, its authors, or operators be liable for any direct,
              indirect, incidental, special, or consequential damages resulting from the use or
              inability to use the Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">6. Modifications</h2>
            <p>
              We reserve the right to modify these terms at any time. Continued use of the Service
              after changes are posted constitutes your acceptance of the updated terms.
            </p>
          </section>
        </article>
      </div>
    </PublicShell>
  );
}
