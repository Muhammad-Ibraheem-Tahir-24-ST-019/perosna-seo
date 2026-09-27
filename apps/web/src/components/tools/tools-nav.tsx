'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, FileCode2, FileSearch, ShieldCheck, ArrowRight, Layers } from 'lucide-react';
import { TOOL_CATALOG, type ToolEngineKey } from '@indexpilot/shared/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/overlay';
import { cn } from '@/lib/utils';

const ENGINE_ICONS: Record<ToolEngineKey, React.ComponentType<{ className?: string }>> = {
  ROBOTS_TXT: ShieldCheck,
  PAGE_META: FileSearch,
  SITEMAP: FileCode2,
};

const ENGINE_TITLES: Record<ToolEngineKey, string> = {
  ROBOTS_TXT: 'Robots.txt & Crawl',
  PAGE_META: 'Meta Tags & SERP',
  SITEMAP: 'XML Sitemaps',
};

export function ToolsNav() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

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

  const isAnyToolActive = pathname.startsWith('/tools');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isAnyToolActive
              ? 'bg-accent/80 text-foreground font-semibold'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <Layers className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span>Tools</span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[360px] sm:w-[640px] p-4 bg-popover text-popover-foreground border border-border shadow-2xl rounded-xl z-50"
      >
        <div className="grid gap-6 sm:grid-cols-3">
          {grouped.map(([engine, tools]) => {
            const Icon = ENGINE_ICONS[engine];
            return (
              <div key={engine} className="space-y-2">
                <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                  <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden />
                  <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    {ENGINE_TITLES[engine]}
                  </p>
                </div>
                <div className="space-y-1">
                  {tools.map((tool) => {
                    const isActive = pathname === `/tools/${tool.slug}`;
                    return (
                      <Link
                        key={tool.slug}
                        href={`/tools/${tool.slug}`}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'block rounded-md px-2.5 py-1.5 text-xs transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <p className="font-medium truncate">{tool.name}</p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t flex items-center justify-between text-xs">
          <span className="text-muted-foreground">All 13 technical SEO tools are 100% free.</span>
          <Link
            href="/tools"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            Explore all tools
            <ArrowRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
