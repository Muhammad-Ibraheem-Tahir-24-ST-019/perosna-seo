'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button, FieldError, Input, Label } from '@/components/ui/core';
import { api, ApiError } from '@/lib/api';
import { sessionKey } from '@/hooks/use-session';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

type FormValues = z.infer<typeof schema>;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const login = useMutation({
    mutationFn: (values: FormValues) => api.auth.login(values),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(sessionKey, user);
      const next = params.get('next');
      router.replace(next && next.startsWith('/') ? next : '/dashboard');
      router.refresh();
    },
    onError: (error: unknown) => {
      setFormError(error instanceof ApiError ? error.message : 'Sign in failed. Please try again.');
    },
  });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to manage your submissions, credits and reports.
        </p>
      </header>

      <form
        className="space-y-5"
        noValidate
        onSubmit={handleSubmit((values) => {
          setFormError(null);
          login.mutate(values);
        })}
      >
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            autoFocus
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
          <FieldError message={errors.email?.message} />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••••"
              className="pr-11"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <FieldError message={errors.password?.message} />
        </div>

        {formError ? (
          <p
            role="alert"
            data-testid="form-error"
            className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{formError}</span>
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
          Sign in
          {!login.isPending ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New to IndexPilot?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <React.Suspense fallback={<div className="skeleton h-96 w-full" />}>
      <LoginForm />
    </React.Suspense>
  );
}
