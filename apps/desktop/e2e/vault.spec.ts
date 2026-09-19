import { expect, test, type Locator } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session.close();
});

async function openSshProfileEditor(page: AppSession['page']): Promise<Locator> {
  await page.getByRole('button', { name: '+ New saved profile' }).click();
  const dialog = page.locator('.profile-editor');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Kind').selectOption('ssh');
  await expect(dialog.locator('.vault-box')).toBeVisible();
  return dialog;
}

test('initializes, locks, and unlocks the credential vault', async () => {
  const { page } = session;
  const dialog = await openSshProfileEditor(page);
  const vault = dialog.locator('.vault-box');

  await expect(vault).toContainText('Locked');
  await vault.getByPlaceholder('Vault password').fill('e2e-master-password');
  await vault.getByRole('button', { name: 'Initialize' }).click();
  await expect(vault).toContainText('Unlocked for this session');

  await vault.getByRole('button', { name: 'Lock' }).click();
  await expect(vault).toContainText('Locked');

  await vault.getByPlaceholder('Vault password').fill('definitely-wrong');
  await vault.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.locator('.settings-error')).toBeVisible();

  await vault.getByPlaceholder('Vault password').fill('e2e-master-password');
  await vault.getByRole('button', { name: 'Unlock' }).click();
  await expect(vault).toContainText('Unlocked for this session');
});

test('rotates the vault password and accepts only the new one', async () => {
  const { page } = session;
  const dialog = await openSshProfileEditor(page);
  const vault = dialog.locator('.vault-box');

  await vault.getByPlaceholder('Vault password').fill('first-password');
  await vault.getByRole('button', { name: 'Initialize' }).click();
  await expect(vault).toContainText('Unlocked for this session');

  await vault.getByPlaceholder('Current password').fill('first-password');
  await vault.getByPlaceholder('New password').fill('second-password');
  await vault.getByRole('button', { name: 'Change password' }).click();
  await expect(vault).toContainText('Unlocked for this session');

  await vault.getByRole('button', { name: 'Lock' }).click();
  await expect(vault).toContainText('Locked');

  await vault.getByPlaceholder('Vault password').fill('first-password');
  await vault.getByRole('button', { name: 'Unlock' }).click();
  await expect(dialog.locator('.settings-error')).toBeVisible();

  await vault.getByPlaceholder('Vault password').fill('second-password');
  await vault.getByRole('button', { name: 'Unlock' }).click();
  await expect(vault).toContainText('Unlocked for this session');
});
