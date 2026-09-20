import { env } from '@indexpilot/config';
import {
  AuditActions,
  grantBonusCredits,
  getOrCreateWallet,
  prisma,
  recordAudit,
  type User,
} from '@indexpilot/db';
import {
  API_KEY_PREFIX,
  conflict,
  forbidden,
  hashPassword,
  notFound,
  hashToken,
  randomToken,
  unauthorized,
  verifyPassword,
  type SessionUser,
} from '@indexpilot/shared';
import { createEmailProvider } from '@indexpilot/providers';
import { logger } from '../lib/logger.js';

const SESSION_TTL_MS = env.SESSION_TTL_HOURS * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
/**
 * Impersonation sessions expire far sooner than a normal login. An admin
 * looking at someone's account should have to re-assume it deliberately rather
 * than leave a live session sitting in a tab for a month.
 */
const IMPERSONATION_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export interface AuthContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginResult {
  user: SessionUser;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function registerUser(
  input: { email: string; password: string; name?: string },
  context: AuthContext = {},
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw conflict('An account with that email already exists.');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      email,
      name: input.name?.trim() || null,
      passwordHash,
      role: 'USER',
      // Email verification is wired end to end; accounts stay usable while the
      // verification email is outstanding so onboarding is not blocked by SMTP.
      status: 'ACTIVE',
      wallet: { create: { cachedBalance: 0 } },
    },
  });

  if (env.SIGNUP_BONUS_CREDITS > 0) {
    await grantBonusCredits({
      userId: user.id,
      amount: env.SIGNUP_BONUS_CREDITS,
      referenceType: 'signup',
      referenceId: user.id,
      description: 'Welcome credits',
    });
  }

  await sendVerificationEmail(user).catch((error: unknown) => {
    logger.warn({ err: error }, 'verification email failed');
  });

  await recordAudit({
    actorUserId: user.id,
    actorEmail: user.email,
    action: AuditActions.userRegistered,
    entityType: 'user',
    entityId: user.id,
    ipAddress: context.ipAddress ?? null,
  });

  return createSession(user, context);
}

export async function loginUser(
  input: { email: string; password: string },
  context: AuthContext = {},
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  // Always run a hash comparison so a missing account and a wrong password take
  // a similar amount of time.
  const passwordOk = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyPassword(input.password, `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`);

  if (!user || !passwordOk) {
    await recordAudit({
      actorEmail: email,
      action: AuditActions.userLoginFailed,
      entityType: 'user',
      entityId: user?.id ?? null,
      ipAddress: context.ipAddress ?? null,
    });
    throw unauthorized('Email or password is incorrect.');
  }
  if (user.status === 'SUSPENDED') {
    throw forbidden('This account is suspended. Contact support.');
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    actorUserId: user.id,
    actorEmail: user.email,
    action: AuditActions.userLogin,
    entityType: 'user',
    entityId: user.id,
    ipAddress: context.ipAddress ?? null,
  });

  return createSession(user, context);
}

export async function createSession(user: User, context: AuthContext = {}): Promise<LoginResult> {
  const sessionToken = randomToken(32);
  const csrfToken = randomToken(16);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      expiresAt,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
    },
  });

  return { user: await toSessionUser(user), sessionToken, csrfToken, expiresAt };
}

export async function resolveSession(token: string): Promise<SessionUser | null> {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
  // A suspended account cannot be used -- but an admin must still be able to
  // impersonate one, which is often the only way to see what the user sees.
  if (session.user.status === 'SUSPENDED' && !session.impersonatedByUserId) return null;

  // Touch at most once a minute to avoid a write on every request.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  const user = await toSessionUser(session.user);
  if (session.impersonatedByUserId && session.impersonatedByEmail) {
    user.impersonatedBy = {
      id: session.impersonatedByUserId,
      email: session.impersonatedByEmail,
    };
  }
  return user;
}

/**
 * Opens a session that acts as `target` but records `actor` as the real person
 * behind it.
 *
 * Guard rails, in order of importance:
 *  - an admin may never impersonate someone with equal or greater privilege,
 *    because that would be a privilege escalation dressed up as support;
 *  - the session is short-lived and always audited;
 *  - `impersonatedBy` travels with the session so the UI can never quietly
 *    present this as a normal login.
 */
