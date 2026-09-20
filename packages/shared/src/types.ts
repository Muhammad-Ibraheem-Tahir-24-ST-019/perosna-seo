import type {
  OverallStatus,
  ProcessingStatus,
  ValidationStatus,
  VerificationStatus,
} from './status.js';

export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN' | 'AGENCY';
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';
export type SearchEngineKey = 'GOOGLE' | 'BING' | 'YANDEX' | 'NAVER' | 'SEZNAM' | 'OTHER';
export type CreditTransactionType =
  | 'PURCHASE'
  | 'SUBMISSION_DEBIT'
  | 'REFUND'
  | 'ADMIN_ADJUSTMENT'
  | 'BONUS'
  | 'REVERSAL';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  emailVerified: boolean;
  credits: number;
  createdAt: string;
  /**
   * Set when an admin is viewing the product as this user. The session acts as
   * the impersonated user, so the UI must show a persistent banner and the
   * audit trail must keep naming the real actor.
   */
  impersonatedBy?: { id: string; email: string } | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  stats: ProjectStats;
}

export interface ProjectStats {
  totalUrls: number;
  creditsSpent: number;
  valid: number;
  invalid: number;
  blocked: number;
  queued: number;
  processing: number;
  discoveryAttempted: number;
  crawlDetected: number;
  indexedConfirmed: number;
  notConfirmedIndexed: number;
  failed: number;
  pending: number;
}

export interface DashboardMetrics {
  totals: {
    totalUrls: number;
    processed: number;
    crawlDetected: number;
    indexedConfirmed: number;
    notConfirmedIndexed: number;
    pending: number;
    failed: number;
    blocked: number;
    invalid: number;
    projects: number;
    credits: number;
  };
  series: DashboardSeriesPoint[];
  recentProjects: ProjectSummary[];
  recentUrls: UrlListItem[];
}

export interface DashboardSeriesPoint {
  date: string;
  submitted: number;
  processed: number;
  crawlDetected: number;
  indexedConfirmed: number;
  failed: number;
}

export interface UrlListItem {
  id: string;
  projectId: string;
  projectName?: string;
  originalUrl: string;
  normalizedUrl: string;
  hostname: string;
  validationStatus: ValidationStatus;
  processingStatus: ProcessingStatus;
  verificationStatus: VerificationStatus;
  overallStatus: OverallStatus;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
}

export interface UrlDetail extends UrlListItem {
  validation: UrlValidationSummary | null;
  attempts: ProcessingAttemptSummary[];
  indexChecks: IndexCheckSummary[];
  creditsCharged: number;
  refunded: boolean;
}

export interface UrlValidationSummary {
  httpStatus: number | null;
  finalUrl: string | null;
  redirectCount: number;
  robotsAllowed: boolean | null;
  noindexDetected: boolean | null;
  canonicalUrl: string | null;
  contentType: string | null;
  contentLength: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

export interface ProcessingAttemptSummary {
  id: string;
  providerKey: string;
  providerName: string;
  attemptNumber: number;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  startedAt: string | null;
  completedAt: string | null;
  providerReference: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface IndexCheckSummary {
  id: string;
  engine: SearchEngineKey;
  method: string;
  status: 'INDEXED_CONFIRMED' | 'NOT_CONFIRMED_INDEXED' | 'ERROR';
  confidence: number;
  limitations: string | null;
  checkedAt: string;
}

export interface SubmissionResult {
  batchId: string;
  received: number;
  accepted: number;
  duplicatesInPayload: number;
  duplicatesInProject: number;
  invalid: number;
  creditsCharged: number;
  creditsRemaining: number;
  invalidSamples: Array<{ url: string; reason: string }>;
}

export interface CreditTransactionItem {
  id: string;
  amount: number;
  type: CreditTransactionType;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  balanceAfter: number | null;
  createdAt: string;
}

export interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ReportItem {
  id: string;
  projectId: string | null;
  projectName: string | null;
  status: 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED' | 'EXPIRED';
  format: 'CSV';
  filter: string;
  rowCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  downloadUrl: string | null;
}

export interface CreditPackageItem {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  currency: string;
  enabled: boolean;
  sortOrder: number;
}

export interface QueueDepth {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: boolean;
}

export interface SystemHealth {
  status: 'ok' | 'degraded' | 'down';
  uptimeSeconds: number;
  version: string;
  checks: Array<{ name: string; status: 'ok' | 'degraded' | 'down'; detail?: string }>;
}
