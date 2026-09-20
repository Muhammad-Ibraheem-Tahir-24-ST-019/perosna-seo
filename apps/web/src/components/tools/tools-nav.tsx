'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { TOOL_CATALOG, TOOL_ENGINE_LABELS, type ToolEngineKey } from '@indexpilot/shared/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlay';
import { cn } from '@/lib/utils';

/**
 * Cross-links every tool from every tool page.
 *
 * This is navigation first and internal linking second: a visitor who lands on
 * the sitemap checker from a search result should be one click from the other
 * tools, and the links give the thin keyword pages a reason to be connected.
 */
export function ToolsNav() {
  const pathname = usePathname();

  const grouped = React.useMemo(() => {
    const groups = new Map<ToolEngineKey, typeof TOOL_CATALOG>();
    for (const tool of TOOL_CATALOG) {
      if (!tool.listed) continue;
      const existing = groups.get(tool.engine);
      if (existing) existing.push(tool);
      else groups.set(tool.engine, [tool]);
    }
    return [...groups.entries()];
  }, []);

  const current = TOOL_CATALOG.find((tool) => pathname === `/tools/${tool.slug}`);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {current ? current.name : 'Free tools'}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem asChild>
          <Link href="/tools" className="font-medium">
            All tools
          </Link>
        </DropdownMenuItem>
        {grouped.map(([engine, tools]) => (
          <React.Fragment key={engine}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {TOOL_ENGINE_LABELS[engine]}
            </DropdownMenuLabel>
            {tools.map((tool) => (
              <DropdownMenuItem key={tool.slug} asChild>
                <Link
                  href={`/tools/${tool.slug}`}
                  className={cn(pathname === `/tools/${tool.slug}` && 'font-medium text-foreground')}
                >
                  {tool.name}
                </Link>
              </DropdownMenuItem>
            ))}
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
