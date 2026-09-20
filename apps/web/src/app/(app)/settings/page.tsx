'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  FieldError,
  Input,
  Label,
} from '@/components/ui/core';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useSession } from '@/hooks/use-session';
import { formatDateTime } from '@/lib/utils';

export default function SettingsPage() {
  const { data: user } = useSession();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState('');
  React.useEffect(() => {
    if (user?.name) setName(user.name);
  }, [user?.name]);

  const updateProfile = useMutation({
    mutationFn: () => api.auth.updateProfile({ name: name.trim() || null }),
    onSuccess: () => {
      toast.success('Profile updated.');
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Update failed.'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground">Profile, security and active sessions.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your email address is used for sign-in and receipts.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              updateProfile.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user?.email ?? ''} readOnly disabled />
              <p className="text-xs text-muted-foreground">
                {user?.emailVerified ? 'Email verified.' : 'Email not verified yet.'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button type="submit" loading={updateProfile.isPending}>
              Save profile
            </Button>
          </form>
        </CardContent>
      </Card>

      <ChangePasswordCard />
      <SessionsCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword, newPassword }),
    onSuccess: (data) => {
      toast.success(data.message);
      setCurrentPassword('');
      setNewPassword('');
      // Changing the password revokes every session, including this one.
      window.location.href = '/login';
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.message : 'Could not change the password.'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Changing your password signs out every device, including this one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            change.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              At least 10 characters, including a letter and a number.
            </p>
          </div>
          <FieldError message={error ?? undefined} />
          <Button type="submit" loading={change.isPending}>
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['sessions'], queryFn: () => api.auth.sessions() });

  const revoke = useMutation({
    mutationFn: (id: string) => api.auth.revokeSession(id),
    onSuccess: () => {
      toast.success('Session revoked.');
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>
          Only metadata is shown — session tokens are never returned by the API.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        {query.isLoading ? (
          <TableSkeleton rows={3} />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <ul className="divide-y">
            {query.data?.items.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6"
              >
                <div className="min-w-0">
                  <p className="break-anywhere text-sm">{session.userAgent ?? 'Unknown device'}</p>
                  <p className="text-xs text-muted-foreground">
                    {session.ipAddress ?? 'unknown IP'} · last seen{' '}
                    {formatDateTime(session.lastSeenAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">expires {formatDateTime(session.expiresAt)}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={revoke.isPending && revoke.variables === session.id}
                    onClick={() => revoke.mutate(session.id)}
                  >
                    Revoke
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
