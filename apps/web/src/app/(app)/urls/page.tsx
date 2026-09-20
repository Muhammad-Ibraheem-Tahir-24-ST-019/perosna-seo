'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { UrlListItem } from '@indexpilot/shared/client';
import { api } from '@/lib/api';
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui/core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlay';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { STATUS_FILTER_OPTIONS } from '@/components/status-badge';
import { LoadMore, UrlTable } from '@/components/url-table';

export default function UrlsPage() {
  const [status, setStatus] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [projectId, setProjectId] = React.useState('all');
  const [cursors, setCursors] = React.useState<string[]>([]);
  const [accumulated, setAccumulated] = React.useState<UrlListItem[]>([]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const projectsQuery = useQuery({
    queryKey: ['projects', { includeArchived: true }],
    queryFn: () => api.projects.list({ includeArchived: true }),
  });

  const urlsQuery = useQuery({
    queryKey: ['urls', status, debounced, projectId, cursors.length],
    queryFn: () =>
      api.urls.list({
        status,
        search: debounced || undefined,
        projectId: projectId === 'all' ? undefined : projectId,
        cursor: cursors[cursors.length - 1],
      }),
    placeholderData: (previous) => previous,
  });

  const page = urlsQuery.data;

  React.useEffect(() => {
    if (!page) return;
    setAccumulated((previous) => (cursors.length === 0 ? page.items : [...previous, ...page.items]));
  }, [page, cursors.length]);

  React.useEffect(() => {
    setCursors([]);
    setAccumulated([]);
  }, [status, debounced, projectId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">URLs</h1>
          <p className="text-sm text-muted-foreground">
            Every submitted URL and where it stands in the pipeline.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/submit">Submit URLs</Link>
        </Button>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle>All URLs</CardTitle>
            <div className="grid gap-2 sm:grid-cols-3 lg:w-auto">
              <Input
                placeholder="Search URLs…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search URLs"
                className="lg:w-56"
              />
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger aria-label="Filter by project" className="lg:w-48">
                  <SelectValue placeholder="All projects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projectsQuery.data?.items.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger aria-label="Filter by status" className="lg:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 pb-0 sm:px-0">
          {urlsQuery.isLoading && accumulated.length === 0 ? (
            <TableSkeleton />
          ) : urlsQuery.isError ? (
            <ErrorState error={urlsQuery.error} onRetry={() => void urlsQuery.refetch()} />
          ) : (
            <>
              <UrlTable
                items={accumulated}
                showProject
                emptyTitle="No URLs match this view"
                emptyDescription="Try a different filter, or submit a new batch."
                emptyAction={
                  <Button asChild size="sm">
                    <Link href="/submit">Submit URLs</Link>
                  </Button>
                }
              />
              <LoadMore
                hasMore={Boolean(page?.nextCursor)}
                loading={urlsQuery.isFetching}
                onClick={() => {
                  const next = page?.nextCursor;
                  if (next) setCursors((previous) => [...previous, next]);
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
