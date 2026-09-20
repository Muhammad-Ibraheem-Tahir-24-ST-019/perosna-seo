import { expect, test as base, type Page } from '@playwright/test';

export const DEMO_USER = { email: 'demo@indexpilot.local', password: 'Demo123!pass' };
export const ADMIN_USER = { email: 'admin@indexpilot.local', password: 'Admin123!pass' };

/** Sessions captured once by global-setup and reused by the specs. */
export const USER_STATE = 'test-results/.auth/user.json';
export const ADMIN_STATE = 'test-results/.auth/admin.json';
/** An explicitly empty session, for specs that must start signed out. */
export const ANONYMOUS_STATE = { cookies: [], origins: [] };

/** Routes every signed-in user can reach. Used by the responsive/console sweeps. */
export const MAIN_ROUTES = [
  '/dashboard',
  '/projects',
  '/urls',
  '/submit',
  '/reports',
  '/api-keys',
  '/billing',
  '/settings',
];

export interface ConsoleWatcher {
  errors: string[];
  failedRequests: string[];
}

/**
 * Collects console errors, page exceptions and failed requests so specs can
 * assert the browser console stays clean.
 */
export function watchConsole(page: Page): ConsoleWatcher {
  const watcher: ConsoleWatcher = { errors: [], failedRequests: [] };

  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const text = message.text();
    // React hydration mismatches and missing keys must fail the suite.
    const isReactProblem = /hydrat|did not match|unique "key"|validateDOMNesting/i.test(text);
    if (message.type() === 'error' || isReactProblem) {
      // next-themes intentionally suppresses a first-paint mismatch warning; the
      // dev overlay's own fetch noise is not a product error.
      if (/Download the React DevTools/i.test(text)) return;
      watcher.errors.push(`[${message.type()}] ${text}`);
    }
  });

  page.on('pageerror', (error) => {
    watcher.errors.push(`[pageerror] ${error.message}`);
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    if (/ERR_ABORTED/i.test(failure)) return;
    watcher.failedRequests.push(`${request.url()} (${failure})`);
  });

  page.on('response', (response) => {
    if (response.status() !== 404) return;
    // A 404 on a static asset means a broken build reference.
    if (/\/_next\/|\.(js|css|png|svg|woff2?)$/i.test(response.url())) {
      watcher.failedRequests.push(`${response.url()} (404)`);
    }
  });

  return watcher;
}

/** Opens the app with the session that the project's storageState already carries. */
export async function openApp(page: Page, route = '/dashboard'): Promise<void> {
  await page.goto(route);
  await expect(page).not.toHaveURL(/\/login/);
}

export async function login(
  page: Page,
  user: { email: string; password: string } = DEMO_USER,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** Fails if the document scrolls horizontally - the classic mobile layout bug. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((element) => element.getBoundingClientRect().width > doc.clientWidth + 1)
        .slice(0, 3)
        .map((element) => `${element.tagName}.${element.className}`.slice(0, 120)),
    };
  });
  expect(
    overflow.scrollWidth,
    `horizontal overflow: ${overflow.scrollWidth} > ${overflow.clientWidth}; widest: ${overflow.widest.join(' | ')}`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

export const test = base;
export { expect };
