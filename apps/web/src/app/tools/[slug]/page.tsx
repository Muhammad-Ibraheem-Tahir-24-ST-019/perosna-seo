import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, CheckCircle2, Wrench } from 'lucide-react';
import { TOOL_CATALOG, findCatalogEntry, type ToolEngineKey } from '@indexpilot/shared/client';
import { ToolRunner } from '@/components/tools/tool-runner';
import { getExplainer } from '@/components/tools/explainers';
import { FIX_GUIDES } from '@/components/tools/fixes';

/**
 * A public tool page.
 *
 * Rendered per slug from the shared catalogue. Each route gets its own H1,
 * intro, title and description — that is what makes several pages over one
 * engine legitimate rather than duplicate content — and a self-referencing
 * canonical, which is the other half of the same requirement.
 *
 * The page is a server component so the copy and metadata are in the HTML for
 * crawlers; only the tool itself is interactive.
 */

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const ENGINE_COMMON_FIXES: Record<ToolEngineKey, string[]> = {
  ROBOTS_TXT: [
    'robots-blocks-all',
    'robots-empty',
    'robots-is-html',
    'robots-no-sitemap',
    'robots-typo',
    'robots-missing-colon',
    'robots-path-no-slash',
    'robots-rules-before-agent',
  ],
  PAGE_META: [
    'title-missing',
    'title-too-long',
    'title-too-short',
    'description-missing',
    'description-too-long',
    'canonical-missing',
    'canonical-duplicate',
    'canonical-other-domain',
  ],
  SITEMAP: [
    'sitemap-is-html',
    'sitemap-no-namespace',
    'sitemap-wrong-namespace',
    'sitemap-unescaped-ampersand',
    'sitemap-bad-lastmod',
    'sitemap-entry-no-loc',
    'sitemap-duplicates',
    'sitemap-too-many-urls',
  ],
};

export function generateStaticParams() {
  return TOOL_CATALOG.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tool = findCatalogEntry(slug);
  if (!tool) return { title: 'Tool not found' };

  const canonical = `${SITE_URL}/tools/${tool.slug}`;
  return {
    title: tool.metaTitle,
    description: tool.metaDescription,
    robots: { index: true, follow: true },
    alternates: { canonical },
    openGraph: {
      title: tool.metaTitle,
      description: tool.metaDescription,
      url: canonical,
      type: 'website',
    },
    twitter: {
      card: 'summary',
      title: tool.metaTitle,
      description: tool.metaDescription,
    },
  };
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = findCatalogEntry(slug);
  if (!tool) notFound();

  const explainer = getExplainer(tool.engine, tool.slug);
  const commonFixCodes = ENGINE_COMMON_FIXES[tool.engine] ?? [];
  const fixGuides = commonFixCodes
    .map((code) => FIX_GUIDES[code])
    .filter((g): g is NonNullable<typeof g> => g !== undefined);

  const related = TOOL_CATALOG.filter(
    (entry) => entry.engine === tool.engine && entry.slug !== tool.slug && entry.listed,
  ).slice(0, 4);
  const others = TOOL_CATALOG.filter((entry) => entry.engine !== tool.engine && entry.listed);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebApplication',
        name: tool.name,
        url: `${SITE_URL}/tools/${tool.slug}`,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Any',
        description: tool.metaDescription,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
      {
        '@type': 'FAQPage',
        mainEntity: explainer.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Tool first: input and results above the fold, per the build brief. */}
        <header className="mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full border bg-muted/30 px-3 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            100% Free • No Account Needed
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{tool.headline}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {tool.intro}
          </p>
        </header>

        <ToolRunner slug={tool.slug} engine={tool.engine} />

        {/* Ad slot: below the results, never inside the tool. Fixed height to prevent CLS. */}
        <div
          className="my-10 flex h-[90px] w-full items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground"
          data-ad-slot="tools-below-results"
          aria-hidden
        >
          Advertisement
        </div>

        {/* Deep Explainer Section */}
        <article className="prose-sm mt-10 max-w-3xl">
          <h2 className="text-xl font-bold tracking-tight">{explainer.heading}</h2>
          <div className="mt-3 space-y-4">
            {explainer.paragraphs.map((paragraph, index) => (
              <p key={index} className="text-sm leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        </article>

        {/* How to Fix Common Issues Section */}
        {fixGuides.length > 0 ? (
          <section className="mt-12 max-w-3xl">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" aria-hidden />
              <h2 className="text-xl font-bold tracking-tight">
                How to Fix Common {tool.name} Issues
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Reference guide for resolving the most frequent configuration errors and warnings.
            </p>

            <div className="mt-4 divide-y rounded-lg border bg-card">
              {fixGuides.map((guide) => (
                <article key={guide.title} className="p-4 sm:p-5">
                  <h3 className="text-sm font-semibold text-foreground">{guide.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {guide.what}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-foreground">
                    <span className="font-semibold text-primary">The Fix: </span>
                    {guide.fix}
                  </p>
                  {guide.example ? (
                    <pre className="mono-value mt-2.5 overflow-x-auto rounded-md border bg-muted/40 p-2.5 text-[11px] scrollbar-thin">
                      {guide.example}
                    </pre>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {/* FAQs */}
        <section className="mt-12 max-w-3xl">
          <h2 className="text-xl font-bold tracking-tight">Frequently Asked Questions</h2>
          <dl className="mt-4 divide-y rounded-lg border bg-card">
            {explainer.faqs.map((faq) => (
              <div key={faq.question} className="p-4 sm:p-5">
                <dt className="text-sm font-medium">{faq.question}</dt>
                <dd className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Related checks */}
        {related.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-lg font-semibold tracking-tight">Related checks</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {related.map((entry) => (
                <ToolLink
                  key={entry.slug}
                  slug={entry.slug}
                  name={entry.name}
                  intro={entry.intro}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* Other free tools */}
        {others.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight">Other free tools</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {others.slice(0, 4).map((entry) => (
                <ToolLink
                  key={entry.slug}
                  slug={entry.slug}
                  name={entry.name}
                  intro={entry.intro}
                />
              ))}
            </div>
            <Link
              href="/tools"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              See all 13 tools
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </section>
        ) : null}

        {/* Free tool guarantee box */}
        <section className="mt-12 rounded-lg border bg-muted/20 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
            <h2 className="text-base font-semibold tracking-tight">
              100% Free Technical SEO Tools
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Our micro-tools run directly on our secure server-side infrastructure without requiring
            user accounts or subscriptions. Checks are cached for 15 minutes to respect destination
            server resources and provide instant answers.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/tools"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Browse All Micro-Tools
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <Link
              href="/about"
              className="inline-flex items-center rounded-md border bg-card px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-accent"
            >
              About the Project
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}

function ToolLink({ slug, name, intro }: { slug: string; name: string; intro: string }) {
  return (
    <Link
      href={`/tools/${slug}`}
      className="group rounded-lg border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-sm"
    >
      <p className="text-sm font-semibold group-hover:text-primary">{name}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{intro}</p>
    </Link>
  );
}
