'use client';

import * as React from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { UrlListItem } from '@indexpilot/shared/client';
import {
  Badge,
  Button,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/core';
import { EmptyState } from '@/components/ui/states';
import { StatusBadge } from '@/components/status-badge';
import { relativeTime, truncateMiddle } from '@/lib/utils';

/**
 * URL list.
 *
 * Below `lg` the table is replaced by stacked cards: a 10 column table squeezed
 * into 320px is unusable, and horizontal scrolling alone hides the status.
 */
export function UrlTable({
  items,
  emptyTitle = 'No URLs yet',
  emptyDescription,
  emptyAction,
  showProject = false,
}: {
  items: UrlListItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  showProject?: boolean;
}) {
  if (items.length === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    );
  }

  return (
    <>
      {/* Mobile / tablet */}
      <ul className="divide-y lg:hidden" data-testid="url-card-list">
        {items.map((url) => (
          <li key={url.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/urls/${url.id}`}
                className="min-w-0 flex-1 break-anywhere text-sm font-medium hover:underline"
              >
                {truncateMiddle(url.normalizedUrl, 70)}
              </Link>
              <StatusBadge status={url.overallStatus} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{url.hostname}</span>
              {showProject && url.projectName ? <span>· {url.projectName}</span> : null}
              <span>· {relativeTime(url.updatedAt)}</span>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop */}
      <TableWrapper className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[45%]">URL</TableHead>
              {showProject ? <TableHead>Project</TableHead> : null}
              <TableHead>Status</TableHead>
              <TableHead>Validation</TableHead>
              <TableHead>Processing</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((url) => (
              <TableRow key={url.id}>
                <TableCell className="max-w-0">
                  <Link
                    href={`/urls/${url.id}`}
                    className="block truncate text-sm font-medium hover:underline"
                    title={url.normalizedUrl}
                  >
                    {url.normalizedUrl}
                  </Link>
                </TableCell>
                {showProject ? (
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {url.projectName ?? '—'}
                  </TableCell>
                ) : null}
                <TableCell>
                  <StatusBadge status={url.overallStatus} />
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{url.validationStatus}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{url.processingStatus}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {relativeTime(url.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="ghost" size="icon" aria-label="Open URL details">
                    <Link href={`/urls/${url.id}`}>
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>
    </>
  );
}

export function LoadMore({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center p-4">
      <Button variant="outline" onClick={onClick} loading={loading}>
        Load more
      </Button>
    </div>
  );
}

export function TableCard({ children }: { children: React.ReactNode }) {
  return <Card className="overflow-hidden">{children}</Card>;
}
