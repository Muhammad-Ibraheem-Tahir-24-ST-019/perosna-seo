import type { Metadata } from 'next';
import { PublicShell } from '@/components/layout/public-shell';

export const metadata: Metadata = {
  title: 'Privacy Policy — SEO Micro-Tools',
  description:
    'Read the SEO Micro-Tools Privacy Policy. Understand how diagnostic requests are processed, how cookies are used, and our commitment to user privacy.',
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="max-w-3xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Legal &amp; Compliance
          </span>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: September 2026</p>
        </header>

        <article className="prose prose-sm dark:prose-invert mt-8 max-w-none space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">1. Overview</h2>
            <p>
              SEO Micro-Tools (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) provides free
              online technical SEO analysis tools. We respect your privacy and are committed to
              protecting it. This Privacy Policy explains our practices regarding data collection,
              processing, and storage when you use our website.
            </p>
            <p>
              <strong>We do not require user accounts or registration</strong> to access or run our
              SEO diagnostic tools. You can use our tools anonymously.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              2. Information We Process When You Use Our Tools
            </h2>
            <p>
              When you submit a URL or domain to be inspected (e.g. for robots.txt testing, meta tag
              evaluation, or XML sitemap verification):
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong>Target URLs:</strong> We fetch the public web page, robots.txt file, or XML
                sitemap requested by you via our server-side fetching system.
              </li>
              <li>
                <strong>Diagnostic Results Caching:</strong> Results are temporarily cached for up
                to 15 minutes to reduce unnecessary load on destination servers and provide fast
                repeated checks.
              </li>
              <li>
                <strong>Server Logs:</strong> Our servers temporarily log your IP address in an
                anonymized/hashed form solely for the purpose of rate-limiting, preventing denial of
                service (DDoS) attacks, and maintaining service reliability.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              3. Cookies and Advertising (Google AdSense)
            </h2>
            <p>
              We may partner with third-party advertising networks, such as Google AdSense, to serve
              advertisements on our website.
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                Google, as a third-party vendor, uses cookies to serve ads based on a user&apos;s prior
                visits to our website or other websites.
              </li>
              <li>
                Google&apos;s use of advertising cookies enables it and its partners to serve ads to users
                based on their visit to our sites and/or other sites on the Internet.
              </li>
              <li>
                Users may opt out of personalized advertising by visiting{' '}
                <a
                  href="https://www.google.com/settings/ads"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Google Ads Settings
                </a>{' '}
                or{' '}
                <a
                  href="https://www.aboutads.info"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  aboutads.info
                </a>
                .
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              4. Server-Side Fetching &amp; SSRF Safety
            </h2>
            <p>
              Our backend fetch service strictly enforces Server-Side Request Forgery (SSRF)
              prevention policies. We do not crawl or fetch private IP ranges, loopback addresses,
              link-local addresses, or cloud metadata endpoints. Fetches respect HTTP timeouts and
              adhere to robots.txt crawl guidelines.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">5. Data Retention</h2>
            <p>
              We do not persist your URL crawl requests in permanent user databases. Diagnostic
              cache entries expire automatically after 15 minutes. Aggregated metrics (such as daily
              tool completion counts) contain no personally identifiable information (PII).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">6. Your Rights</h2>
            <p>
              Depending on your location, you may have rights under data privacy laws such as the
              General Data Protection Regulation (GDPR) or California Consumer Privacy Act (CCPA).
              Because we do not maintain accounts or track individual profiles, we do not associate
              diagnostic tool runs with your personal identity.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">7. Contact Information</h2>
            <p>
              If you have any questions about this Privacy Policy, please contact us at{' '}
              <span className="font-mono text-foreground">privacy@seomicrotools.local</span>.
            </p>
          </section>
        </article>
      </div>
    </PublicShell>
  );
}
