import { prisma } from './client.js';

export interface AuditEntry {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Records a sensitive action. Audit writes must never break the request they
 * describe, so failures are swallowed after being surfaced to stderr.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId ?? null,
        actorEmail: entry.actorEmail ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        reason: entry.reason ?? null,
        metadata: (entry.metadata ?? undefined) as never,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    process.stderr.write(
      `[audit] failed to record ${entry.action}: ${(error as Error).message}\n`,
    );
  }
}

export const AuditActions = {
  userRegistered: 'user.registered',
  userLogin: 'user.login',
  userLoginFailed: 'user.login_failed',
  userLogout: 'user.logout',
  userPasswordReset: 'user.password_reset',
  userPasswordChanged: 'user.password_changed',
  userSuspended: 'admin.user_suspended',
  userUnsuspended: 'admin.user_unsuspended',
  creditsAdjusted: 'admin.credits_adjusted',
  roleChanged: 'admin.role_changed',
  adminPaymentRefunded: 'admin.payment_refunded',
  packageCreated: 'admin.credit_package_created',
  packageUpdated: 'admin.credit_package_updated',
  packageDeleted: 'admin.credit_package_deleted',
  passwordResetForced: 'admin.password_reset_forced',
  passwordSetByAdmin: 'admin.password_set',
  userImpersonated: 'admin.user_impersonated',
  impersonationEnded: 'admin.impersonation_ended',
  sessionsRevoked: 'admin.sessions_revoked',
  toolCreated: 'admin.tool_created',
  toolUpdated: 'admin.tool_updated',
  toolDeleted: 'admin.tool_deleted',
  toolAccessGranted: 'admin.tool_access_granted',
  toolAccessRevoked: 'admin.tool_access_revoked',
  urlRequeued: 'admin.url_requeued',
  providerCredentialsSet: 'admin.provider_credentials_set',
  providerToggled: 'admin.provider_toggled',
  providerConfigured: 'admin.provider_configured',
  jobRetried: 'admin.job_retried',
  apiKeyCreated: 'api_key.created',
  apiKeyRevoked: 'api_key.revoked',
  projectCreated: 'project.created',
  projectArchived: 'project.archived',
  urlsSubmitted: 'urls.submitted',
  paymentSucceeded: 'payment.succeeded',
  paymentRefunded: 'payment.refunded',
} as const;
