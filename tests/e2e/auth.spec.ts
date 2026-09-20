import { ANONYMOUS_STATE, DEMO_USER, expect, login, test } from './fixtures';

test.describe('authentication', () => {
  // These specs exercise sign-in itself, so they must start signed out.
  test.use({ storageState: ANONYMOUS_STATE });

  test('redirects an anonymous visitor to the sign-in page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('shows a clear error for wrong credentials and keeps the user on the page', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DEMO_USER.email);
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByTestId('form-error')).toContainText(/incorrect/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test('signs in, lands on the dashboard, and signs out again', async ({ page }) => {
    await login(page);

    await expect(page.getByText('Total URLs')).toBeVisible();

    await page.getByTestId('profile-menu').click();
    await page.getByTestId('logout-button').click();

    await page.waitForURL('**/login', { timeout: 20_000 });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('validates the registration form before submitting', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
  });

  test('offers a password reset flow that never reveals whether an email exists', async ({
    page,
  }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('nobody-here@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/if that email is registered/i)).toBeVisible();
  });
});