export async function createImpersonationSession(
  actor: SessionUser,
  targetUserId: string,
  context: AuthContext = {},
): Promise<LoginResult> {
  if (actor.id === targetUserId) {
    throw forbidden('You are already signed in as yourself.');
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw notFound('User not found.');

  const privileged = target.role === 'ADMIN' || target.role === 'SUPER_ADMIN';
  if (privileged && actor.role !== 'SUPER_ADMIN') {
    throw forbidden('Only a super admin may impersonate another administrator.');
  }
  if (target.role === 'SUPER_ADMIN') {
    throw forbidden('Super admin accounts cannot be impersonated.');
  }

  const sessionToken = randomToken(32);
  const csrfToken = randomToken(16);
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);

  await prisma.session.create({
    data: {
      userId: target.id,
      tokenHash: hashToken(sessionToken),
      expiresAt,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      impersonatedByUserId: actor.id,
      impersonatedByEmail: actor.email,
    },
  });

  await recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: AuditActions.userImpersonated,
    entityType: 'user',
    entityId: target.id,
    metadata: { targetEmail: target.email, expiresAt: expiresAt.toISOString() },
    ipAddress: context.ipAddress ?? null,
  });

  const user = await toSessionUser(target);
  user.impersonatedBy = { id: actor.id, email: actor.email };
  return { user, sessionToken, csrfToken, expiresAt };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session
    .updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw unauthorized('Current password is incorrect.');
  }
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await revokeAllSessions(userId);
  await recordAudit({
    actorUserId: userId,
    actorEmail: user.email,
    action: AuditActions.userPasswordChanged,
    entityType: 'user',
    entityId: userId,
  });
}

/**
 * Always resolves, whether or not the address exists: a difference in behaviour
 * would let anyone enumerate registered emails.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return;

  const token = randomToken(32);
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      purpose: 'PASSWORD_RESET',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  const link = new URL('/reset-password', env.APP_URL);
  link.searchParams.set('token', token);
  await createEmailProvider().send({
    to: user.email,
    subject: `Reset your ${env.APP_NAME} password`,
    text: `Open this link within 1 hour to choose a new password:\n\n${link.toString()}\n\nIf you did not request this, ignore this email.`,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (
    !record ||
    record.purpose !== 'PASSWORD_RESET' ||
    record.usedAt ||
    record.expiresAt.getTime() < Date.now()
  ) {
    throw unauthorized('This reset link is invalid or has expired.');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(newPassword) },
    }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAudit({
    actorUserId: record.userId,
    actorEmail: record.user.email,
    action: AuditActions.userPasswordReset,
    entityType: 'user',
    entityId: record.userId,
  });
}

export async function sendVerificationEmail(user: User): Promise<void> {
  const token = randomToken(24);
  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      purpose: 'EMAIL_VERIFICATION',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
    },
  });
  const link = new URL('/verify-email', env.APP_URL);
  link.searchParams.set('token', token);
  await createEmailProvider().send({
    to: user.email,
    subject: `Confirm your ${env.APP_NAME} email address`,
    text: `Welcome to ${env.APP_NAME}. Confirm your email address:\n\n${link.toString()}`,
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (
    !record ||
    record.purpose !== 'EMAIL_VERIFICATION' ||
    record.usedAt ||
    record.expiresAt.getTime() < Date.now()
  ) {
    throw unauthorized('This verification link is invalid or has expired.');
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date(), status: 'ACTIVE' },
    }),
    prisma.verificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export async function createApiKey(
  userId: string,
  name: string,
): Promise<{ id: string; name: string; keyPrefix: string; secret: string }> {
  const secret = `${API_KEY_PREFIX}${randomToken(24)}`;
  const keyPrefix = secret.slice(0, 16);
  const key = await prisma.apiKey.create({
    data: { userId, name, keyPrefix, keyHash: hashToken(secret) },
  });
  await recordAudit({
    actorUserId: userId,
    action: AuditActions.apiKeyCreated,
    entityType: 'api_key',
    entityId: key.id,
  });
  // The raw secret is returned exactly once and never stored.
  return { id: key.id, name: key.name, keyPrefix, secret };
}

export async function resolveApiKey(secret: string): Promise<SessionUser | null> {
  if (!secret.startsWith(API_KEY_PREFIX)) return null;
  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hashToken(secret) },
    include: { user: true },
  });
  if (!key || key.revokedAt) return null;
  if (key.user.status === 'SUSPENDED') return null;

  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    await prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return toSessionUser(key.user);
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const result = await prisma.apiKey.updateMany({
    where: { id: keyId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) throw conflict('API key not found or already revoked.');
  await recordAudit({
    actorUserId: userId,
    action: AuditActions.apiKeyRevoked,
    entityType: 'api_key',
    entityId: keyId,
  });
}

export async function toSessionUser(user: User): Promise<SessionUser> {
  const wallet = await getOrCreateWallet(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    credits: wallet.cachedBalance,
    createdAt: user.createdAt.toISOString(),
  };
}
