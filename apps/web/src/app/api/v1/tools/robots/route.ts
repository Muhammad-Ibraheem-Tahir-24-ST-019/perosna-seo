import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { consumeToolQuota, runRobotsToolStandalone } from '@/lib/server-tools';

export const runtime = 'nodejs';

const schema = z.object({
  url: z.string().trim().min(1, 'Enter a URL or domain.').max(2048),
  slug: z.string().trim().max(80).optional(),
  paths: z.array(z.string().trim().max(2048)).max(25).optional(),
  userAgent: z.string().trim().max(120).optional(),
});

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';
  const { allowed, quota } = consumeToolQuota(ip);

  if (!allowed) {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: `Hourly check limit reached (${quota.limit}/hr). Please wait ${Math.ceil(quota.resetSeconds / 60)} minutes.`,
        },
      },
      {
        status: 429,
        headers: {
          'x-tool-quota-limit': String(quota.limit),
          'x-tool-quota-remaining': String(quota.remaining),
          'retry-after': String(quota.resetSeconds),
        },
      },
    );
  }

  try {
    const rawBody = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? 'Invalid request body.',
          },
        },
        { status: 400 },
      );
    }

    const { result, meta } = await runRobotsToolStandalone(parsed.data.url, {
      paths: parsed.data.paths,
      userAgent: parsed.data.userAgent,
    });

    return NextResponse.json(
      { result, meta, quota },
      {
        headers: {
          'x-tool-quota-limit': String(quota.limit),
          'x-tool-quota-remaining': String(quota.remaining),
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to test robots.txt';
    return NextResponse.json(
      {
        error: {
          code: 'EXECUTION_ERROR',
          message,
        },
      },
      { status: 400 },
    );
  }
}
