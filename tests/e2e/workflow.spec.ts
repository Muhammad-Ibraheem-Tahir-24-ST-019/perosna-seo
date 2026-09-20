import {
  ADMIN_STATE,
  expect,
  MAIN_ROUTES,
  openApp,
  test,
  USER_STATE,
  watchConsole,
} from './fixtures';

test.use({ storageState: USER_STATE });

test.describe('core workflow', () => {
  test('creates a project, submits URLs and shows them moving through the pipeline', async ({
    page,
  }) => {
    await openApp(page);

    const projectName = `E2E Campaign ${Date.now()}`;
    await page.goto('/projects');
    await page.getByTestId('new-project-button').click();
    await page.getByLabel('Name').fill(projectName);
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('link', { name: projectName })).toBeVisible();

    await page.goto('/submit');
    const stamp = Date.now();
    await page.getByTestId('urls-textarea').fill(
      [
        `https://example.com/e2e-${stamp}-a`,
        `https://example.com/e2e-${stamp}-b`,
        'javascript:alert(1)',
      ].join('\n'),
    );

    // Cost preview before spending credits.
    await page.getByRole('button', { name: 'Check before submitting' }).click();
    await expect(page.getByText('Estimated credits')).toBeVisible();

    await page.getByTestId('submit-urls-button').click();
    const result = page.getByTestId('submission-result');
    await expect(result).toBeVisible();
    await expect(result.getByText('Submission accepted')).toBeVisible();

    // The invalid URL is reported, not silently swallowed.
    await expect(result.getByText('Invalid')).toBeVisible();

    await page.goto('/urls');
    await page.waitForLoadState('networkidle');
    // The list renders a mobile card variant and a desktop table variant; only
    // one of them is visible at any width, so assert on the visible one.
    await expect(
      page.getByText(`e2e-${stamp}-a`).filter({ visible: true }).first(),
    ).toBeVisible();
  });

  test('filters the URL list by status', async ({ page }) => {
    await openApp(page);
    await page.goto('/urls');
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Filter by status').click();
    await page.getByRole('option', { name: 'Indexed (confirmed)' }).click();
    await page.waitForLoadState('networkidle');

    // Either results are confirmed, or an honest empty state is shown.
    const rows = page.getByText('Indexed (confirmed)');
    const empty = page.getByText('No URLs match this view');
    await expect(rows.first().or(empty)).toBeVisible();
  });

  test('queues a CSV report', async ({ page }) => {
    await openApp(page);
    await page.goto('/reports');
    await page.getByRole('button', { name: 'Generate CSV' }).click();
    await expect(page.getByText(/QUEUED|GENERATING|READY/).first()).toBeVisible();
  });

  test('creates and revokes an API key, showing the secret only once', async ({ page }) => {
    await openApp(page);
    await page.goto('/api-keys');

    await page.getByRole('button', { name: 'New API key' }).click();
    await page.getByLabel('Name').fill('E2E key');
    await page.getByRole('button', { name: 'Create key' }).click();

    await expect(page.getByText('Copy your API key now')).toBeVisible();
    const secret = await page.locator('code').first().innerText();
    expect(secret).toMatch(/^ip_live_/);

    await page.getByRole('button', { name: 'I have saved it' }).click();
    await page.reload();
    await expect(page.getByText(secret)).toBeHidden();

    await page.getByRole('button', { name: 'Revoke' }).first().click();
    await expect(page.getByText('Revoked').first()).toBeVisible();
  });

  test('shows billing packages and the credit ledger', async ({ page }) => {
    await openApp(page);
    await page.goto('/billing');
    // "Available credits" also appears in the sidebar, so scope to the page body.
    const main = page.locator('#main-content');
    await expect(main.getByText('Available credits')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Buy credits' }).first()).toBeVisible();
    await expect(page.getByText('Credit ledger')).toBeVisible();
  });
});

test.describe('authorisation', () => {
  test('hides the admin area from a normal customer', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);

    await page.goto('/admin');
    await expect(page.getByText('Administrator access required')).toBeVisible();
  });

  test.describe('as an administrator', () => {
    test.use({ storageState: ADMIN_STATE });

    test('gives an administrator the admin panel', async ({ page }) => {
      await openApp(page);
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
      await expect(page.getByText('Users').first()).toBeVisible();

      await page.getByRole('tab', { name: 'Queues' }).click();
      await expect(page.getByRole('heading', { name: 'Queues', exact: true })).toBeVisible();

      await page.getByRole('tab', { name: 'System health' }).click();
      await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
    });
  });
});

test.describe('browser console hygiene', () => {
  test('every main route renders without console errors or broken assets', async ({ page }) => {
    const watcher = watchConsole(page);
    await openApp(page);

    for (const route of MAIN_ROUTES) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
    }

    expect(watcher.errors, `console errors:\n${watcher.errors.join('\n')}`).toEqual([]);
    expect(
      watcher.failedRequests,
      `failed requests:\n${watcher.failedRequests.join('\n')}`,
    ).toEqual([]);
  });

  test('shows a friendly 404 page for an unknown route', async ({ page }) => {
    await openApp(page);
    await page.goto('/this-route-does-not-exist');
    await expect(page.getByText('Page not found')).toBeVisible();
  });
});
