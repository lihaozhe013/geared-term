import { expect, test } from '@playwright/test';
import { launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session?.close();
});

async function rowsLetterSpacing(page: AppSession['page']): Promise<string> {
  return page.evaluate(() => {
    const rows = document.querySelector('.terminal-wrapper:not([hidden]) .xterm-rows');
    return rows ? getComputedStyle(rows).letterSpacing : 'missing';
  });
}

test('keeps xterm letter-spacing neutralized while font ligatures are enabled', async () => {
  const { page } = session;
  await openLocalTab(session.app);
  await expect(page.locator('.statusbar-state')).toHaveText('Running', { timeout: 30_000 });

  const spacingBefore = await rowsLetterSpacing(page);
  expect(spacingBefore).not.toBe('normal');

  await page.evaluate(async () => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, terminalFontLigatures: true });
  });

  const host = page.locator('.terminal-wrapper:not([hidden]) .terminal-host');
  await expect(host).toHaveClass(/terminal-ligatures/);
  await expect.poll(() => rowsLetterSpacing(page), { timeout: 10_000 }).toBe('normal');

  await page.evaluate(async () => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, terminalFontLigatures: false });
  });
  await expect(host).not.toHaveClass(/terminal-ligatures/);
  await expect.poll(() => rowsLetterSpacing(page), { timeout: 10_000 }).not.toBe('normal');
});
