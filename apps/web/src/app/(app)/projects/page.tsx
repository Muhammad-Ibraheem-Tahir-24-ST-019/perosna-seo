'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import { api } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@/components/ui/core';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { CreateProjectDialog } from '@/components/create-project-dialog';
import { formatNumber, relativeTime } from '@/lib/utils';

export default function ProjectsPage() {
  const [includeArchived, setIncludeArchived] = React.useState(false);
  const query = useQuery({
    queryKey: ['projects', { includeArchived }],
    queryFn: () => api.projects.list({ includeArchived }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Group URLs by campaign, client or content type.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIncludeArchived((value) => !value)}
            aria-pressed={includeArchived}
          >
            {includeArchived ? 'Hide archived' : 'Show archived'}
          </Button>
          <CreateProjectDialog />
        </div>
      </div>

      {query.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : query.isError ? (
        <Card>
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        </Card>
      ) : query.data && query.data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description="Create your first project, then paste or upload the URLs you want discovered."
            action={<CreateProjectDialog />}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {query.data?.items.map((project) => (
            <Card key={project.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="break-anywhere">
                    <Link href={`/projects/${project.id}`} className="hover:underline">
                      {project.name}
                    </Link>
                  </CardTitle>
                  {project.status === 'ARCHIVED' ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs">
                      Archived
                    </span>
                  ) : null}
                </div>
                <CardDescription className="line-clamp-2">
                  {project.description || 'No description'}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <Stat label="URLs" value={project.stats.totalUrls} />
                  <Stat label="Confirmed" value={project.stats.indexedConfirmed} />
                  <Stat label="Pending" value={project.stats.pending} />
                  <Stat label="Failed" value={project.stats.failed} />
                </dl>
                <div className="flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                  <span>Created {relativeTime(project.createdAt)}</span>
                  <Link href={`/projects/${project.id}`} className="text-primary hover:underline">
                    Open
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{formatNumber(value)}</dd>
    </div>
  );
}
