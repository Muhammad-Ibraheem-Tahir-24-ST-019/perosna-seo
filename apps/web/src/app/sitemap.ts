import type { MetadataRoute } from 'next';
import { TOOL_CATALOG } from '@indexpilot/shared/client';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * Only the publicly indexable pages belong here.
 *
 * Built from the same catalogue that generates the routes, so a tool page can
 * never exist without being listed, or be listed after it is removed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: `${SITE_URL}/tools`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    ...TOOL_CATALOG.filter((tool) => tool.listed).map((tool) => ({
      url: `${SITE_URL}/tools/${tool.slug}`,
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
