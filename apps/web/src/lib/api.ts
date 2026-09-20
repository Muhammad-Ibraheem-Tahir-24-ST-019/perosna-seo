import type {
  AdminToolInput,
  AdminToolRow,
  ApiKeyItem,
  CreditPackageItem,
  CreditTransactionItem,
  DashboardMetrics,
  Paginated,
  ProjectSummary,
  ReportItem,
  MetaToolResult,
  RobotsToolResult,
  SessionUser,
  SitemapToolResult,
  SubmissionResult,
  ToolAnalytics,
  ToolDetail,
  ToolResponse,
  ToolSummary,
  UrlDetail,
  UrlListItem,
} from '@indexpilot/shared/client';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)ip_csrf=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Sent as the Idempotency-Key header for submission endpoints. */
  idempotencyKey?: string;
}

/**
 * Single entry point for API calls.
 *
 * All requests go to the same origin (Next rewrites proxy /api to the API
 * service), so the session cookie is first-party and the CSRF token is echoed
 * back from its readable cookie.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, headers, ...rest } = options;
  const method = rest.method ?? (body !== undefined ? 'POST' : 'GET');

  const requestHeaders = new Headers(headers);
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isFormData) {
    requestHeaders.set('content-type', 'application/json');
  }
  if (idempotencyKey) requestHeaders.set('idempotency-key', idempotencyKey);
  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = readCsrfToken();
    if (csrf) requestHeaders.set('x-csrf-token', csrf);
  }

  const response = await fetch(`/api/v1${path}`, {
    ...rest,
    method,
    headers: requestHeaders,
    credentials: 'same-origin',
    ...(body !== undefined
      ? { body: isFormData ? (body as FormData) : JSON.stringify(body) }
      : {}),
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) {
      throw new ApiError(response.status, 'HTTP_ERROR', `Request failed (${response.status}).`);
    }
    return (await response.text()) as T;
  }

  const payload = (await response.json()) as
    | T
    | { error: { code: string; message: string; details?: unknown; requestId?: string } };

  if (!response.ok) {
    const envelope = payload as {
      error?: { code: string; message: string; details?: unknown; requestId?: string };
    };
    throw new ApiError(
      response.status,
      envelope.error?.code ?? 'HTTP_ERROR',
      envelope.error?.message ?? `Request failed (${response.status}).`,
      envelope.error?.details,
      envelope.error?.requestId,
    );
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Typed endpoints
// ---------------------------------------------------------------------------

export const api = {
  auth: {
    me: () => apiFetch<{ user: SessionUser }>('/auth/me'),
    login: (body: { email: string; password: string }) =>
      apiFetch<{ user: SessionUser }>('/auth/login', { body }),
    register: (body: { email: string; password: string; name?: string }) =>
      apiFetch<{ user: SessionUser }>('/auth/register', { body }),
    logout: () => apiFetch<{ ok: true }>('/auth/logout', { method: 'POST' }),
    forgotPassword: (body: { email: string }) =>
      apiFetch<{ ok: true; message: string }>('/auth/forgot-password', { body }),
    resetPassword: (body: { token: string; password: string }) =>
      apiFetch<{ ok: true }>('/auth/reset-password', { body }),
    verifyEmail: (body: { token: string }) =>
      apiFetch<{ ok: true }>('/auth/verify-email', { body }),
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      apiFetch<{ ok: true; message: string }>('/auth/change-password', { body }),
    updateProfile: (body: { name: string | null }) =>
      apiFetch<{ user: SessionUser }>('/auth/profile', { method: 'PATCH', body }),
    sessions: () =>
      apiFetch<{
        items: Array<{
          id: string;
          userAgent: string | null;
          ipAddress: string | null;
          lastSeenAt: string;
          createdAt: string;
          expiresAt: string;
        }>;
      }>('/auth/sessions'),
    revokeSession: (id: string) =>
      apiFetch<{ ok: true }>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    stopImpersonation: () =>
      apiFetch<{ ok: true }>('/auth/stop-impersonation', { method: 'POST' }),
  },
  tools: {
    list: () => apiFetch<{ items: ToolSummary[] }>('/tools'),
    get: (slug: string) => apiFetch<{ tool: ToolDetail }>(`/tools/${slug}`),
    robots: (body: { url: string; slug?: string; paths?: string[]; userAgent?: string }) =>
      apiFetch<ToolResponse<RobotsToolResult>>('/tools/robots', { body }),
    meta: (body: { url: string; slug?: string }) =>
      apiFetch<ToolResponse<MetaToolResult>>('/tools/meta', { body }),
    sitemap: (body: { url: string; slug?: string; checkUrls?: boolean }) =>
      apiFetch<ToolResponse<SitemapToolResult>>('/tools/sitemap', { body }),
  },
  dashboard: {
    get: (days = 30) => apiFetch<DashboardMetrics>(`/dashboard?days=${days}`),
  },
  projects: {
    list: (params: { cursor?: string; includeArchived?: boolean } = {}) => {
      const query = new URLSearchParams();
      if (params.cursor) query.set('cursor', params.cursor);
      if (params.includeArchived) query.set('includeArchived', 'true');
      return apiFetch<Paginated<ProjectSummary>>(`/projects?${query.toString()}`);
    },
    get: (id: string) => apiFetch<{ project: ProjectSummary }>(`/projects/${id}`),
    create: (body: { name: string; description?: string }) =>
      apiFetch<{ project: ProjectSummary }>('/projects', { body }),
    update: (
      id: string,
      body: { name?: string; description?: string | null; status?: 'ACTIVE' | 'ARCHIVED' },
    ) => apiFetch<{ project: ProjectSummary }>(`/projects/${id}`, { method: 'PATCH', body }),
    urls: (id: string, params: { cursor?: string; status?: string; search?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.cursor) query.set('cursor', params.cursor);
      if (params.status && params.status !== 'all') query.set('status', params.status);
      if (params.search) query.set('search', params.search);
      return apiFetch<Paginated<UrlListItem>>(`/projects/${id}/urls?${query.toString()}`);
    },
    preview: (id: string, urls: string) =>
      apiFetch<{
        accepted: number;
        invalid: number;
        duplicatesInPayload: number;
        duplicatesInProject: number;
        estimatedCredits: number;
        availableCredits: number;
        invalidSamples: Array<{ url: string; reason: string }>;
      }>(`/projects/${id}/urls/preview`, { body: { urls } }),
    submit: (id: string, urls: string, idempotencyKey: string) =>
      apiFetch<SubmissionResult>(`/projects/${id}/urls`, { body: { urls }, idempotencyKey }),
    upload: (id: string, file: File, idempotencyKey: string) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<SubmissionResult>(`/projects/${id}/uploads`, {
        method: 'POST',
        body: form,
        idempotencyKey,
      });
    },
  },
  urls: {
    list: (params: { projectId?: string; status?: string; search?: string; cursor?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.projectId) query.set('projectId', params.projectId);
      if (params.status && params.status !== 'all') query.set('status', params.status);
      if (params.search) query.set('search', params.search);
      if (params.cursor) query.set('cursor', params.cursor);
      return apiFetch<Paginated<UrlListItem>>(`/urls?${query.toString()}`);
    },
    get: (id: string) => apiFetch<{ url: UrlDetail }>(`/urls/${id}`),
  },
  credits: {
    balance: () => apiFetch<{ balance: number; lifetimeSpent: number }>('/credits'),
    transactions: (cursor?: string) =>
      apiFetch<{ items: CreditTransactionItem[]; nextCursor: string | null }>(
        `/credits/transactions${cursor ? `?cursor=${cursor}` : ''}`,
      ),
  },
  billing: {
    packages: () => apiFetch<{ items: CreditPackageItem[] }>('/billing/packages'),
    payments: () =>
      apiFetch<{
        items: Array<{
          id: string;
          status: string;
          amountCents: number;
          currency: string;
          credits: number;
          packageName: string | null;
          checkoutUrl: string | null;
          createdAt: string;
        }>;
      }>('/billing/payments'),
    checkout: (packageId: string) =>
      apiFetch<{ paymentId: string; checkoutUrl: string }>('/billing/checkout', {
        body: { packageId },
      }),
    mockConfirm: (paymentId: string) =>
      apiFetch<{ handled: boolean; creditsAdded: number }>('/billing/mock-confirm', {
        body: { paymentId },
      }),
  },
  reports: {
    list: () => apiFetch<{ items: ReportItem[] }>('/reports'),
    create: (body: { projectId?: string; filter: string }) =>
      apiFetch<{ report: ReportItem }>('/reports', { body }),
    get: (id: string) => apiFetch<{ report: ReportItem }>(`/reports/${id}`),
  },
  apiKeys: {
    list: () => apiFetch<{ items: ApiKeyItem[] }>('/api-keys'),
    create: (name: string) =>
      apiFetch<{ apiKey: ApiKeyItem; secret: string }>('/api-keys', { body: { name } }),
    revoke: (id: string) => apiFetch<{ ok: true }>(`/api-keys/${id}`, { method: 'DELETE' }),
  },
  admin: {
    overview: () => apiFetch<AdminOverview>('/admin/overview'),
    users: (params: { search?: string; limit?: number; skip?: number } = {}) => {
      const query = new URLSearchParams();
      if (params.search) query.set('search', params.search);
      if (params.limit) query.set('limit', String(params.limit));
      if (params.skip) query.set('skip', String(params.skip));
      return apiFetch<{ total: number; items: AdminUserRow[] }>(`/admin/users?${query.toString()}`);
    },
    user: (id: string) => apiFetch<AdminUserDetail>(`/admin/users/${id}`),
    setSuspension: (id: string, suspended: boolean, reason: string) =>
      apiFetch<{ id: string; status: string }>(`/admin/users/${id}/suspension`, {
        body: { suspended, reason },
      }),
    adjustCredits: (id: string, amount: number, reason: string) =>
      apiFetch<{ balance: number; transactionId: string }>(`/admin/users/${id}/credits`, {
        body: { amount, reason },
      }),
    setRole: (id: string, role: string, reason: string) =>
      apiFetch<{ id: string; role: string }>(`/admin/users/${id}/role`, {
        method: 'PATCH',
        body: { role, reason },
      }),
    forcePasswordReset: (id: string, reason: string) =>
      apiFetch<{ ok: true }>(`/admin/users/${id}/password-reset`, { body: { reason } }),
    setPassword: (id: string, password: string, reason: string) =>
      apiFetch<{ ok: true; sessionsRevoked: number }>(`/admin/users/${id}/password`, {
        body: { password, reason },
      }),
    revokeSessions: (id: string, reason?: string) =>
      apiFetch<{ ok: true; sessionsRevoked: number }>(`/admin/users/${id}/revoke-sessions`, {
        body: { reason },
      }),
    impersonate: (id: string) =>
      apiFetch<{ user: SessionUser; expiresAt: string }>(`/admin/users/${id}/impersonate`, {
        method: 'POST',
      }),
    tools: () => apiFetch<{ items: AdminToolRow[]; unseeded: string[] }>('/admin/tools'),
    toolAnalytics: (days = 30) =>
      apiFetch<ToolAnalytics>(`/admin/tools/analytics?days=${days}`),
    createTool: (body: AdminToolInput) =>
      apiFetch<{ tool: AdminToolRow }>('/admin/tools', { body }),
    updateTool: (id: string, body: Partial<AdminToolInput>) =>
      apiFetch<{ tool: AdminToolRow }>(`/admin/tools/${id}`, { method: 'PATCH', body }),
    deleteTool: (id: string) =>
      apiFetch<{ ok: true }>(`/admin/tools/${id}`, { method: 'DELETE' }),
    seedTools: () => apiFetch<{ created: number }>('/admin/tools/seed', { method: 'POST' }),
    grantToolAccess: (
      userId: string,
      body: { toolId: string; hourlyLimit?: number | null; expiresAt?: string | null; note?: string },
    ) => apiFetch<{ grant: unknown }>(`/admin/users/${userId}/tool-access`, { body }),
    revokeToolAccess: (userId: string, toolId: string) =>
      apiFetch<{ ok: true }>(`/admin/users/${userId}/tool-access/${toolId}`, { method: 'DELETE' }),
    refundPayment: (id: string, reason: string, allowPartial = false) =>
      apiFetch<{
        paymentId: string;
        creditsReversed: number;
        partial: boolean;
        providerRefunded: boolean;
        providerError: string | null;
      }>(`/admin/payments/${id}/refund`, { body: { reason, allowPartial } }),
    requeueUrl: (id: string) =>
      apiFetch<{ ok: true; urlId: string }>(`/admin/urls/${id}/requeue`, { method: 'POST' }),
    packages: () => apiFetch<{ items: CreditPackageItem[] }>('/admin/credit-packages'),
    createPackage: (body: {
      name: string;
      credits: number;
      priceCents: number;
      sortOrder?: number;
    }) => apiFetch<{ package: CreditPackageItem }>('/admin/credit-packages', { body }),
    updatePackage: (
      id: string,
      body: { name?: string; credits?: number; priceCents?: number; enabled?: boolean },
    ) =>
      apiFetch<{ package: CreditPackageItem }>(`/admin/credit-packages/${id}`, {
        method: 'PATCH',
        body,
      }),
    deletePackage: (id: string) =>
      apiFetch<{ deleted: boolean; disabled: boolean }>(`/admin/credit-packages/${id}`, {
        method: 'DELETE',
      }),
    setProviderCredentials: (id: string, settings: Record<string, unknown>) =>
      apiFetch<{ id: string; hasCredentials: boolean }>(`/admin/providers/${id}/credentials`, {
        method: 'PUT',
        body: { settings },
      }),
    urls: (limit = 50) =>
      apiFetch<{
        items: Array<{
          id: string;
          url: string;
          owner: string;
          project: string;
          validationStatus: string;
          processingStatus: string;
          verificationStatus: string;
          updatedAt: string;
        }>;
      }>(`/admin/urls?limit=${limit}`),
    queues: () => apiFetch<{ items: QueueRow[] }>('/admin/queues'),
    failedJobs: () => apiFetch<{ items: FailedJobRow[] }>('/admin/jobs/failed'),
    retryJob: (id: string) => apiFetch<{ ok: true }>(`/admin/jobs/${id}/retry`, { method: 'POST' }),
    providers: () => apiFetch<{ items: ProviderRow[] }>('/admin/providers'),
    updateProvider: (id: string, body: { enabled?: boolean; priority?: number }) =>
      apiFetch<{ id: string; enabled: boolean }>(`/admin/providers/${id}`, {
        method: 'PATCH',
        body,
      }),
    auditLogs: () => apiFetch<{ items: AuditLogRow[] }>('/admin/audit-logs'),
    payments: () => apiFetch<{ items: AdminPaymentRow[] }>('/admin/payments'),
    apiUsage: () =>
      apiFetch<{
        recent: Array<{
          id: string;
          method: string;
          path: string;
          statusCode: number;
          durationMs: number;
          createdAt: string;
        }>;
        series: Array<{ date: string; count: number; errors: number }>;
      }>('/admin/api-usage'),
  },
  health: () => apiFetch<HealthPayload>('/health'),
};

export interface QueueRow {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: boolean;
}

export interface ProviderRow {
  id: string;
  key: string;
  name: string;
  type: string;
  enabled: boolean;
  priority: number;
  rateLimitPerMin: number;
  dailyLimit: number | null;
  healthStatus: string;
  healthDetail: string | null;
  lastHealthCheckAt: string | null;
  hasCredentials: boolean;
}

export interface AdminOverview {
  users: { total: number; byStatus: Record<string, number> };
  urls: { total: number; failed: number };
  projects: number;
  payments: { count: number; grossCents: number };
  credits: { outstanding: number; lifetimeSpent: number };
  queues: QueueRow[];
  providers: ProviderRow[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  credits: number;
  lifetimeSpent: number;
  projects: number;
  urls: number;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AdminUserDetail extends Omit<AdminUserRow, 'credits' | 'projects' | 'urls'> {
  suspendedReason: string | null;
  wallet: {
    balance: number;
    lifetimeSpent: number;
    reconciliation: {
      cachedBalance: number;
      ledgerBalance: number;
      drift: number;
      consistent: boolean;
    };
  };
  projects: Array<{ id: string; name: string; status: string; createdAt: string }>;
  payments: Array<{
    id: string;
    status: string;
    amountCents: number;
    credits: number;
    createdAt: string;
  }>;
  apiKeys: Array<{
    id: string;
    name: string;
    keyPrefix: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
  }>;
  transactions: CreditTransactionItem[];
}

export interface FailedJobRow {
  id: string;
  queue: string;
  bullJobId: string;
  entityType: string;
  entityId: string;
  attempts: number;
  error: string | null;
  updatedAt: string;
}

export interface AuditLogRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AdminPaymentRow {
  id: string;
  user: string;
  provider: string;
  status: string;
  amountCents: number;
  currency: string;
  credits: number;
  createdAt: string;
}

export interface HealthPayload {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  environment: string;
  uptimeSeconds: number;
  checks: Array<{ name: string; status: string; detail?: string }>;
  queues: QueueRow[];
}
