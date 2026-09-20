'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/core';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { StatCard } from '@/components/metrics';
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/utils';

function BillingView() {
  const queryClient = useQueryClient();

  const balanceQuery = useQuery({ queryKey: ['credits'], queryFn: () => api.credits.balance() });
  const packagesQuery = useQuery({ queryKey: ['packages'], queryFn: () => api.billing.packages() });
  const transactionsQuery = useQuery({
    queryKey: ['credit-transactions'],
    queryFn: () => api.credits.transactions(),
  });
  const paymentsQuery = useQuery({ queryKey: ['payments'], queryFn: () => api.billing.payments() });

  const checkout = useMutation({
    mutationFn: (packageId: string) => api.billing.checkout(packageId),
    onSuccess: ({ checkoutUrl }) => {
      // Mock driver returns an in-app page; a real provider returns its own.
      window.location.href = checkoutUrl;
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not start checkout.'),
  });

  React.useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('status');
    if (status === 'success') {
      toast.success('Payment confirmed. Credits are added once the webhook is processed.');
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    } else if (status === 'cancelled') {
      toast.info('Checkout cancelled. No charge was made.');
    }
  }, [queryClient]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Credits pay for URL processing. One credit covers one URL.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        <StatCard
          label="Available credits"
          value={balanceQuery.data?.balance ?? 0}
          icon={Coins}
        />
        <StatCard
          label="Lifetime spent"
          value={balanceQuery.data?.lifetimeSpent ?? 0}
          icon={CreditCard}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Credit packages</CardTitle>
          <CardDescription>
            Credits for invalid, blocked or failed URLs are refunded automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {packagesQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton h-36" />
              ))}
            </div>
          ) : packagesQuery.data?.items.length === 0 ? (
            <EmptyState title="No packages configured" description="An administrator can add credit packages." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {packagesQuery.data?.items.map((pkg) => (
                <div key={pkg.id} className="flex flex-col rounded-lg border p-4">
                  <p className="text-sm font-medium">{pkg.name}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {formatNumber(pkg.credits)}
                  </p>
                  <p className="text-xs text-muted-foreground">credits</p>
                  <p className="mt-3 text-lg font-semibold">
                    {formatCurrency(pkg.priceCents, pkg.currency)}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    loading={checkout.isPending && checkout.variables === pkg.id}
                    onClick={() => checkout.mutate(pkg.id)}
                  >
                    Buy credits
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Credit ledger</CardTitle>
          <CardDescription>
            Every movement is immutable and reconcilable against your balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {transactionsQuery.isLoading ? (
            <TableSkeleton rows={5} />
          ) : transactionsQuery.isError ? (
            <ErrorState
              error={transactionsQuery.error}
              onRetry={() => void transactionsQuery.refetch()}
            />
          ) : transactionsQuery.data?.items.length === 0 ? (
            <EmptyState title="No transactions yet" />
          ) : (
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactionsQuery.data?.items.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDateTime(transaction.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{transaction.type}</Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${
                          transaction.amount < 0 ? 'text-destructive' : 'text-success'
                        }`}
                      >
                        {transaction.amount > 0 ? '+' : ''}
                        {formatNumber(transaction.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {transaction.balanceAfter === null
                          ? '—'
                          : formatNumber(transaction.balanceAfter)}
                      </TableCell>
                      <TableCell className="max-w-[18rem] break-anywhere text-sm text-muted-foreground">
                        {transaction.description ?? '—'}
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
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {paymentsQuery.isLoading ? (
            <TableSkeleton rows={3} />
          ) : paymentsQuery.data?.items.length === 0 ? (
            <EmptyState title="No payments yet" />
          ) : (
            <ul className="divide-y">
              {paymentsQuery.data?.items.map((payment) => (
                <li
                  key={payment.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {payment.packageName ?? 'Credits'} · {formatNumber(payment.credits)} credits
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(payment.createdAt)} ·{' '}
                      {formatCurrency(payment.amountCents, payment.currency)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        payment.status === 'SUCCEEDED'
                          ? 'success'
                          : payment.status === 'FAILED'
                            ? 'destructive'
                            : 'secondary'
                      }
                    >
                      {payment.status}
                    </Badge>
                    {payment.checkoutUrl ? (
                      <Button asChild size="sm" variant="outline">
                        <a href={payment.checkoutUrl}>Resume checkout</a>
                      </Button>
                    ) : null}
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

export default function BillingPage() {
  return (
    <React.Suspense fallback={<div className="skeleton h-96 w-full" />}>
      <BillingView />
    </React.Suspense>
  );
}
