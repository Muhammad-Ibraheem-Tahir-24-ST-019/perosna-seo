import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { TOOL_CATALOG, findCatalogEntry } from '@indexpilot/shared/client';
import { ToolRunner } from '@/components/tools/tool-runner';
import { getExplainer } from '@/components/tools/explainers';

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
    // The root layout opts the app out of indexing; these pages are the
    // deliberate exception and must opt back in.
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
        // Content is our own static copy, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Tool first: input and results above the fold, per the build brief. */}
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{tool.headline}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {tool.intro}
          </p>
        </header>

        <ToolRunner slug={tool.slug} engine={tool.engine} />

        {/* Ad slot: below the results, never inside the tool. Fixed height so
            it cannot shift the layout when it fills. */}
        <div
          className="my-10 flex h-[90px] items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground"
          data-ad-slot="tools-below-results"
          aria-hidden
        >
          Advertisement
        </div>

        <article className="prose-sm mt-10 max-w-3xl">
          <h2 className="text-lg font-semibold tracking-tight">{explainer.heading}</h2>
          <div className="mt-3 space-y-4">
            {explainer.paragraphs.map((paragraph, index) => (
              <p key={index} className="text-sm leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </div>
        </article>

        <section className="mt-10 max-w-3xl">
          <h2 className="text-lg font-semibold tracking-tight">Common questions</h2>
          <dl className="mt-3 divide-y rounded-lg border">
            {explainer.faqs.map((faq) => (
              <div key={faq.question} className="px-4 py-4 sm:px-5">
                <dt className="text-sm font-medium">{faq.question}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {faq.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {related.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold tracking-tight">Related checks</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {related.map((entry) => (
                <ToolLink key={entry.slug} slug={entry.slug} name={entry.name} intro={entry.intro} />
              ))}
            </div>
          </section>
        ) : null}

        {others.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold tracking-tight">Other free tools</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {others.slice(0, 4).map((entry) => (
                <ToolLink key={entry.slug} slug={entry.slug} name={entry.name} intro={entry.intro} />
              ))}
            </div>
            <Link
              href="/tools"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              See all tools
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </section>
        ) : null}

        <section className="mt-12 rounded-lg border bg-muted/30 px-5 py-6">
          <h2 className="text-base font-semibold tracking-tight">
            Checking one URL at a time is fine. Checking ten thousand is not.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            IndexPilot submits URLs in bulk — including third-party pages and backlinks you do
            not own — validates them, runs them through a discovery pipeline, and verifies
            index status over time. Processing success is reported separately from indexing,
            because they are not the same thing.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/register"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Create a free account
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded-md border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              Sign in
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
      className="group rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
    >
      <p className="text-sm font-medium group-hover:text-foreground">{name}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{intro}</p>
    </Link>
  );
}
