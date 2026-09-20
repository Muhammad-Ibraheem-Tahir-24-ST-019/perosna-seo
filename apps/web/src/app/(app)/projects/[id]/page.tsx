'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, Radio, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { ProjectStats, UrlListItem } from '@indexpilot/shared/client';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Textarea,
} from '@/components/ui/core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlay';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { StatCard } from '@/components/metrics';
import { STATUS_FILTER_OPTIONS } from '@/components/status-badge';
import { LoadMore, UrlTable } from '@/components/url-table';
import { formatDateTime, formatNumber } from '@/lib/utils';

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const queryClient = useQueryClient();

  const [status, setStatus] = React.useState('all');
  const [search, setSearch] = React.useState('');
  const [cursors, setCursors] = React.useState<string[]>([]);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.projects.get(projectId),
  });

  const urlsQuery = useQuery({
    queryKey: ['project-urls', projectId, status, search, cursors.length],
    queryFn: () =>
      api.projects.urls(projectId, {
        status,
        search: search || undefined,
        cursor: cursors[cursors.length - 1],
      }),
    placeholderData: (previous) => previous,
  });

  const [accumulated, setAccumulated] = React.useState<UrlListItem[]>([]);
  const page = urlsQuery.data;

  React.useEffect(() => {
    if (!page) return;
    setAccumulated((previous) =>
      cursors.length === 0 ? page.items : [...previous, ...page.items],
    );
  }, [page, cursors.length]);

  React.useEffect(() => {
    setCursors([]);
    setAccumulated([]);
  }, [status, search]);

  // Live progress. Falls back silently to the polling above if SSE is blocked.
  const liveStats = useProjectEvents(projectId, () => {
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  });

  if (projectQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (projectQuery.isError) {
    return (
      <Card>
        <ErrorState
          error={projectQuery.error}
          onRetry={() => void projectQuery.refetch()}
          title={
            projectQuery.error instanceof ApiError && projectQuery.error.status === 404
              ? 'Project not found'
              : 'Could not load the project'
          }
        />
      </Card>
    );
  }

  const project = projectQuery.data?.project;
  if (!project) return null;
  const stats: ProjectStats = liveStats ?? project.stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold sm:text-2xl">{project.name}</h1>
            {project.status === 'ARCHIVED' ? <Badge variant="outline">Archived</Badge> : null}
            {liveStats ? (
              <Badge variant="secondary" className="gap-1">
                <Radio className="h-3 w-3" />
                Live
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {project.description || 'No description'} · created {formatDateTime(project.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/submit?project=${project.id}`}>
              <Upload className="h-4 w-4" />
              Add URLs
            </Link>
          </Button>
          <GenerateReportButton projectId={project.id} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total URLs" value={stats.totalUrls} />
        <StatCard label="Credits spent" value={stats.creditsSpent} />
        <StatCard label="Indexed (confirmed)" value={stats.indexedConfirmed} tone="success" />
        <StatCard label="Pending" value={stats.pending} tone="warning" />
      </div>

      <Tabs defaultValue="urls">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="urls">URLs</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Pipeline breakdown</CardTitle>
              <CardDescription>
                Counts by stage. Discovery submission is not an indexing claim.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {(
                  [
                    ['Valid', stats.valid],
                    ['Invalid', stats.invalid],
                    ['Blocked', stats.blocked],
                    ['Queued', stats.queued],
                    ['Processing', stats.processing],
                    ['Discovery attempted', stats.discoveryAttempted],
                    ['Crawl detected', stats.crawlDetected],
                    ['Indexed (confirmed)', stats.indexedConfirmed],
                    ['Not confirmed indexed', stats.notConfirmedIndexed],
                    ['Failed', stats.failed],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md border p-3">
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">
                      {formatNumber(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="urls">
          <Card className="overflow-hidden">
            <CardHeader className="gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>URLs</CardTitle>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    placeholder="Search URLs…"
                    className="sm:w-56"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Search URLs"
                  />
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="sm:w-56" aria-label="Filter by status">
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
                    emptyTitle="No URLs match this view"
                    emptyDescription="Adjust the filters, or add URLs to this project."
                    emptyAction={
                      <Button asChild size="sm">
                        <Link href={`/submit?project=${project.id}`}>Add URLs</Link>
                      </Button>
                    }
                  />
                  <LoadMore
                    hasMore={Boolean(urlsQuery.data?.nextCursor)}
                    loading={urlsQuery.isFetching}
                    onClick={() => {
                      const next = urlsQuery.data?.nextCursor;
                      if (next) setCursors((previous) => [...previous, next]);
                    }}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <ProjectReports projectId={project.id} />
        </TabsContent>

        <TabsContent value="settings">
          <ProjectSettings
            projectId={project.id}
            name={project.name}
            description={project.description}
            archived={project.status === 'ARCHIVED'}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Subscribes to the project's SSE stream.
 *
 * Returns null when the stream is unavailable so the caller keeps using the
 * REST data it already has.
 */
function useProjectEvents(projectId: string, onUpdate: () => void): ProjectStats | null {
  const [stats, setStats] = React.useState<ProjectStats | null>(null);
  const callbackRef = React.useRef(onUpdate);
  callbackRef.current = onUpdate;

  React.useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/v1/projects/${projectId}/events`);
    let cancelled = false;

    source.addEventListener('stats', (event) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          stats: ProjectStats;
        };
        setStats(payload.stats);
        callbackRef.current();
      } catch {
        /* ignore malformed frames */
      }
    });

    source.onerror = () => {
      // The browser retries automatically; the UI keeps its last known state.
      setStats(null);
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [projectId]);

  return stats;
}

