import { expect, test } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp(DOM_RENDERER_ARGS);
});

test.afterEach(async () => {
  await session?.close();
});

// Accessible names include the shortcut hint (e.g. "Copy Ctrl+Shift+C"),
// so match by prefix; the app language is system-dependent.
const copyLabel = /^(Copy|复制)/;
const pasteLabel = /^(Paste|粘贴)/;
const selectAllLabel = /^(Select all|全选)/;
const searchLabel = /^(Search|搜索)/;
const clearLabel = /^(Clear|清屏)/;
const addSelectionToChatLabel = /^(Add selection to chat|添加选中内容到对话)/;
const addScreenToChatLabel = /^(Add screen snapshot to chat|添加屏幕快照到对话)/;

function activeTerminalHost(session: AppSession) {
  return session.page.locator('.terminal-wrapper:not([hidden]) .terminal-host');
}

test('offers clipboard actions in the terminal context menu', async () => {
  const { page, app } = session;
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const host = activeTerminalHost(session);
  await host.click();

  await host.click({ button: 'right' });
  const menu = page.locator('.sftp-context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: copyLabel })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: pasteLabel })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: selectAllLabel })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: searchLabel })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: clearLabel })).toBeVisible();

  await menu.getByRole('menuitem', { name: selectAllLabel }).click();
  await expect(menu).toHaveCount(0);

  await host.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: copyLabel })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await host.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: searchLabel }).click();
  await expect(page.locator('.terminal-search')).toBeVisible();
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.locator('.terminal-search')).toHaveCount(0);
});

test('pastes the system clipboard into the shell from the context menu', async () => {
  const { page, app } = session;
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  await app.evaluate(({ clipboard }) => clipboard.writeText('echo geared-context-paste'));
  const host = activeTerminalHost(session);
  await host.click();

  await host.click({ button: 'right' });
  const menu = page.locator('.sftp-context-menu');
  await menu.getByRole('menuitem', { name: pasteLabel }).click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
    'geared-context-paste',
    { timeout: 15_000 }
  );
});

test('adds the terminal selection to the assistant composer from the context menu', async () => {
  const { page, app } = session;
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const host = activeTerminalHost(session);
  await host.click();
  await page.keyboard.type('echo geared-chat-selection');
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
    'geared-chat-selection',
    { timeout: 15_000 }
  );

  await host.click({ button: 'right' });
  const menu = page.locator('.sftp-context-menu');
  await expect(menu.getByRole('menuitem', { name: addSelectionToChatLabel })).toBeDisabled();

  await menu.getByRole('menuitem', { name: selectAllLabel }).click();
  await expect(menu).toHaveCount(0);
  await host.click({ button: 'right' });
  await expect(menu.getByRole('menuitem', { name: addSelectionToChatLabel })).toBeEnabled();
  await menu.getByRole('menuitem', { name: addSelectionToChatLabel }).click();

  await expect(page.getByRole('tab', { name: /AI Assistant/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  const composer = page.locator('.assistant-composer textarea');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue(/```terminal\n[\s\S]*geared-chat-selection/);
});

test('adds the visible screen to the assistant composer from the context menu', async () => {
  const { page, app } = session;
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const host = activeTerminalHost(session);
  await host.click();
  await page.keyboard.type('echo geared-chat-screen');
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
    'geared-chat-screen',
    { timeout: 15_000 }
  );

  await host.click({ button: 'right' });
  const menu = page.locator('.sftp-context-menu');
  await menu.getByRole('menuitem', { name: addScreenToChatLabel }).click();

  await expect(page.getByRole('tab', { name: /AI Assistant/ })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  const composer = page.locator('.assistant-composer textarea');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue(/```terminal\n[\s\S]*geared-chat-screen/);
});
