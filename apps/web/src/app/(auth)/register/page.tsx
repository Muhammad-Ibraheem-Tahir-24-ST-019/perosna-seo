'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { AlertCircle, ArrowRight, Check } from 'lucide-react';
import { Button, FieldError, Input, Label } from '@/components/ui/core';
import { api, ApiError } from '@/lib/api';
import { sessionKey } from '@/hooks/use-session';
import { cn } from '@/lib/utils';

const schema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.string().email('Enter a valid email address.'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
      message: 'Include at least one letter and one number.',
    }),
});

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const password = watch('password') ?? '';
  const rules = [
    { label: 'At least 10 characters', met: password.length >= 10 },
    { label: 'A letter and a number', met: /[a-zA-Z]/.test(password) && /[0-9]/.test(password) },
  ];

  const signUp = useMutation({
    mutationFn: (values: FormValues) => api.auth.register(values),
    onSuccess: ({ user }) => {
      queryClient.setQueryData(sessionKey, user);
      router.replace('/dashboard');
      router.refresh();
    },
    onError: (error: unknown) => {
      setFormError(
        error instanceof ApiError ? error.message : 'Registration failed. Please try again.',
      );
    },
  });

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">
          Create your account
        </h1>
        <p className="text-sm text-muted-foreground">
          Start with welcome credits — no card required.
        </p>
      </header>

      <form
        className="space-y-5"
        noValidate
        onSubmit={handleSubmit((values) => {
          setFormError(null);
          signUp.mutate(values);
        })}
      >
        <div className="space-y-2">
          <Label htmlFor="name">
            Name <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="name" autoComplete="name" placeholder="Alex Carter" {...register('name')} />
          <FieldError message={errors.name?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={Boolean(errors.email)}
            {...register('email')}
          />
          <FieldError message={errors.email?.message} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••"
            aria-invalid={Boolean(errors.password)}
            {...register('password')}
          />
          <FieldError message={errors.password?.message} />
          <ul className="space-y-1 pt-1">
            {rules.map((rule) => (
              <li
                key={rule.label}
                className={cn(
                  'flex items-center gap-2 text-xs transition-colors',
                  rule.met ? 'text-success' : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'flex h-3.5 w-3.5 items-center justify-center rounded-full border',
                    rule.met ? 'border-success bg-success/15' : 'border-muted-foreground/40',
                  )}
                >
                  {rule.met ? <Check className="h-2.5 w-2.5" aria-hidden /> : null}
                </span>
                {rule.label}
              </li>
            ))}
          </ul>
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

        <Button type="submit" size="lg" className="w-full" loading={signUp.isPending}>
          Create account
          {!signUp.isPending ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
