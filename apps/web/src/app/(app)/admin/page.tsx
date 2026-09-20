'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError, type AdminUserRow } from '@/lib/api';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/core';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { StatCard } from '@/components/metrics';
import { AdminUserSheet } from '@/components/admin/user-sheet';
import { AdminToolsTab } from '@/components/admin/tools-tab';
import { isAdmin, useSession } from '@/hooks/use-session';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';

export default function AdminPage() {
  const { data: user, isLoading } = useSession();

  if (isLoading) return <div className="skeleton h-96 w-full" />;

  // The API enforces this too; the UI check only avoids a pointless request.
  if (!isAdmin(user)) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="Administrator access required"
          description="Your account does not have permission to view the admin panel."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Platform health, customer accounts, queues and provider configuration.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="queues">Queues</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="packages">Packages</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="health">System health</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="users">
          <UsersTab />
        </TabsContent>
        <TabsContent value="tools">
          <AdminToolsTab />
        </TabsContent>
        <TabsContent value="queues">
          <QueuesTab />
        </TabsContent>
        <TabsContent value="providers">
          <ProvidersTab />
        </TabsContent>
        <TabsContent value="packages">
          <PackagesTab />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
        <TabsContent value="health">
          <HealthTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverviewTab() {
  const query = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api.admin.overview(),
    refetchInterval: 30_000,
  });

  if (query.isLoading) return <div className="skeleton h-64 w-full" />;
  if (query.isError) {
    return (
      <Card>
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </Card>
    );
  }
  const data = query.data;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Users" value={data.users.total} />
        <StatCard label="Projects" value={data.projects} />
        <StatCard label="URLs processed" value={data.urls.total} />
        <StatCard label="Failed URLs" value={data.urls.failed} tone="destructive" />
        <StatCard label="Credits outstanding" value={data.credits.outstanding} />
        <StatCard label="Credits consumed" value={data.credits.lifetimeSpent} />
        <StatCard label="Payments" value={data.payments.count} />
        <StatCard
          label="Gross revenue"
          value={formatCurrency(data.payments.grossCents)}
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Queue depth</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          <QueueTable rows={data.queues} />
        </CardContent>
      </Card>
    </div>
  );
}

