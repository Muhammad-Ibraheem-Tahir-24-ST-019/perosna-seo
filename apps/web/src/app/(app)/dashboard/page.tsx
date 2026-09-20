'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  FolderKanban,
  Link2,
  Radar,
  SearchCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/core';
import { CardsSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { PipelineChart, StatCard, SubmissionsChart } from '@/components/metrics';
import { UrlTable } from '@/components/url-table';
import { formatNumber, relativeTime } from '@/lib/utils';

export default function DashboardPage() {
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard.get(30),
    refetchInterval: 30_000,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <CardsSkeleton count={6} />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="skeleton h-72" />
          <div className="skeleton h-72" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-6">
        <PageHeading />
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;
  const { totals } = data;
  const isFirstRun = totals.totalUrls === 0;

  return (
    <div className="space-y-6">
      <PageHeading />

      {isFirstRun ? (
        <Card>
          <EmptyState
            icon={Link2}
            title="No URLs submitted yet"
            description="Create a project and paste or upload your URLs. Validation, discovery and index checks run automatically in the background."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link href="/submit">Submit your first URLs</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/projects">Create a project</Link>
                </Button>
              </div>
            }
          />
        </Card>
      ) : null}

      <section aria-label="Key metrics" className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total URLs" value={totals.totalUrls} icon={Link2} />
        <StatCard
          label="Processed"
          value={totals.processed}
          hint="Discovery submitted or crawl detected"
          icon={Radar}
        />
        <StatCard label="Crawl detected" value={totals.crawlDetected} icon={SearchCheck} />
        <StatCard
          label="Indexed (confirmed)"
          value={totals.indexedConfirmed}
          hint="Verified by an index check"
          tone="success"
          icon={CheckCircle2}
        />
        <StatCard label="Pending" value={totals.pending} tone="warning" icon={Clock} />
        <StatCard label="Failed" value={totals.failed} tone="destructive" icon={AlertTriangle} />
        <StatCard label="Projects" value={totals.projects} icon={FolderKanban} />
        <StatCard label="Available credits" value={totals.credits} icon={Coins} />
      </section>

      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        Processing success is not the same as indexing. Only the “Indexed (confirmed)” figure comes
        from an index check; everything else describes work the platform performed.
      </p>

      <section className="grid gap-4 lg:grid-cols-2">
        <SubmissionsChart data={data.series} />
        <PipelineChart data={data.series} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Recent projects</CardTitle>
              <CardDescription>Latest campaigns and their volume.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/projects">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            {data.recentProjects.length === 0 ? (
              <EmptyState
                title="No projects yet"
                description="Projects group the URLs of one campaign or client."
                action={
                  <Button asChild size="sm">
                    <Link href="/projects">Create a project</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y">
                {data.recentProjects.map((project) => (
                  <li key={project.id}>
                    <Link
                      href={`/projects/${project.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 sm:px-6"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{project.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(project.stats.totalUrls)} URLs ·{' '}
                          {formatNumber(project.stats.indexedConfirmed)} confirmed
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {relativeTime(project.createdAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Recent URL activity</CardTitle>
              <CardDescription>Most recently updated URLs.</CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/urls">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0 sm:px-0">
            {query.isFetching && data.recentUrls.length === 0 ? (
              <TableSkeleton rows={4} />
            ) : (
              <UrlTable
                items={data.recentUrls}
                showProject
                emptyTitle="Nothing processed yet"
                emptyDescription="Submitted URLs appear here as they move through validation, discovery and verification."
              />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function PageHeading() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Submission volume, pipeline progress and verified index status.
        </p>
      </div>
      <Button asChild>
        <Link href="/submit">Submit URLs</Link>
      </Button>
    </div>
  );
}
