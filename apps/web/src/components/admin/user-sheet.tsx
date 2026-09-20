'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Coins,
  KeyRound,
  LogIn,
  Mail,
  ShieldCheck,
  Trash2,
  UserCheck,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Input, Label, Textarea } from '@/components/ui/core';
import {
  Dialog,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SheetContent,
} from '@/components/ui/overlay';
import { api, ApiError, type AdminUserRow } from '@/lib/api';
import { useSession } from '@/hooks/use-session';
import { formatDateTime, formatNumber } from '@/lib/utils';

/**
 * Everything an admin can do to one account, in a single off-canvas panel.
 *
 * Grouped by consequence rather than by API endpoint: routine things first,
 * then account access, then the destructive controls at the bottom behind an
 * explicit confirmation. Every action that changes money, access or identity
 * requires a reason, because the audit row is useless without one.
 */
export function AdminUserSheet({
  user,
  onClose,
}: {
  user: AdminUserRow | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(user)} onOpenChange={(open) => !open && onClose()}>
      {user ? (
        <SheetContent
          side="right"
          closeLabel="Close user panel"
          data-testid="admin-user-sheet"
          className="w-[min(34rem,100vw)] gap-0 p-0"
        >
          <DialogTitle className="sr-only">Manage {user.email}</DialogTitle>
          <UserPanel user={user} onClose={onClose} />
        </SheetContent>
      ) : null}
    </Dialog>
  );
}