function UsersTab() {
  const [search, setSearch] = React.useState('');
  const [selected, setSelected] = React.useState<AdminUserRow | null>(null);
  const query = useQuery({
    queryKey: ['admin-users', search],
    queryFn: () => api.admin.users({ search: search || undefined, limit: 50 }),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Users</CardTitle>
            <CardDescription>{formatNumber(query.data?.total ?? 0)} accounts</CardDescription>
          </div>
          <Input
            placeholder="Search by email…"
            className="sm:w-64"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search users"
          />
        </div>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {query.isLoading ? (
          <TableSkeleton />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : query.data?.items.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">URLs</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Manage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data?.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="break-anywhere text-sm">{row.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.status === 'ACTIVE' ? 'success' : 'destructive'}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.credits)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.urls)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
                        Manage
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </CardContent>

      <AdminUserSheet user={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

function QueuesTab() {
  const queryClient = useQueryClient();
  const queues = useQuery({
    queryKey: ['admin-queues'],
    queryFn: () => api.admin.queues(),
    refetchInterval: 10_000,
  });
  const failed = useQuery({ queryKey: ['admin-failed'], queryFn: () => api.admin.failedJobs() });

  const retry = useMutation({
    mutationFn: (id: string) => api.admin.retryJob(id),
    onSuccess: () => {
      toast.success('Job re-queued.');
      void queryClient.invalidateQueries({ queryKey: ['admin-failed'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Retry failed.'),
  });

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Queues</CardTitle>
          <CardDescription>Live depth per queue.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {queues.isLoading ? <TableSkeleton rows={4} /> : <QueueTable rows={queues.data?.items ?? []} />}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Failed jobs</CardTitle>
          <CardDescription>Inspect the error, then retry when it is safe.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {failed.isLoading ? (
            <TableSkeleton rows={3} />
          ) : failed.data?.items.length === 0 ? (
            <EmptyState title="No failed jobs" description="Every queued job completed." />
          ) : (
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Queue</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failed.data?.items.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="whitespace-nowrap">{job.queue}</TableCell>
                      <TableCell className="font-mono text-xs">{job.entityId}</TableCell>
                      <TableCell>{job.attempts}</TableCell>
                      <TableCell className="max-w-[20rem] break-anywhere text-xs text-muted-foreground">
                        {job.error ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(job.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          loading={retry.isPending && retry.variables === job.id}
                          onClick={() => retry.mutate(job.id)}
                        >
                          <RefreshCw className="h-4 w-4" />
                          Retry
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function QueueTable({ rows }: { rows: Array<{ name: string; waiting: number; active: number; delayed: number; completed: number; failed: number; paused: boolean }> }) {
  if (rows.length === 0) {
    return <EmptyState title="Queue metrics unavailable" description="Redis may be unreachable." />;
  }
  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Queue</TableHead>
            <TableHead className="text-right">Waiting</TableHead>
            <TableHead className="text-right">Active</TableHead>
            <TableHead className="text-right">Delayed</TableHead>
            <TableHead className="text-right">Completed</TableHead>
            <TableHead className="text-right">Failed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell className="whitespace-nowrap font-medium">{row.name}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.waiting)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.active)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.delayed)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.completed)}</TableCell>
              <TableCell className="text-right tabular-nums text-destructive">
                {formatNumber(row.failed)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}

function ProvidersTab() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-providers'], queryFn: () => api.admin.providers() });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.admin.updateProvider(id, { enabled }),
    onSuccess: () => {
      toast.success('Provider updated.');
      void queryClient.invalidateQueries({ queryKey: ['admin-providers'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Update failed.'),
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Discovery providers</CardTitle>
        <CardDescription>
          Routing order and availability. Provider credentials are stored encrypted and are never
          returned to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {query.isLoading ? (
          <TableSkeleton rows={3} />
        ) : query.data?.items.length === 0 ? (
          <EmptyState title="No providers configured" />
        ) : (
          <ul className="divide-y">
            {query.data?.items.map((provider) => (
              <li
                key={provider.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{provider.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {provider.key} · priority {provider.priority} · {provider.rateLimitPerMin}/min
                    {provider.healthDetail ? ` · ${provider.healthDetail}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      provider.healthStatus === 'HEALTHY'
                        ? 'success'
                        : provider.healthStatus === 'UNHEALTHY'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {provider.healthStatus}
                  </Badge>
                  <Button
                    size="sm"
                    variant={provider.enabled ? 'outline' : 'default'}
                    loading={toggle.isPending && toggle.variables?.id === provider.id}
                    onClick={() => toggle.mutate({ id: provider.id, enabled: !provider.enabled })}
                  >
                    {provider.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Credit packages: create, edit price/size, enable, and retire. */
function PackagesTab() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-packages'], queryFn: () => api.admin.packages() });
  const [draft, setDraft] = React.useState({ name: '', credits: '', price: '' });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-packages'] });
    void queryClient.invalidateQueries({ queryKey: ['packages'] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.admin.createPackage({
        name: draft.name.trim(),
        credits: Number(draft.credits),
        priceCents: Math.round(Number(draft.price) * 100),
      }),
    onSuccess: () => {
      toast.success('Package created.');
      setDraft({ name: '', credits: '', price: '' });
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create the package.'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.admin.updatePackage(id, { enabled }),
    onSuccess: () => {
      toast.success('Package updated.');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.admin.deletePackage(id),
    onSuccess: (result) => {
      toast.success(
        result.disabled
          ? 'Package has existing payments, so it was retired instead of deleted.'
          : 'Package deleted.',
      );
      invalidate();
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not remove the package.'),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>New credit package</CardTitle>
          <CardDescription>What customers can buy on the billing page.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="pkg-name">Name</Label>
              <Input
                id="pkg-name"
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-credits">Credits</Label>
              <Input
                id="pkg-credits"
                type="number"
                min={1}
                required
                value={draft.credits}
                onChange={(event) => setDraft({ ...draft, credits: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-price">Price (USD)</Label>
              <Input
                id="pkg-price"
                type="number"
                min={0}
                step="0.01"
                required
                value={draft.price}
                onChange={(event) => setDraft({ ...draft, price: event.target.value })}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full" loading={create.isPending}>
                Create
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Packages</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {query.isLoading ? (
            <TableSkeleton rows={3} />
          ) : query.data?.items.length === 0 ? (
            <EmptyState title="No packages yet" description="Create one above." />
          ) : (
            <ul className="divide-y">
              {query.data?.items.map((pkg) => (
                <li
                  key={pkg.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
                >
                  <div>
                    <p className="text-sm font-medium">{pkg.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatNumber(pkg.credits)} credits ·{' '}
                      {formatCurrency(pkg.priceCents, pkg.currency)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={pkg.enabled ? 'success' : 'secondary'}>
                      {pkg.enabled ? 'On sale' : 'Hidden'}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={toggle.isPending && toggle.variables?.id === pkg.id}
                      onClick={() => toggle.mutate({ id: pkg.id, enabled: !pkg.enabled })}
                    >
                      {pkg.enabled ? 'Hide' : 'Publish'}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      loading={remove.isPending && remove.variables === pkg.id}
                      onClick={() => remove.mutate(pkg.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PaymentsTab() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['admin-payments'], queryFn: () => api.admin.payments() });

  const refund = useMutation({
    mutationFn: ({ id, allowPartial }: { id: string; allowPartial: boolean }) =>
      api.admin.refundPayment(id, 'Refunded by administrator', allowPartial),
    onSuccess: (result) => {
      toast.success(
        result.partial
          ? `Refunded. Only ${formatNumber(result.creditsReversed)} credits could be reclaimed.`
          : `Refunded and ${formatNumber(result.creditsReversed)} credits reclaimed.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
    },
    onError: (error: unknown) => {
      // 409 means the customer already spent the credits; offer a partial clawback.
      if (error instanceof ApiError && error.status === 409) {
        toast.error(`${error.message} Click refund again to confirm a partial clawback.`);
        return;
      }
      toast.error(error instanceof ApiError ? error.message : 'Refund failed.');
    },
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Payments</CardTitle>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {query.isLoading ? (
          <TableSkeleton rows={4} />
        ) : query.data?.items.length === 0 ? (
          <EmptyState title="No payments recorded" />
        ) : (
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data?.items.map((payment) => (
                  <TableRow key={payment.id}>
                    <TableCell className="break-anywhere text-sm">{payment.user}</TableCell>
                    <TableCell>{payment.provider}</TableCell>
                    <TableCell>
                      <Badge variant={payment.status === 'SUCCEEDED' ? 'success' : 'secondary'}>
                        {payment.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(payment.amountCents, payment.currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(payment.credits)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(payment.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      {payment.status === 'SUCCEEDED' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={refund.isPending && refund.variables?.id === payment.id}
                          onClick={() =>
                            refund.mutate({
                              id: payment.id,
                              // The first click asks; a retry accepts a partial clawback.
                              allowPartial: refund.isError && refund.variables?.id === payment.id,
                            })
                          }
                        >
                          Refund
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </CardContent>
    </Card>
  );
}

function AuditTab() {
  const query = useQuery({ queryKey: ['admin-audit'], queryFn: () => api.admin.auditLogs() });
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <CardDescription>Sensitive actions with actor and reason.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {query.isLoading ? (
          <TableSkeleton rows={5} />
        ) : query.data?.items.length === 0 ? (
          <EmptyState title="No audit entries yet" />
        ) : (
          <ul className="divide-y">
            {query.data?.items.map((log) => (
              <li key={log.id} className="px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{log.action}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {log.entityType}
                    {log.entityId ? ` · ${log.entityId}` : ''}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDateTime(log.createdAt)}
                  </span>
                </div>
                <p className="mt-1 break-anywhere text-xs text-muted-foreground">
                  {log.actor ?? 'system'}
                  {log.reason ? ` — ${log.reason}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function HealthTab() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 15_000,
  });
  const usage = useQuery({ queryKey: ['admin-api-usage'], queryFn: () => api.admin.apiUsage() });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>System health</CardTitle>
          <CardDescription>
            Status of the API process and its dependencies. No credentials are exposed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {health.isLoading ? (
            <TableSkeleton rows={3} />
          ) : health.isError ? (
            <ErrorState error={health.error} onRetry={() => void health.refetch()} />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    health.data?.status === 'ok'
                      ? 'success'
                      : health.data?.status === 'degraded'
                        ? 'warning'
                        : 'destructive'
                  }
                >
                  {health.data?.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  v{health.data?.version} · {health.data?.environment} · up{' '}
                  {formatNumber(Math.round((health.data?.uptimeSeconds ?? 0) / 60))} min
                </span>
              </div>
              <ul className="divide-y rounded-md border">
                {health.data?.checks.map((check) => (
                  <li key={check.name} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm">{check.name}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{check.detail}</span>
                      <Badge
                        variant={
                          check.status === 'ok'
                            ? 'success'
                            : check.status === 'degraded'
                              ? 'warning'
                              : 'destructive'
                        }
                      >
                        {check.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>API usage</CardTitle>
          <CardDescription>Most recent API requests across the platform.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {usage.isLoading ? (
            <TableSkeleton rows={5} />
          ) : usage.data?.recent.length === 0 ? (
            <EmptyState title="No API traffic recorded yet" />
          ) : (
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Method</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.data?.recent.slice(0, 40).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.method}</TableCell>
                      <TableCell className="break-anywhere font-mono text-xs">{row.path}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${row.statusCode >= 400 ? 'text-destructive' : ''}`}
                      >
                        {row.statusCode}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.durationMs} ms</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(row.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
