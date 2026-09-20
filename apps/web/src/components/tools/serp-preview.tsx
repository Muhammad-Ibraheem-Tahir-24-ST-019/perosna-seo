'use client';

import * as React from 'react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A mock of Google's desktop result, rendered from the page's real tags.
 *
 * The point is not decoration: seeing the title cut off mid-word is far more
 * persuasive than a number saying "612px". The text passed in has already been
 * truncated server-side using Arial metrics, so what renders here is what the
 * SERP would actually show.
 *
 * Arial is forced on the title and snippet so the preview matches the
 * measurement; the rest of the card uses the app font.
 */
export function SerpPreview({
  title,
  description,
  displayUrl,
  className,
}: {
  title: string;
  description: string;
  displayUrl: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-md border bg-background p-4', className)}>
      <p className="mb-3 text-xs font-medium text-muted-foreground">
        How this page is likely to appear in Google
      </p>

      <div className="max-w-[37rem]" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-muted"
            aria-hidden
          >
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <span className="truncate text-xs leading-tight text-muted-foreground">{displayUrl}</span>
        </div>

        {/* Google renders the title link at 20px in a blue that shifts by theme. */}
        <p className="mt-1.5 text-[1.25rem] leading-[1.3] text-[#1a0dab] dark:text-[#8ab4f8]">
          {title}
        </p>

        <p className="mt-1 text-[0.875rem] leading-[1.58] text-[#4d5156] dark:text-[#bdc1c6]">
          {description}
        </p>
      </div>
    </div>
  );
}
