'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/core';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { api } from '@/lib/api';

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const verify = useMutation({ mutationFn: () => api.auth.verifyEmail({ token }) });
  const trigger = verify.mutate;

  React.useEffect(() => {
    if (token) trigger();
  }, [token, trigger]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email verification</CardTitle>
        <CardDescription>Confirming the address on your account.</CardDescription>
      </CardHeader>
      <CardContent>
        {!token ? (
          <p className="text-sm text-muted-foreground">
            This page needs a verification token. Open the link from your email.
          </p>
        ) : verify.isPending ? (
          <LoadingState label="Verifying…" />
        ) : verify.isError ? (
          <ErrorState error={verify.error} onRetry={() => verify.mutate()} title="Verification failed" />
        ) : (
          <p className="rounded-md bg-success/10 px-3 py-3 text-sm text-success">
            Your email address is confirmed.
          </p>
        )}
        <Button asChild className="mt-4 w-full">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={<div className="skeleton h-64 w-full" />}>
      <VerifyEmail />
    </React.Suspense>
  );
}
