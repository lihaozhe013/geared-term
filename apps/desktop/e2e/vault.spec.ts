import { expect, test, type Locator } from '@playwright/test';
import { E2E_MASTER_PASSWORD, launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session.close();
});

async function openSshProfileEditor(page: AppSession['page']): Promise<Locator> {
  await page.getByRole('button', { name: 'New session profile' }).click();
  const dialog = page.locator('.profile-editor');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Kind').selectOption('ssh');
  await expect(dialog.locator('.vault-box')).toBeVisible();
  return dialog;
}

test('gates the workspace, rejects wrong passwords, and unlocks with the master password', async () => {
  const { page } = session;
  const dialog = await openSshProfileEditor(page);
  const vault = dialog.locator('.vault-box');
  await expect(vault).toContainText('Unlocked for this session');

  await vault.getByRole('button', { name: 'Lock' }).click();
  const gate = page.locator('.vault-gate');
  await expect(gate).toBeVisible();
  await expect(vault).toContainText('Locked');

  await gate.locator('.vault-gate-password').fill('definitely-wrong');
  await gate.locator('.vault-gate-submit').click();
  await expect(gate.locator('.status-error')).toBeVisible();

  await gate.locator('.vault-gate-password').fill(E2E_MASTER_PASSWORD);
  await gate.locator('.vault-gate-submit').click();
  await expect(gate).toHaveCount(0);
  await expect(vault).toContainText('Unlocked for this session');
});

test('rotates the vault password and the gate accepts only the new one', async () => {
  const { page } = session;
  const dialog = await openSshProfileEditor(page);
  const vault = dialog.locator('.vault-box');

  await vault.getByPlaceholder('Current password').fill(E2E_MASTER_PASSWORD);
  await vault.getByPlaceholder('New password').fill('second-password');
  await vault.getByRole('button', { name: 'Change password' }).click();
  await expect(vault).toContainText('Unlocked for this session');

  await vault.getByRole('button', { name: 'Lock' }).click();
  const gate = page.locator('.vault-gate');
  await expect(gate).toBeVisible();

  await gate.locator('.vault-gate-password').fill(E2E_MASTER_PASSWORD);
  await gate.locator('.vault-gate-submit').click();
  await expect(gate.locator('.status-error')).toBeVisible();

  await gate.locator('.vault-gate-password').fill('second-password');
  await gate.locator('.vault-gate-submit').click();
  await expect(gate).toHaveCount(0);
  await expect(vault).toContainText('Unlocked for this session');
});
