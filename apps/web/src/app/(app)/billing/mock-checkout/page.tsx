'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/core';
import { formatCurrency, formatNumber } from '@/lib/utils';

/**
 * Local stand-in for a hosted payment page.
 *
 * Confirming here asks the API to emit a correctly signed webhook, so the same
 * verification and idempotency path runs as with a real provider. No card
 * details are collected or accepted anywhere in this flow.
 */
function MockCheckout() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const paymentId = params.get('payment') ?? '';
  const credits = Number(params.get('credits') ?? 0);
  const amount = Number(params.get('amount') ?? 0);

  const confirm = useMutation({
    mutationFn: () => api.billing.mockConfirm(paymentId),
    onSuccess: (result) => {
      toast.success(
        result.creditsAdded > 0
          ? `${formatNumber(result.creditsAdded)} credits added.`
          : 'Payment already processed — no duplicate credit was granted.',
      );
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
      void queryClient.invalidateQueries({ queryKey: ['credit-transactions'] });
      router.push('/billing?status=success');
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not confirm the payment.'),
  });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Development checkout</CardTitle>
          <CardDescription>
            PAYMENT_DRIVER is set to “mock”, so this page replaces the payment provider. No money
            moves and no card details are handled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Credits</dt>
              <dd className="font-medium">{formatNumber(credits)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="font-medium">{formatCurrency(amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Payment ID</dt>
              <dd className="break-anywhere font-mono text-xs">{paymentId || '—'}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1"
              disabled={!paymentId}
              loading={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              Confirm payment
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => router.push('/billing?status=cancelled')}
            >
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Tip: confirming twice is safe — the webhook is idempotent and will not double-credit.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MockCheckoutPage() {
  return (
    <React.Suspense fallback={<div className="skeleton h-64 w-full" />}>
      <MockCheckout />
    </React.Suspense>
  );
}
