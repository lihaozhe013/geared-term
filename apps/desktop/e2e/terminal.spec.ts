import { expect, test } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  // This spec reads terminal output from the DOM renderer's .xterm-rows text;
  // the WebGL renderer paints to a canvas, so force the fallback for it.
  session = await launchApp(DOM_RENDERER_ARGS);
});

test.afterEach(async () => {
  await session?.close();
});

async function waitForRunning(page: AppSession['page']): Promise<void> {
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
}

function activeTerminal(page: AppSession['page']) {
  return page.locator('.terminal-wrapper:not([hidden]) .xterm-rows');
}

function activeTerminalHost(page: AppSession['page']) {
  return page.locator('.terminal-wrapper:not([hidden]) .terminal-host');
}

function terminalRows(page: AppSession['page']) {
  return page.locator('.terminal-wrapper:not([hidden]) .xterm-rows > div');
}

function lastNonEmptyRowIndex(rows: string[]): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rows[index]?.trim()) return index;
  }
  return -1;
}

// Scope to the terminal tab bar: the sidebar switcher also exposes tabs.
function terminalTabs(page: AppSession['page']) {
  return page.getByRole('tablist', { name: 'Terminal tabs' }).getByRole('tab');
}

async function newLocalTabViaMenu(session: AppSession): Promise<void> {
  await openLocalTab(session.app);
}

async function expectCommandOnPromptRow(page: AppSession['page'], marker: string): Promise<void> {
  const rows = terminalRows(page);
  await expect
    .poll(async () => {
      const contents = await rows.allTextContents();
      return (
        [...contents]
          .reverse()
          .find((row) => row.trim().length > 0)
          ?.trim() ?? ''
      );
    })
    .toMatch(/>$/u);
  const promptRow = lastNonEmptyRowIndex(await rows.allTextContents());

  await activeTerminalHost(page).click();
  await page.keyboard.type(`echo ${marker}`);
  await expect
    .poll(async () => (await rows.allTextContents()).findIndex((row) => row.includes(marker)))
    .toBe(promptRow);

  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await rows.allTextContents()).filter((row) => row.includes(marker)).length)
    .toBeGreaterThanOrEqual(2);
}

test('runs a local shell and echoes typed commands', async () => {
  const { page } = session;
  await newLocalTabViaMenu(session);
  await waitForRunning(page);
  await activeTerminalHost(page).click();
  await page.keyboard.type('echo geared-e2e-marker');
  await page.keyboard.press('Enter');
  await expect(activeTerminal(page)).toContainText('geared-e2e-marker', { timeout: 15_000 });
});

test('keeps Windows cmd input aligned with its prompt after resize and tab switching', async () => {
  const { page, app } = session;
  test.skip((await page.evaluate(() => window.geared.platform)) !== 'win32');

  await page.getByRole('button', { name: /New session profile|新建会话配置/u }).click();
  await page.getByRole('menuitem', { name: /New local session|新建本地会话/u }).click();
  const editor = page.getByRole('dialog', { name: 'Session profile editor' });
  await editor.getByLabel(/Name|名称/u).fill('Cursor alignment cmd');
  await editor.getByLabel(/Shell executable|Shell 可执行文件/u).fill('cmd.exe');
  await editor.getByLabel(/Arguments|参数/u).fill('/d');
  await editor.getByRole('button', { name: /Save profile|保存配置/u }).click();
  await expect(editor).toHaveCount(0);
  await page.locator('.profile-button').filter({ hasText: 'Cursor alignment cmd' }).click();
  await waitForRunning(page);

  await expectCommandOnPromptRow(page, 'geared-before-resize');

  const host = activeTerminalHost(page);
  const initialWidth = await host.evaluate((element) => element.clientWidth);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.setSize(1320, 900));
  await expect.poll(() => host.evaluate((element) => element.clientWidth)).not.toBe(initialWidth);
  await expectCommandOnPromptRow(page, 'geared-after-resize');

  await newLocalTabViaMenu(session);
  await waitForRunning(page);
  const cmdTab = terminalTabs(page).nth(0);
  await cmdTab.click();
  await expect(cmdTab).toHaveAttribute('aria-selected', 'true');
  await expectCommandOnPromptRow(page, 'geared-after-tab-switch');
});

test('closes the tab automatically when the shell exits', async () => {
  const { page } = session;
  await newLocalTabViaMenu(session);
  await waitForRunning(page);
  await newLocalTabViaMenu(session);
  await expect(terminalTabs(page)).toHaveCount(2);
  await activeTerminalHost(page).click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(terminalTabs(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running');

  await activeTerminalHost(page).click();
  await page.keyboard.type('exit');
  await page.keyboard.press('Enter');
  await expect(terminalTabs(page)).toHaveCount(0, { timeout: 15_000 });

  await newLocalTabViaMenu(session);
  await expect(terminalTabs(page)).toHaveCount(1);
  await waitForRunning(page);
});

test('opens, switches, and closes terminal tabs in isolation', async () => {
  const { page } = session;
  await newLocalTabViaMenu(session);
  await waitForRunning(page);
  await newLocalTabViaMenu(session);
  await expect(terminalTabs(page)).toHaveCount(2);
  await expect(page.locator('.terminal-wrapper:not([hidden])')).toHaveCount(1);

  const tabs = terminalTabs(page);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

  await activeTerminalHost(page).click();
  await page.keyboard.type('echo second-tab-marker');
  await page.keyboard.press('Enter');
  await expect(activeTerminal(page)).toContainText('second-tab-marker', { timeout: 15_000 });

  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running');
  await expect(activeTerminal(page)).not.toContainText('second-tab-marker');

  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.locator('.terminal-tab.active .tab-close').click();
  await expect(terminalTabs(page)).toHaveCount(1);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running');
});

test('starts with no tabs and supports closing the last one', async () => {
  const { page } = session;
  await expect(terminalTabs(page)).toHaveCount(0);
  await expect(page.locator('.terminal-empty')).toBeVisible();

  await page.getByRole('button', { name: 'New local terminal' }).click();
  await waitForRunning(page);
  await expect(terminalTabs(page)).toHaveCount(1);

  await page.locator('.terminal-tab.active .tab-close').click();
  await expect(terminalTabs(page)).toHaveCount(0);
  await expect(page.locator('.terminal-empty')).toBeVisible();
});
