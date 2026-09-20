'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/core';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { StatusBadge } from '@/components/status-badge';
import { formatDateTime } from '@/lib/utils';

export default function UrlDetailPage() {
  const params = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['url', params.id],
    queryFn: () => api.urls.get(params.id),
    refetchInterval: 15_000,
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Card>
    );
  }

  const url = query.data?.url;
  if (!url) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/urls">
            <ArrowLeft className="h-4 w-4" />
            Back to URLs
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-anywhere text-lg font-semibold sm:text-xl">{url.normalizedUrl}</h1>
            <p className="text-sm text-muted-foreground">
              Project:{' '}
              <Link href={`/projects/${url.projectId}`} className="text-primary hover:underline">
                {url.projectName ?? url.projectId}
              </Link>{' '}
              · submitted {formatDateTime(url.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={url.overallStatus} />
            <Button asChild variant="outline" size="icon" aria-label="Open the URL in a new tab">
              <a href={url.normalizedUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Validation</CardDescription>
            <CardTitle className="text-base">{url.validationStatus}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Processing</CardDescription>
            <CardTitle className="text-base">{url.processingStatus}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Verification</CardDescription>
            <CardTitle className="text-base">{url.verificationStatus}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Validation result</CardTitle>
          <CardDescription>Pre-flight checks performed before spending credits.</CardDescription>
        </CardHeader>
        <CardContent>
          {url.validation ? (
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="HTTP status" value={url.validation.httpStatus ?? '—'} />
              <Field label="Redirects" value={url.validation.redirectCount} />
              <Field
                label="robots.txt"
                value={
                  url.validation.robotsAllowed === null
                    ? 'unknown'
                    : url.validation.robotsAllowed
                      ? 'allowed'
                      : 'disallowed'
                }
              />
              <Field
                label="noindex"
                value={
                  url.validation.noindexDetected === null
                    ? 'unknown'
                    : url.validation.noindexDetected
                      ? 'detected'
                      : 'not detected'
                }
              />
              <Field label="Content type" value={url.validation.contentType ?? '—'} />
              <Field label="Checked" value={formatDateTime(url.validation.checkedAt)} />
              <Field label="Final URL" value={url.validation.finalUrl ?? '—'} wide />
              <Field label="Canonical" value={url.validation.canonicalUrl ?? '—'} wide />
              {url.validation.errorMessage ? (
                <Field label="Error" value={url.validation.errorMessage} wide />
              ) : null}
            </dl>
          ) : (
            <EmptyState title="Not validated yet" description="Validation runs moments after submission." />
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Processing attempts</CardTitle>
          <CardDescription>
            Every provider attempt, including failures and the provider reference.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {url.attempts.length === 0 ? (
            <EmptyState title="No attempts yet" description="The URL has not reached a provider." />
          ) : (
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {url.attempts.map((attempt) => (
                    <TableRow key={attempt.id}>
                      <TableCell>{attempt.attemptNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{attempt.providerKey}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            attempt.status === 'SUCCEEDED'
                              ? 'success'
                              : attempt.status === 'FAILED'
                                ? 'destructive'
                                : 'secondary'
                          }
                        >
                          {attempt.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate text-xs">
                        {attempt.providerReference ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {attempt.completedAt ? formatDateTime(attempt.completedAt) : '—'}
                      </TableCell>
                      <TableCell className="max-w-[16rem] break-anywhere text-xs text-muted-foreground">
                        {attempt.errorMessage ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Index check history</CardTitle>
          <CardDescription>
            Each check records the method, its confidence and what it cannot prove.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {url.indexChecks.length === 0 ? (
            <EmptyState
              title="No index checks yet"
              description="The first check runs after the discovery stage completes."
            />
          ) : (
            <ul className="divide-y">
              {url.indexChecks.map((check) => (
                <li key={check.id} className="space-y-1 px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={check.status === 'INDEXED_CONFIRMED' ? 'success' : 'warning'}>
                      {check.status === 'INDEXED_CONFIRMED'
                        ? 'Indexed (confirmed)'
                        : check.status === 'ERROR'
                          ? 'Check error'
                          : 'Not confirmed indexed'}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {check.engine} · {check.method} · confidence{' '}
                      {Math.round(check.confidence * 100)}%
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(check.checkedAt)}
                    </span>
                  </div>
                  {check.limitations ? (
                    <p className="text-xs text-muted-foreground">{check.limitations}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field label="Credits charged" value={url.creditsCharged} />
            <Field label="Refunded" value={url.refunded ? 'yes' : 'no'} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-anywhere text-sm">{value}</dd>
    </div>
  );
}
