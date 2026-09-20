'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldError,
  Input,
  Label,
} from '@/components/ui/core';
import { api, ApiError } from '@/lib/api';

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const reset = useMutation({
    mutationFn: () => api.auth.resetPassword({ token, password }),
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Could not reset the password.'),
  });

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reset link missing</CardTitle>
          <CardDescription>
            Open the link from your email, or request a new one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>All existing sessions will be signed out.</CardDescription>
      </CardHeader>
      <CardContent>
        {reset.isSuccess ? (
          <div className="space-y-4">
            <p className="rounded-md bg-success/10 px-3 py-3 text-sm text-success">
              Password updated. You can sign in now.
            </p>
            <Button asChild className="w-full">
              <Link href="/login">Go to sign in</Link>
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              reset.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                At least 10 characters, including a letter and a number.
              </p>
              <FieldError message={error ?? undefined} />
            </div>
            <Button type="submit" className="w-full" loading={reset.isPending}>
              Update password
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={<div className="skeleton h-64 w-full" />}>
      <ResetPasswordForm />
    </React.Suspense>
  );
}