function GenerateReportButton({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.reports.create({ projectId, filter: 'all' }),
    onSuccess: () => {
      toast.success('Report queued. It appears under Reports when ready.');
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not queue the report.'),
  });

  return (
    <Button size="sm" onClick={() => create.mutate()} loading={create.isPending}>
      <Download className="h-4 w-4" />
      Export CSV
    </Button>
  );
}

function ProjectReports({ projectId }: { projectId: string }) {
  const query = useQuery({ queryKey: ['reports'], queryFn: () => api.reports.list() });
  const reports = query.data?.items.filter((report) => report.projectId === projectId) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reports</CardTitle>
        <CardDescription>CSV exports generated for this project.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {query.isLoading ? (
          <TableSkeleton rows={3} />
        ) : reports.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-6">
            No reports yet. Use “Export CSV” to generate one.
          </p>
        ) : (
          <ul className="divide-y">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {report.filter} · {report.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(report.createdAt)}
                    {report.rowCount !== null ? ` · ${formatNumber(report.rowCount)} rows` : ''}
                  </p>
                </div>
                {report.downloadUrl ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={report.downloadUrl}>Download</a>
                  </Button>
                ) : (
                  <Badge variant="secondary">{report.status}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectSettings({
  projectId,
  name,
  description,
  archived,
}: {
  projectId: string;
  name: string;
  description: string | null;
  archived: boolean;
}) {
  const queryClient = useQueryClient();
  const [formName, setFormName] = React.useState(name);
  const [formDescription, setFormDescription] = React.useState(description ?? '');

  const update = useMutation({
    mutationFn: (payload: { name?: string; description?: string | null; status?: 'ACTIVE' | 'ARCHIVED' }) =>
      api.projects.update(projectId, payload),
    onSuccess: () => {
      toast.success('Project updated.');
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Update failed.'),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              update.mutate({ name: formName, description: formDescription || null });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={formName}
                maxLength={120}
                onChange={(event) => setFormName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                className="min-h-[80px] font-sans"
                maxLength={1000}
                value={formDescription}
                onChange={(event) => setFormDescription(event.target.value)}
              />
            </div>
            <Button type="submit" loading={update.isPending}>
              Save changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{archived ? 'Restore project' : 'Archive project'}</CardTitle>
          <CardDescription>
            {archived
              ? 'Restoring lets you submit URLs to this project again.'
              : 'Archiving hides the project and blocks new submissions. Existing data is kept.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant={archived ? 'default' : 'destructive'}
            loading={update.isPending}
            onClick={() => update.mutate({ status: archived ? 'ACTIVE' : 'ARCHIVED' })}
          >
            <Archive className="h-4 w-4" />
            {archived ? 'Restore project' : 'Archive project'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
