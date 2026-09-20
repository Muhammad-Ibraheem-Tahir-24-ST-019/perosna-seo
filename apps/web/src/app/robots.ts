import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

/**
 * The app itself is private; the free tools are the deliberate exception.
 *
 * Allowing only /tools keeps the signed-in product out of search while letting
 * the acquisition pages be crawled. (We would rather practise what these tools
 * preach than ship a robots.txt our own checker would flag.)
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/tools', '/tools/'],
        disallow: [
          '/',
          '/api/',
          '/dashboard',
          '/projects',
          '/urls',
          '/submit',
          '/reports',
          '/billing',
          '/settings',
          '/api-keys',
          '/admin',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
