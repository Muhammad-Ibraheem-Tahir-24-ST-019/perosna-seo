'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, ListChecks, Upload } from 'lucide-react';
import { toast } from 'sonner';
import type { SubmissionResult } from '@indexpilot/shared/client';
import { api, ApiError } from '@/lib/api';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@/components/ui/core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/overlay';
import { EmptyState } from '@/components/ui/states';
import { CreateProjectDialog } from '@/components/create-project-dialog';
import { formatNumber, newIdempotencyKey } from '@/lib/utils';

function SubmitView() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [projectId, setProjectId] = React.useState(params.get('project') ?? '');
  const [text, setText] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<SubmissionResult | null>(null);

  const projectsQuery = useQuery({
    queryKey: ['projects', { includeArchived: false }],
    queryFn: () => api.projects.list({}),
  });

  React.useEffect(() => {
    if (!projectId && projectsQuery.data?.items[0]) {
      setProjectId(projectsQuery.data.items[0].id);
    }
  }, [projectId, projectsQuery.data]);

  const preview = useMutation({
    mutationFn: () => api.projects.preview(projectId, text),
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Preview failed.'),
  });

  const submitText = useMutation({
    mutationFn: () => api.projects.submit(projectId, text, newIdempotencyKey()),
    onSuccess: (data) => {
      setResult(data);
      setText('');
      preview.reset();
      toast.success(`${formatNumber(data.accepted)} URL(s) queued.`);
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Submission failed.'),
  });

  const submitFile = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a file first.');
      return api.projects.upload(projectId, file, newIdempotencyKey());
    },
    onSuccess: (data) => {
      setResult(data);
      setFile(null);
      toast.success(`${formatNumber(data.accepted)} URL(s) queued from the file.`);
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (error: unknown) =>
      toast.error(error instanceof ApiError ? error.message : 'Upload failed.'),
  });

  const projects = projectsQuery.data?.items ?? [];
  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">New submission</h1>
        <p className="text-sm text-muted-foreground">
          Paste URLs or upload a TXT/CSV file. Third-party URLs are supported — you do not need to
          own the domain.
        </p>
      </div>

      {!hasProjects && !projectsQuery.isLoading ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="Create a project first"
            description="Submissions belong to a project so credits, reports and statuses stay organised."
            action={<CreateProjectDialog />}
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Target project</CardTitle>
              <CardDescription>Where these URLs will be tracked.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="project-select" className="sr-only">
                Project
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger id="project-select" className="sm:max-w-sm">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CreateProjectDialog
                  trigger={
                    <Button variant="outline" className="sm:w-auto">
                      New project
                    </Button>
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="paste">
            <TabsList>
              <TabsTrigger value="paste">Paste URLs</TabsTrigger>
              <TabsTrigger value="upload">Upload file</TabsTrigger>
            </TabsList>

            <TabsContent value="paste">
              <Card>
                <CardHeader>
                  <CardTitle>Bulk paste</CardTitle>
                  <CardDescription>One URL per line.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Label htmlFor="urls" className="sr-only">
                    URLs
                  </Label>
                  <Textarea
                    id="urls"
                    data-testid="urls-textarea"
                    className="min-h-[200px]"
                    placeholder={'https://example.com/page-1\nhttps://example.com/page-2'}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />

                  {preview.data ? (
                    <div className="grid gap-3 rounded-md border p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <Metric label="Billable URLs" value={preview.data.accepted} />
                      <Metric label="Estimated credits" value={preview.data.estimatedCredits} />
                      <Metric label="Duplicates" value={preview.data.duplicatesInProject + preview.data.duplicatesInPayload} />
                      <Metric label="Invalid" value={preview.data.invalid} />
                      {preview.data.estimatedCredits > preview.data.availableCredits ? (
                        <p className="sm:col-span-2 lg:col-span-4 text-sm text-destructive">
                          Not enough credits: {formatNumber(preview.data.estimatedCredits)} needed,{' '}
                          {formatNumber(preview.data.availableCredits)} available.{' '}
                          <Link href="/billing" className="underline">
                            Top up
                          </Link>
                          .
                        </p>
                      ) : null}
                      {preview.data.invalidSamples.length > 0 ? (
                        <ul className="sm:col-span-2 lg:col-span-4 space-y-1 text-xs text-muted-foreground">
                          {preview.data.invalidSamples.slice(0, 5).map((sample) => (
                            <li key={sample.url} className="break-anywhere">
                              {sample.url} — {sample.reason}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!text.trim() || !projectId}
                      loading={preview.isPending}
                      onClick={() => preview.mutate()}
                    >
                      <ListChecks className="h-4 w-4" />
                      Check before submitting
                    </Button>
                    <Button
                      type="button"
                      data-testid="submit-urls-button"
                      disabled={!text.trim() || !projectId}
                      loading={submitText.isPending}
                      onClick={() => submitText.mutate()}
                    >
                      <Upload className="h-4 w-4" />
                      Submit URLs
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="upload">
              <Card>
                <CardHeader>
                  <CardTitle>Upload TXT or CSV</CardTitle>
                  <CardDescription>
                    CSV files are scanned for the column that looks most like URLs.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Label htmlFor="file">File</Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".txt,.csv,.tsv,text/plain,text/csv"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                  {file ? (
                    <p className="text-xs text-muted-foreground">
                      {file.name} · {formatNumber(Math.round(file.size / 1024))} KB
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    disabled={!file || !projectId}
                    loading={submitFile.isPending}
                    onClick={() => submitFile.mutate()}
                  >
                    <FileUp className="h-4 w-4" />
                    Upload and submit
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {result ? (
            <Card data-testid="submission-result">
              <CardHeader>
                <CardTitle>Submission accepted</CardTitle>
                <CardDescription>
                  URLs are validated and processed in the background. Statuses update as work
                  completes.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Metric label="Received" value={result.received} />
                  <Metric label="Accepted" value={result.accepted} />
                  <Metric label="Duplicates" value={result.duplicatesInProject + result.duplicatesInPayload} />
                  <Metric label="Invalid" value={result.invalid} />
                  <Metric label="Credits charged" value={result.creditsCharged} />
                  <Metric label="Credits left" value={result.creditsRemaining} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => router.push(`/projects/${projectId}`)}>
                    View project progress
                  </Button>
                  <Button variant="outline" onClick={() => setResult(null)}>
                    Submit more
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{formatNumber(value)}</p>
    </div>
  );
}

export default function SubmitPage() {
  return (
    <React.Suspense fallback={<div className="skeleton h-96 w-full" />}>
      <SubmitView />
    </React.Suspense>
  );
}
