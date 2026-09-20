'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
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
  Input,
  Label,
} from '@/components/ui/core';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/overlay';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { formatDateTime } from '@/lib/utils';

export default function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [secret, setSecret] = React.useState<string | null>(null);

  const keysQuery = useQuery({ queryKey: ['api-keys'], queryFn: () => api.apiKeys.list() });

  const create = useMutation({
    mutationFn: () => api.apiKeys.create(name),
    onSuccess: (data) => {
      setSecret(data.secret);
      setName('');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not create the key.'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.apiKeys.revoke(id),
    onSuccess: () => {
      toast.success('API key revoked.');
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not revoke the key.'),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">API</h1>
          <p className="text-sm text-muted-foreground">
            Automate submissions and status polling from your own systems.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New API key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                The secret is shown once and stored only as a hash.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  required
                  maxLength={60}
                  placeholder="CI pipeline"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={create.isPending}>
                  Create key
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {secret ? (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>Copy your API key now</CardTitle>
            <CardDescription>
              This is the only time the full secret is displayed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <code className="block break-anywhere rounded-md bg-muted px-3 py-2 font-mono text-sm">
              {secret}
            </code>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(secret);
                  toast.success('Copied to clipboard.');
                }}
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSecret(null)}>
                I have saved it
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Your keys</CardTitle>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {keysQuery.isLoading ? (
            <TableSkeleton rows={3} />
          ) : keysQuery.isError ? (
            <ErrorState error={keysQuery.error} onRetry={() => void keysQuery.refetch()} />
          ) : keysQuery.data?.items.length === 0 ? (
            <EmptyState
              icon={KeyRound}
              title="No API keys yet"
              description="Create a key to submit URLs from your own application."
            />
          ) : (
            <ul className="divide-y">
              {keysQuery.data?.items.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{key.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{key.keyPrefix}…</p>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDateTime(key.createdAt)} · last used{' '}
                      {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'never'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {key.revokedAt ? (
                      <Badge variant="outline">Revoked</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={revoke.isPending && revoke.variables === key.id}
                        onClick={() => revoke.mutate(key.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Revoke
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick start</CardTitle>
          <CardDescription>
            Authenticate with a bearer token. Send an Idempotency-Key so retries never double-charge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{EXAMPLE}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}

const EXAMPLE = `# Create a project
curl -X POST https://your-host/api/v1/projects \\
  -H "Authorization: Bearer ip_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"name":"API campaign"}'

# Submit URLs (idempotent)
curl -X POST https://your-host/api/v1/projects/PROJECT_ID/urls \\
  -H "Authorization: Bearer ip_live_..." \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 2f8c-unique-key" \\
  -d '{"urls":["https://example.com/a","https://example.com/b"]}'

# Poll one URL
curl https://your-host/api/v1/jobs/URL_ID \\
  -H "Authorization: Bearer ip_live_..."`;
