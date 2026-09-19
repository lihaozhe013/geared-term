import { expect, test } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session.close();
});

test('opens the settings window with category navigation', async () => {
  const { page, app } = session;
  await page.getByRole('button', { name: 'Settings' }).click();
  const settingsWindow = await app.waitForEvent('window');
  await settingsWindow.waitForLoadState('domcontentloaded');
  await expect(settingsWindow.locator('.settings-nav')).toBeVisible();
  await expect(settingsWindow.getByRole('heading', { name: 'General' })).toBeVisible();
  await settingsWindow.getByRole('button', { name: 'Appearance' }).click();
  await expect(settingsWindow.getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await settingsWindow.getByRole('button', { name: 'AI Connections' }).click();
  await expect(settingsWindow.getByRole('heading', { name: 'New connection' })).toBeVisible();
  await settingsWindow.getByRole('button', { name: 'Security & Vault' }).click();
  await expect(settingsWindow.getByRole('heading', { name: 'Security & Vault' })).toBeVisible();
  await settingsWindow.getByRole('button', { name: 'About' }).click();
  await expect(settingsWindow.getByRole('heading', { name: 'About' })).toBeVisible();
  await settingsWindow.close();
});

test('opens and cancels the temporary SSH dialog', async () => {
  const { page } = session;
  await page.getByRole('button', { name: '+ Temporary SSH connection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect with SSH' });
  await expect(dialog).toBeVisible();
  await dialog.locator('button[data-modal-cancel]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('opens the profile editor and reveals the vault box for SSH profiles', async () => {
  const { page } = session;
  await page.getByRole('button', { name: '+ New saved profile' }).click();
  const dialog = page.locator('.profile-editor');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.vault-box')).toHaveCount(0);
  await dialog.getByLabel('Kind').selectOption('ssh');
  await expect(dialog.locator('.vault-box')).toHaveCount(1);
  await expect(dialog.locator('.vault-box')).toContainText('Credential vault');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.profile-editor')).toHaveCount(0);
});