function UserPanel({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: actor } = useSession();
  const isSuperAdmin = actor?.role === 'SUPER_ADMIN';

  const [reason, setReason] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirming, setConfirming] = React.useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['admin-user', user.id],
    queryFn: () => api.admin.user(user.id),
  });
  const tools = useQuery({
    queryKey: ['admin-tools'],
    queryFn: () => api.admin.tools(),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    void queryClient.invalidateQueries({ queryKey: ['admin-user', user.id] });
  };

  const fail = (error: unknown, fallback: string) =>
    toast.error(error instanceof ApiError ? error.message : fallback);

  const requireReason = (): boolean => {
    if (reason.trim().length >= 3) return true;
    toast.error('Enter a reason first — it is written to the audit log.');
    return false;
  };

  const adjustCredits = useMutation({
    mutationFn: () => api.admin.adjustCredits(user.id, Number(amount), reason),
    onSuccess: (result) => {
      toast.success(`Balance is now ${formatNumber(result.balance)} credits.`);
      setAmount('');
      setReason('');
      refresh();
    },
    onError: (error) => fail(error, 'The adjustment failed.'),
  });

  const setRole = useMutation({
    mutationFn: (role: string) => api.admin.setRole(user.id, role, reason),
    onSuccess: (result) => {
      toast.success(`Role changed to ${result.role}.`);
      refresh();
    },
    onError: (error) => fail(error, 'Could not change the role.'),
  });

  const suspend = useMutation({
    mutationFn: (suspended: boolean) => api.admin.setSuspension(user.id, suspended, reason),
    onSuccess: () => {
      toast.success('Account status updated.');
      setReason('');
      refresh();
    },
    onError: (error) => fail(error, 'Could not update the account.'),
  });

  const sendReset = useMutation({
    mutationFn: () => api.admin.forcePasswordReset(user.id, reason),
    onSuccess: () => {
      toast.success('Reset link sent and existing sessions revoked.');
      setReason('');
    },
    onError: (error) => fail(error, 'Could not send the reset link.'),
  });

  const setPassword = useMutation({
    mutationFn: () => api.admin.setPassword(user.id, newPassword, reason),
    onSuccess: (result) => {
      toast.success(
        `Password set. ${result.sessionsRevoked} session(s) signed out. Give the new password to the user over a trusted channel.`,
      );
      setNewPassword('');
      setReason('');
      setConfirming(null);
      refresh();
    },
    onError: (error) => fail(error, 'Could not set the password.'),
  });

  const revokeSessions = useMutation({
    mutationFn: () => api.admin.revokeSessions(user.id, reason),
    onSuccess: (result) => {
      toast.success(`${result.sessionsRevoked} session(s) signed out.`);
      refresh();
    },
    onError: (error) => fail(error, 'Could not revoke the sessions.'),
  });

  const impersonate = useMutation({
    mutationFn: () => api.admin.impersonate(user.id),
    onSuccess: () => {
      // The session cookie has been swapped: everything cached belongs to the
      // previous identity and must go.
      queryClient.clear();
      onClose();
      router.replace('/dashboard');
      router.refresh();
    },
    onError: (error) => fail(error, 'Could not start the session.'),
  });

  const grantTool = useMutation({
    mutationFn: (toolId: string) => api.admin.grantToolAccess(user.id, { toolId }),
    onSuccess: () => {
      toast.success('Tool access granted.');
      refresh();
    },
    onError: (error) => fail(error, 'Could not grant access.'),
  });

  const busy =
    adjustCredits.isPending ||
    setRole.isPending ||
    suspend.isPending ||
    setPassword.isPending ||
    revokeSessions.isPending ||
    impersonate.isPending;

  const suspended = (detail.data?.status ?? user.status) === 'SUSPENDED';

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-5 py-4">
        <p className="break-anywhere pr-8 text-sm font-semibold">{user.email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{detail.data?.role ?? user.role}</Badge>
          <Badge variant={suspended ? 'destructive' : 'success'}>
            {suspended ? 'Suspended' : 'Active'}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Joined {formatDateTime(user.createdAt)}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="grid grid-cols-3 gap-px border-b bg-border">
          <Figure label="Credits" value={formatNumber(detail.data?.wallet.balance ?? user.credits)} />
          <Figure label="URLs" value={formatNumber(user.urls)} />
          <Figure label="Projects" value={formatNumber(user.projects)} />
        </div>

        {suspended && detail.data?.suspendedReason ? (
          <p className="border-b bg-destructive/5 px-5 py-3 text-sm text-destructive">
            Suspended: {detail.data.suspendedReason}
          </p>
        ) : null}

        {/*
          One reason field serves every action below. It is at the top because
          it is required, not optional, and burying it invites blank reasons.
        */}
        <Section title="Reason" description="Required. Written to the audit log with your name.">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Goodwill credit after the provider outage on the 14th"
            rows={2}
            aria-label="Reason for this action"
          />
        </Section>

        <Section title="Credits" description="Positive adds, negative removes.">
          <div className="flex gap-2">
            <Input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="e.g. 100 or -50"
              aria-label="Credit adjustment amount"
            />
            <Button
              variant="outline"
              disabled={busy || !amount || Number(amount) === 0}
              onClick={() => requireReason() && adjustCredits.mutate()}
              loading={adjustCredits.isPending}
            >
              <Coins className="h-4 w-4" aria-hidden />
              Apply
            </Button>
          </div>
        </Section>

        <Section
          title="Sign in as this user"
          description="Opens a one-hour session as them. A banner stays visible the whole time and every action stays attributed to you."
        >
          <Button
            variant="outline"
            className="w-full"
            disabled={busy || user.role === 'SUPER_ADMIN' || (!isSuperAdmin && user.role === 'ADMIN')}
            loading={impersonate.isPending}
            onClick={() => impersonate.mutate()}
          >
            <LogIn className="h-4 w-4" aria-hidden />
            Sign in as {user.email}
          </Button>
          {user.role === 'SUPER_ADMIN' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Super admin accounts cannot be impersonated.
            </p>
          ) : !isSuperAdmin && user.role === 'ADMIN' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Only a super admin can impersonate another administrator.
            </p>
          ) : null}
        </Section>

        <Section title="Password" description="Two ways to hand the account back.">
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            loading={sendReset.isPending}
            onClick={() => requireReason() && sendReset.mutate()}
          >
            <Mail className="h-4 w-4" aria-hidden />
            Email a reset link
          </Button>

          <div className="mt-3 rounded-md border p-3">
            <Label htmlFor="admin-new-password" className="text-xs">
              Or set one directly
            </Label>
            <Input
              id="admin-new-password"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 10 characters"
              className="mt-1.5"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Signs out every session. You will need to pass the new password to the user yourself
              — it is never emailed and never shown again.
            </p>
            {confirming === 'password' ? (
              <div className="mt-2.5 flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1"
                  loading={setPassword.isPending}
                  onClick={() => setPassword.mutate()}
                >
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="mt-2.5 w-full"
                disabled={busy || newPassword.length < 10}
                onClick={() => requireReason() && setConfirming('password')}
              >
                <KeyRound className="h-4 w-4" aria-hidden />
                Set password
              </Button>
            )}
          </div>

          <Button
            variant="outline"
            className="mt-3 w-full"
            disabled={busy}
            loading={revokeSessions.isPending}
            onClick={() => revokeSessions.mutate()}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Sign out all sessions
          </Button>
        </Section>

        {tools.data && tools.data.items.length > 0 ? (
          <Section
            title="Tool access"
            description="Grants access to tools that require an account."
          >
            <Select onValueChange={(value) => grantTool.mutate(value)}>
              <SelectTrigger aria-label="Grant access to a tool">
                <SelectValue placeholder="Grant access to…" />
              </SelectTrigger>
              <SelectContent>
                {tools.data.items
                  .filter((tool) => tool.requiresAuth)
                  .map((tool) => (
                    <SelectItem key={tool.id} value={tool.id}>
                      {tool.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {tools.data.items.every((tool) => !tool.requiresAuth) ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wrench className="h-3 w-3" aria-hidden />
                No tools currently require an account, so no grants are needed.
              </p>
            ) : null}
          </Section>
        ) : null}

        {isSuperAdmin ? (
          <Section title="Role" description="Super admin only. Changes take effect immediately.">
            <Select
              defaultValue={detail.data?.role ?? user.role}
              onValueChange={(value) => requireReason() && setRole.mutate(value)}
            >
              <SelectTrigger aria-label="Account role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USER">User</SelectItem>
                <SelectItem value="AGENCY">Agency</SelectItem>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="SUPER_ADMIN">Super admin</SelectItem>
              </SelectContent>
            </Select>
          </Section>
        ) : null}

        <Section
          title={suspended ? 'Restore access' : 'Block access'}
          description={
            suspended
              ? 'Lets the account sign in again.'
              : 'Signs the user out and blocks sign-in until it is lifted.'
          }
        >
          {suspended ? (
            <Button
              variant="outline"
              className="w-full"
              disabled={busy}
              loading={suspend.isPending}
              onClick={() => requireReason() && suspend.mutate(false)}
            >
              <UserCheck className="h-4 w-4" aria-hidden />
              Unblock account
            </Button>
          ) : confirming === 'suspend' ? (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1"
                loading={suspend.isPending}
                onClick={() => {
                  setConfirming(null);
                  suspend.mutate(true);
                }}
              >
                Yes, block this account
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="destructive"
              className="w-full"
              disabled={busy}
              onClick={() => requireReason() && setConfirming('suspend')}
            >
              <Ban className="h-4 w-4" aria-hidden />
              Block account
            </Button>
          )}
        </Section>

        {detail.data?.wallet.reconciliation &&
        !detail.data.wallet.reconciliation.consistent ? (
          <div className="mx-5 mb-5 flex gap-2.5 rounded-md border border-warning/40 bg-warning/5 p-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p className="text-xs leading-relaxed">
              This wallet&apos;s cached balance does not match its ledger. Investigate before
              adjusting credits.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b px-5 py-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {description ? (
        <p className="mb-2.5 mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : (
        <div className="mb-2.5" />
      )}
      {children}
    </section>
  );
}
