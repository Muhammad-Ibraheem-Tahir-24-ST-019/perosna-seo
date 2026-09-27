import { NextResponse } from 'next/server';
import { TOOL_CATALOG } from '@indexpilot/shared/client';

export const runtime = 'nodejs';

export async function GET() {
  const items = TOOL_CATALOG.filter((tool) => tool.listed).map((tool) => ({
    slug: tool.slug,
    name: tool.name,
    engine: tool.engine,
    headline: tool.headline,
    intro: tool.intro,
    requiresAuth: false,
  }));

  return NextResponse.json({ items });
}
