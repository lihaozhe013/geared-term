import { expect, test } from '@playwright/test';
import { launchApp, openSettingsWindow, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session?.close();
});

test('shows the project defaults and enables password-free unlock when supported', async () => {
  const { page } = session;
  await page.evaluate(async () => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, language: 'en-US' });
  });
  const settings = await page.evaluate(() => window.geared.getSettings());
  expect(settings).toMatchObject({
    theme: 'Claude Dark',
    splitCommandPresentation: true,
    allowRiskyRun: true,
    keepRunningInBackground: true,
    minimalMode: true,
    windowEffect: 'frosted',
    windowBackgroundOpacityPercent: 75
  });

  const autoUnlock = await page.evaluate(() => window.geared.getAutoUnlockStatus());
  expect(autoUnlock.enabled).toBe(autoUnlock.supported);

  const settingsWindow = await openSettingsWindow(session, 'General');
  await expect(
    settingsWindow.getByRole('checkbox', { name: 'Show safe command blocks separately' })
  ).toBeChecked();
  await expect(
    settingsWindow.getByRole('checkbox', {
      name: 'Allow Run on risky commands (sudo, rm -rf, ...)'
    })
  ).toBeChecked();
  await expect(
    settingsWindow.getByRole('checkbox', {
      name: 'Keep sessions running after closing the window (restore from the tray or Dock)'
    })
  ).toBeChecked();

  await settingsWindow.getByRole('button', { name: 'Appearance' }).click();
  await expect(settingsWindow.getByRole('checkbox', { name: 'Minimal mode' })).toBeChecked();
  await expect(
    settingsWindow
      .locator('.settings-row')
      .filter({ hasText: 'Window background' })
      .locator('select')
  ).toHaveValue('frosted');
  await expect(
    settingsWindow
      .locator('.settings-row')
      .filter({ hasText: 'Window background opacity' })
      .locator('.stepper-value')
  ).toHaveText('75%');
  await expect(
    settingsWindow.locator('.settings-row').filter({ hasText: 'Theme' }).locator('select')
  ).toHaveValue('Claude Dark');

  await settingsWindow.getByRole('button', { name: 'Security & Vault' }).click();
  const autoUnlockCheckbox = settingsWindow.getByRole('checkbox', {
    name: 'Password-free unlock'
  });
  await expect(autoUnlockCheckbox).toHaveJSProperty('checked', autoUnlock.supported);
});
