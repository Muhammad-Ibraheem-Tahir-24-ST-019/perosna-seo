'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  TOOL_ENGINE_LABELS,
  type AdminToolInput,
  type AdminToolRow,
  type ToolEngineKey,
} from '@indexpilot/shared/client';
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
  Textarea,
} from '@/components/ui/core';
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
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { StatCard } from '@/components/metrics';
import { api, ApiError } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

/**
 * Admin surface for the public tool catalogue.
 *
 * A tool page is content plus a pointer at an engine, so adding a landing page
 * for a new keyword is an editing job rather than a deploy. The engine list is
 * fixed in code — that part is real software — but everything a search engine
 * sees is editable here.
 */
export function AdminToolsTab() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState<AdminToolRow | null>(null);
  const [creating, setCreating] = React.useState(false);

  const tools = useQuery({ queryKey: ['admin-tools'], queryFn: () => api.admin.tools() });
  const analytics = useQuery({
    queryKey: ['admin-tool-analytics'],
    queryFn: () => api.admin.toolAnalytics(30),
  });

  const seed = useMutation({
    mutationFn: () => api.admin.seedTools(),
    onSuccess: (result) => {
      toast.success(
        result.created > 0
          ? `Imported ${result.created} tool page(s) from the built-in catalogue.`
          : 'Every built-in tool page is already in the database.',
      );
      void queryClient.invalidateQueries({ queryKey: ['admin-tools'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Import failed.'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.admin.updateTool(id, { enabled }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-tools'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not update the tool.'),
  });

  return (
    <div className="space-y-4">
      {analytics.data ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StatCard label="Tool runs (30d)" value={analytics.data.totals.runs} />
          <StatCard label="Signed in" value={analytics.data.totals.signedIn} />
          <StatCard label="Anonymous" value={analytics.data.totals.anonymous} />
          <StatCard
            label="Avg duration"
            value={`${(analytics.data.totals.avgDurationMs / 1000).toFixed(1)}s`}
          />
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Public tool pages</CardTitle>
              <CardDescription>
                Each row is a route under /tools. Several can share one engine.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              {tools.data && tools.data.unseeded.length > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  loading={seed.isPending}
                  onClick={() => seed.mutate()}
                >
                  Import {tools.data.unseeded.length} built-in
                </Button>
              ) : null}
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                New tool page
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          {tools.isLoading ? (
            <TableSkeleton />
          ) : tools.isError ? (
            <ErrorState error={tools.error} onRetry={() => void tools.refetch()} />
          ) : tools.data?.items.length === 0 ? (
            <EmptyState
              title="No tool pages yet"
              description="Import the built-in catalogue to publish the starter set, or create one from scratch."
              action={
                <Button loading={seed.isPending} onClick={() => seed.mutate()}>
                  Import built-in catalogue
                </Button>
              }
            />
          ) : (
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead>Engine</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Manage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tools.data?.items.map((tool) => (
                    <TableRow key={tool.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{tool.name}</span>
                          <Link
                            href={`/tools/${tool.slug}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary hover:underline"
                          >
                            /tools/{tool.slug}
                            <ExternalLink className="h-3 w-3" aria-hidden />
                          </Link>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{TOOL_ENGINE_LABELS[tool.engine]}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={tool.enabled ? 'success' : 'secondary'}>
                            {tool.enabled ? 'Live' : 'Off'}
                          </Badge>
                          {tool.requiresAuth ? <Badge variant="warning">Account</Badge> : null}
                          {!tool.listed ? <Badge variant="secondary">Unlisted</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(tool.runs)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggle.mutate({ id: tool.id, enabled: !tool.enabled })}
                          >
                            {tool.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditing(tool)}>
                            Edit
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </CardContent>
      </Card>

      {analytics.data && analytics.data.byTool.length > 0 ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Completions by page</CardTitle>
            <CardDescription>
              Runs that finished, not pageviews — this is what says which tool to build on next.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Page</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Avg duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.data.byTool.map((row) => (
                    <TableRow key={row.slug}>
                      <TableCell className="font-mono text-xs">/tools/{row.slug}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(row.runs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(row.avgDurationMs / 1000).toFixed(1)}s
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      ) : null}

      <ToolSheet
        tool={editing}
        open={creating || Boolean(editing)}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
      />
    </div>
  );
}

const EMPTY_TOOL: AdminToolInput = {
  slug: '',
  name: '',
  engine: 'ROBOTS_TXT',
  headline: '',
  intro: '',
  metaTitle: '',
  metaDescription: '',
  enabled: true,
  requiresAuth: false,
  listed: true,
  sortOrder: 100,
};

function ToolSheet({
  tool,
  open,
  onClose,
}: {
  tool: AdminToolRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<AdminToolInput>(EMPTY_TOOL);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  // Re-seed the form whenever the panel opens on a different row.
  React.useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setForm(
      tool
        ? {
            slug: tool.slug,
            name: tool.name,
            engine: tool.engine,
            headline: tool.headline,
            intro: tool.intro,
            metaTitle: tool.metaTitle,
            metaDescription: tool.metaDescription,
            enabled: tool.enabled,
            requiresAuth: tool.requiresAuth,
            listed: tool.listed,
            sortOrder: tool.sortOrder,
          }
        : EMPTY_TOOL,
    );
  }, [open, tool]);

  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ['admin-tools'] });
    onClose();
  };
  const fail = (error: unknown, fallback: string) =>
    toast.error(error instanceof ApiError ? error.message : fallback);

  const save = useMutation({
    mutationFn: () => (tool ? api.admin.updateTool(tool.id, form) : api.admin.createTool(form)),
    onSuccess: () => done(tool ? 'Tool page updated.' : 'Tool page created.'),
    onError: (error) => fail(error, 'Could not save the tool page.'),
  });

  const remove = useMutation({
    mutationFn: () => api.admin.deleteTool(tool?.id ?? ''),
    onSuccess: () => done('Tool page deleted.'),
    onError: (error) => fail(error, 'Could not delete the tool page.'),
  });

  const set = <K extends keyof AdminToolInput>(key: K, value: AdminToolInput[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {open ? (
        <SheetContent
          side="right"
          closeLabel="Close tool panel"
          className="w-[min(34rem,100vw)] gap-0 p-0"
        >
          <DialogTitle className="sr-only">
            {tool ? `Edit ${tool.name}` : 'New tool page'}
          </DialogTitle>

          <header className="border-b px-5 py-4">
            <p className="text-sm font-semibold">{tool ? tool.name : 'New tool page'}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {tool ? `/tools/${tool.slug}` : 'Publishes a new route under /tools.'}
            </p>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 scrollbar-thin">
            <Field label="URL slug" hint="Lowercase letters, numbers and hyphens. Becomes /tools/<slug>.">
              <Input
                value={form.slug}
                onChange={(event) => set('slug', event.target.value)}
                placeholder="robots-txt-tester"
                spellCheck={false}
              />
            </Field>

            <Field label="Name" hint="Shown in listings and navigation.">
              <Input
                value={form.name}
                onChange={(event) => set('name', event.target.value)}
                placeholder="Robots.txt Tester"
              />
            </Field>

            <Field label="Engine" hint="Which check this page runs. Fixed set, defined in code.">
              <Select
                value={form.engine}
                onValueChange={(value) => set('engine', value as ToolEngineKey)}
              >
                <SelectTrigger aria-label="Engine">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TOOL_ENGINE_LABELS) as ToolEngineKey[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {TOOL_ENGINE_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Headline (H1)"
              hint="Must differ from other pages on the same engine, or they read as duplicates."
            >
              <Input
                value={form.headline}
                onChange={(event) => set('headline', event.target.value)}
                placeholder="Robots.txt Tester"
              />
            </Field>

            <Field label="Intro" hint="One or two sentences under the H1. Also distinct per page.">
              <Textarea
                value={form.intro}
                onChange={(event) => set('intro', event.target.value)}
                rows={3}
              />
            </Field>

            <Field label="Meta title" hint={`${form.metaTitle.length} characters. Aim for under 60.`}>
              <Input
                value={form.metaTitle}
                onChange={(event) => set('metaTitle', event.target.value)}
              />
            </Field>

            <Field
              label="Meta description"
              hint={`${form.metaDescription.length} characters. Aim for 120-155.`}
            >
              <Textarea
                value={form.metaDescription}
                onChange={(event) => set('metaDescription', event.target.value)}
                rows={3}
              />
            </Field>

            <Field label="Sort order" hint="Lower sorts first in listings.">
              <Input
                type="number"
                value={String(form.sortOrder ?? 100)}
                onChange={(event) => set('sortOrder', Number(event.target.value))}
              />
            </Field>

            <div className="space-y-2 rounded-md border p-3">
              <Toggle
                label="Live"
                hint="Off returns a 404 for the page."
                checked={form.enabled ?? true}
                onChange={(value) => set('enabled', value)}
              />
              <Toggle
                label="Listed"
                hint="Off hides it from the tools index but keeps the URL working."
                checked={form.listed ?? true}
                onChange={(value) => set('listed', value)}
              />
              <Toggle
                label="Requires an account"
                hint="Anonymous visitors are asked to sign in. Access is then granted per user."
                checked={form.requiresAuth ?? false}
                onChange={(value) => set('requiresAuth', value)}
              />
            </div>
          </div>

          <footer className="flex flex-wrap gap-2 border-t px-5 py-4">
            <Button
              className="flex-1"
              loading={save.isPending}
              disabled={!form.slug || !form.name || !form.metaTitle}
              onClick={() => save.mutate()}
            >
              {tool ? 'Save changes' : 'Create page'}
            </Button>
            {tool ? (
              confirmDelete ? (
                <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
                  Confirm delete
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete
                </Button>
              )
            ) : null}
          </footer>
        </SheetContent>
      ) : null}
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </label>
    </div>
  );
}
