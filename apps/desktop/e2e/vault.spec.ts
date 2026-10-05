import { expect, test, type Page } from '@playwright/test';
import { E2E_MASTER_PASSWORD, launchApp, openSettingsWindow, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session?.close();
});

async function openSecurityTab({ page, app }: AppSession): Promise<Page> {
  return openSettingsWindow({ page, app }, 'Security & Vault');
}

test('locking from settings gates the workspace and the master password unlocks it', async () => {
  const { page } = session;
  const settingsWindow = await openSecurityTab(session);
  await settingsWindow.getByRole('button', { name: 'Lock vault' }).click();
  const gate = page.locator('.vault-gate');
  await expect(gate).toBeVisible();

  await gate.locator('.vault-gate-password').fill('definitely-wrong');
  await gate.locator('.vault-gate-submit').click();
  await expect(gate.locator('.status-error')).toBeVisible();

  await gate.locator('.vault-gate-password').fill(E2E_MASTER_PASSWORD);
  await gate.locator('.vault-gate-submit').click();
  await expect(gate).toHaveCount(0);
});

test('rotates the vault password and the gate accepts only the new one', async () => {
  const { page } = session;
  const settingsWindow = await openSecurityTab(session);
  await settingsWindow
    .locator('.settings-row', { hasText: 'Current password' })
    .locator('input')
    .fill(E2E_MASTER_PASSWORD);
  await settingsWindow
    .locator('.settings-row', { hasText: 'New password' })
    .locator('input')
    .fill('second-password');
  await settingsWindow.getByRole('button', { name: 'Change master password' }).click();
  await expect(settingsWindow.locator('.status-ok')).toBeVisible();

  await settingsWindow.getByRole('button', { name: 'Lock vault' }).click();
  const gate = page.locator('.vault-gate');
  await expect(gate).toBeVisible();

  await gate.locator('.vault-gate-password').fill(E2E_MASTER_PASSWORD);
  await gate.locator('.vault-gate-submit').click();
  await expect(gate.locator('.status-error')).toBeVisible();

  await gate.locator('.vault-gate-password').fill('second-password');
  await gate.locator('.vault-gate-submit').click();
  await expect(gate).toHaveCount(0);
});
