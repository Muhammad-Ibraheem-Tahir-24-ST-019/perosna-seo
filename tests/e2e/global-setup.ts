import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request, type FullConfig } from '@playwright/test';
import { ADMIN_STATE, ADMIN_USER, DEMO_USER, USER_STATE } from './fixtures';

/**
 * Signs in once per role and stores the session for the whole run.
 *
 * Besides being faster, this keeps the suite honest: the API rate-limits sign-in
 * attempts per IP (10/min), and a suite that logged in for every test would be
 * testing the rate limiter rather than the feature.
 */
async function saveSession(
  baseURL: string,
  user: { email: string; password: string },
  file: string,
): Promise<void> {
  const context = await request.newContext({ baseURL });
  const response = await context.post('/api/v1/auth/login', { data: user });

  if (!response.ok()) {
    throw new Error(
      `E2E setup: could not sign in as ${user.email} (${response.status()}). ` +
        'Run "pnpm db:seed" against a development database first.',
    );
  }

  await mkdir(dirname(file), { recursive: true });
  const state = await context.storageState();
  await writeFile(file, JSON.stringify(state, null, 2));
  await context.dispose();
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use.baseURL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000';

  await saveSession(baseURL, DEMO_USER, USER_STATE);
  await saveSession(baseURL, ADMIN_USER, ADMIN_STATE);
}
