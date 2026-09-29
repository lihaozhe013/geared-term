import { expect, test } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session?.close();
});

test('groups built-in themes in settings and both menus, then persists the selected theme', async () => {
  const { app, page } = session;
  const nativeGroups = await app.evaluate(({ Menu }) => {
    const view = Menu.getApplicationMenu()?.items.find((item) => item.label === 'View');
    const theme = view?.submenu?.items.find((item) => item.label === 'Theme');
    return theme?.submenu?.items.map((group) => ({
      label: group.label,
      themes: group.submenu?.items.map((item) => item.label) ?? []
    }));
  });
  expect(nativeGroups?.find((group) => group.label === 'Tokyo Night')?.themes).toEqual([
    'Tokyo Night',
    'Tokyo Night Storm',
    'Tokyo Night Light'
  ]);

  await page.getByRole('button', { name: 'Settings' }).click();
  const settingsWindow = await app.waitForEvent('window');
  await settingsWindow.waitForLoadState('domcontentloaded');
  await settingsWindow.getByRole('button', { name: 'Appearance' }).click();
  const themePicker = settingsWindow.locator('.settings-select').first();
  await expect(themePicker.locator('option')).toHaveCount(34);
  await expect(themePicker.locator('optgroup[label="Tokyo Night"] option')).toHaveCount(3);
  await themePicker.selectOption('Tokyo Night Light');
  await settingsWindow.close();

  if (process.platform === 'darwin') {
    test.skip(true, 'macOS uses the native application menu instead of the virtual menu');
  }

  await page.setViewportSize({ width: 500, height: 520 });
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).click();
  await expect(page.locator('[data-desktop-menu-flyout]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.desktop-menu-popover')).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
  await page.getByRole('menuitem', { name: 'Geared' }).hover();
  await page.getByRole('menuitemradio', { name: 'Geared Dark' }).click();
  await expect
    .poll(() =>
      page.locator('html').evaluate((node) => node.style.getPropertyValue('--gt-background'))
    )
    .toBe('#0d1117');

  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
  await page.getByRole('menuitem', { name: 'Geared' }).hover();
  await expect(page.getByRole('menuitemradio', { name: 'Geared Dark' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await page.keyboard.press('Escape');

  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.getByRole('menuitem', { name: 'Theme' }).hover();
  await expect(page.locator('[data-desktop-menu-path="view/themes"]')).toHaveClass(
    /desktop-menu-popover-flipped/
  );
  await page.getByRole('menuitem', { name: 'Claude' }).hover();
  const claudeMenu = page.locator('[data-desktop-menu-path="view/themes/theme-family-claude"]');
  await expect(claudeMenu).toBeVisible();
  const claudeBounds = await claudeMenu.evaluate((element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { left, right, top, bottom, width: innerWidth, height: innerHeight };
  });
  expect(claudeBounds.left).toBeGreaterThanOrEqual(0);
  expect(claudeBounds.right).toBeLessThanOrEqual(claudeBounds.width);
  expect(claudeBounds.top).toBeGreaterThanOrEqual(0);
  expect(claudeBounds.bottom).toBeLessThanOrEqual(claudeBounds.height);
  await page.getByRole('menuitemradio', { name: 'Claude Light' }).click();
  await expect
    .poll(() =>
      page.locator('html').evaluate((node) => node.style.getPropertyValue('--gt-background'))
    )
    .toBe('#faf9f5');

  await page.getByRole('button', { name: 'Settings' }).click();
  const reopenedSettings = await app.waitForEvent('window');
  await reopenedSettings.waitForLoadState('domcontentloaded');
  await reopenedSettings.getByRole('button', { name: 'Appearance' }).click();
  await expect(reopenedSettings.locator('.settings-select').first()).toHaveValue('Claude Light');
});
