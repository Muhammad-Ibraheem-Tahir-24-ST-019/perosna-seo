import { NextRequest, NextResponse } from 'next/server';
import { findCatalogEntry } from '@indexpilot/shared/client';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const tool = findCatalogEntry(slug);

  if (!tool) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Tool not found.' } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    tool: {
      slug: tool.slug,
      name: tool.name,
      engine: tool.engine,
      headline: tool.headline,
      intro: tool.intro,
      metaTitle: tool.metaTitle,
      metaDescription: tool.metaDescription,
      requiresAuth: false,
    },
  });
}
