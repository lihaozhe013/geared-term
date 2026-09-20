import { expect, test } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session.close();
});

async function waitForRunning(page: AppSession['page']): Promise<void> {
  await expect(page.locator('.statusbar-state')).toHaveText('Running', { timeout: 30_000 });
}

function activeTerminal(page: AppSession['page']) {
  return page.locator('.terminal-wrapper:not([hidden]) .xterm-rows');
}

function activeTerminalHost(page: AppSession['page']) {
  return page.locator('.terminal-wrapper:not([hidden]) .terminal-host');
}

function newLocalTabViaMenu(session: AppSession): Promise<void> {
  return session.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('new-local')?.click();
  });
}

test('runs a local shell and echoes typed commands', async () => {
  const { page } = session;
  await waitForRunning(page);
  await activeTerminalHost(page).click();
  await page.keyboard.type('echo geared-e2e-marker');
  await page.keyboard.press('Enter');
  await expect(activeTerminal(page)).toContainText('geared-e2e-marker', { timeout: 15_000 });
});

test('closes the tab automatically when the shell exits', async () => {
  const { page } = session;
  await waitForRunning(page);
  await newLocalTabViaMenu(session);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await activeTerminalHost(page).click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.statusbar-state')).toHaveText('Running');

  await activeTerminalHost(page).click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab')).toHaveCount(0, { timeout: 15_000 });

  await newLocalTabViaMenu(session);
  await expect(page.getByRole('tab')).toHaveCount(1);
  await waitForRunning(page);
});

test('opens, switches, and closes terminal tabs in isolation', async () => {
  const { page } = session;
  await waitForRunning(page);
  await newLocalTabViaMenu(session);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.terminal-wrapper:not([hidden])')).toHaveCount(1);

  const tabs = page.getByRole('tab');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

  await activeTerminalHost(page).click();
  await page.keyboard.type('echo second-tab-marker');
  await page.keyboard.press('Enter');
  await expect(activeTerminal(page)).toContainText('second-tab-marker', { timeout: 15_000 });

  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.statusbar-state')).toHaveText('Running');
  await expect(activeTerminal(page)).not.toContainText('second-tab-marker');

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Close Local Shell' }).nth(1).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.statusbar-state')).toHaveText('Running');
});
