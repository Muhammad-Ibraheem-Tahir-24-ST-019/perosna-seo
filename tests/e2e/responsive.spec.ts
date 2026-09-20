import {
  expectNoHorizontalOverflow,
  expect,
  MAIN_ROUTES,
  openApp,
  test,
  USER_STATE,
} from './fixtures';

// One captured session for the whole file; see tests/e2e/global-setup.ts.
test.use({ storageState: USER_STATE });

const WIDTHS = [
  { name: '320x568', width: 320, height: 568 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

test.describe('responsive layout', () => {
  // Each case walks every main route, so it needs more than the default budget
  // (especially against a dev server that compiles routes on first request).
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  for (const size of WIDTHS) {
    test(`no horizontal overflow at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openApp(page);

      for (const route of MAIN_ROUTES) {
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        await expectNoHorizontalOverflow(page);
      }
    });
  }

  test('URL table degrades to cards on phones and stays a table on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openApp(page);
    await page.goto('/urls');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('url-card-list')).toBeVisible();
    await expect(page.locator('table')).toBeHidden();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('table').first()).toBeVisible();
    await expect(page.getByTestId('url-card-list')).toBeHidden();
  });
});

test.describe('mobile navigation drawer', () => {
  test.use({ storageState: USER_STATE, viewport: { width: 375, height: 667 } });

  test('opens, traps focus, closes on Escape and restores body scroll', async ({ page }) => {
    await openApp(page);

    const trigger = page.getByTestId('mobile-menu-button');
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-label', 'Open navigation menu');

    // Desktop sidebar must be hidden at this width.
    await expect(page.locator('aside')).toBeHidden();

    // Radix locks scrolling via react-remove-scroll, which may use an inline
    // style, a data attribute, or a computed rule depending on version - so
    // assert the observable effect rather than one implementation detail.
    const isScrollLocked = () =>
      page.evaluate(
        () =>
          document.body.hasAttribute('data-scroll-locked') ||
          document.body.style.overflow === 'hidden' ||
          getComputedStyle(document.body).overflow === 'hidden',
      );

    expect(await isScrollLocked()).toBe(false);

    await trigger.click();
    const drawer = page.getByTestId('mobile-drawer');
    await expect(drawer).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('drawer-backdrop')).toBeVisible();

    // Focus must move into the drawer (focus trap).
    const focusInsideDrawer = await page.evaluate(() => {
      const drawerElement = document.querySelector('[data-testid="mobile-drawer"]');
      return drawerElement?.contains(document.activeElement) ?? false;
    });
    expect(focusInsideDrawer).toBe(true);

    // Body scroll is locked while the drawer is open.
    expect(await isScrollLocked()).toBe(true);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    // Body scroll is restored, and focus returns to the trigger.
    await expect.poll(isScrollLocked).toBe(false);
    await expect(trigger).toBeFocused();
  });

  test('closes when the backdrop is clicked', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('mobile-menu-button').click();
    await expect(page.getByTestId('mobile-drawer')).toBeVisible();

    // Click far from the drawer, on the backdrop.
    await page.mouse.click(360, 400);
    await expect(page.getByTestId('mobile-drawer')).toBeHidden();
  });

  test('closes after navigating to another page', async ({ page }) => {
    await openApp(page);
    await page.getByTestId('mobile-menu-button').click();
    const drawer = page.getByTestId('mobile-drawer');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('link', { name: 'Projects' }).click();
    await page.waitForURL('**/projects');
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  });

  test('every navigation entry is reachable from the drawer', async ({ page }) => {
    await openApp(page);
    for (const label of ['Dashboard', 'Projects', 'URLs', 'New submission', 'Reports', 'Billing']) {
      await page.getByTestId('mobile-menu-button').click();
      const drawer = page.getByTestId('mobile-drawer');
      await expect(drawer.getByRole('link', { name: label })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    }
  });
});

test.describe('theme', () => {
  test('switches between light and dark', async ({ page }) => {
    await openApp(page);
    const html = page.locator('html');
    const before = (await html.getAttribute('class')) ?? '';

    await page.getByRole('button', { name: 'Toggle colour theme' }).click();
    await expect
      .poll(async () => (await html.getAttribute('class')) ?? '')
      .not.toBe(before);

    const after = (await html.getAttribute('class')) ?? '';
    expect(after.includes('dark') || before.includes('dark')).toBe(true);
  });
});
