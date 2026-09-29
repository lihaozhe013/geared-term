import { expect, test } from '@playwright/test';
import { startControlledServer, type ControlledServer } from '../src/main/ssh/controlled-server';
import { DOM_RENDERER_ARGS, launchApp, type AppSession } from './fixtures';

let session: AppSession;
let firstServer: ControlledServer;
let secondServer: ControlledServer;

test.beforeEach(async () => {
  firstServer = await startControlledServer();
  secondServer = await startControlledServer();
  session = await launchApp(DOM_RENDERER_ARGS);
});

test.afterEach(async () => {
  await session?.close();
  await Promise.all([firstServer?.close(), secondServer?.close()]);
});

const terminalTabs = (page: AppSession['page']) =>
  page.getByRole('tablist', { name: 'Terminal tabs' }).getByRole('tab');

async function chooseLanguage(app: AppSession['app'], label: string): Promise<void> {
  await app.evaluate(({ Menu }, languageLabel) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) throw new Error('Application menu is unavailable');
    const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
      for (const item of items) {
        if (item.label === languageLabel) return item;
        const nested = item.submenu ? find(item.submenu.items) : undefined;
        if (nested) return nested;
      }
      return undefined;
    };
    const item = find(menu.items);
    if (!item) throw new Error(`Language menu item is unavailable: ${languageLabel}`);
    item.click();
  }, label);
}

async function connectQuickSsh(app: AppSession['app'], page: AppSession['page'], port: number) {
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById('quick-ssh')?.click()
  );
  const dialog = page.getByRole('dialog', { name: /Connect with SSH|通过 SSH 连接/u });
  await dialog.getByLabel(/Host|主机/u).fill('127.0.0.1');
  await dialog.getByLabel(/Port|端口/u).fill(String(port));
  await dialog.getByLabel(/User|用户/u).fill('tester');
  await dialog.getByLabel(/Password|密码/u).fill('geared-secret');
  const hostKeyApproval = page.waitForEvent('dialog');
  await dialog.getByRole('button', { name: /Connect|连接/u }).click();
  const prompt = await hostKeyApproval;
  await prompt.accept();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running');
}

test('retains SSH failures in background tabs and localizes the visible notice', async () => {
  const { app, page } = session;

  await connectQuickSsh(app, page, firstServer.port);
  await connectQuickSsh(app, page, secondServer.port);
  await expect(terminalTabs(page)).toHaveCount(2);
  await chooseLanguage(app, '简体中文');

  firstServer.dropConnections('abrupt');
  const firstTab = terminalTabs(page).nth(0);
  await expect(firstTab).toHaveAttribute('aria-label', /SSH 连接错误/u, { timeout: 10_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);

  await firstTab.click();
  const notice = page.getByRole('alert');
  await expect(notice).toContainText('SSH 连接异常结束');
  await expect(notice).toContainText('SSH 连接已中断');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText('ready');

  await chooseLanguage(app, 'English');
  await expect(notice).toContainText('SSH connection ended unexpectedly');
  await expect(notice).toContainText('The SSH connection was lost.');

  await secondServer.dropConnections('abrupt');
  const secondTab = terminalTabs(page).nth(1);
  await expect(secondTab).toHaveAttribute('aria-label', /SSH connection error/u, {
    timeout: 10_000
  });
  await secondTab.click();
  await expect(page.getByRole('alert')).toContainText('The SSH connection was lost.');
  await page.getByRole('alert').getByRole('button', { name: 'Close' }).click();
  await expect(terminalTabs(page)).toHaveCount(1);
});
