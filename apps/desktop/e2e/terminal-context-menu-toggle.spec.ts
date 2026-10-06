import { expect, test, type Locator, type Page } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp(DOM_RENDERER_ARGS);
  await session.page.evaluate(async () => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, language: 'en-US', minimalMode: false });
  });
});

test.afterEach(async () => {
  await session?.close();
});

const settingLabel = 'Show terminal context menu on right-click';

function settingCheckbox(page: Page) {
  return page.getByRole('checkbox', { name: settingLabel });
}

async function savedPreference(): Promise<boolean> {
  return session.page.evaluate(
    async () => (await window.geared.getSettings()).showTerminalContextMenuOnRightClick
  );
}

async function expectNativeMenuChecked(expected: boolean): Promise<void> {
  await expect
    .poll(() =>
      session.app.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()?.getMenuItemById('terminal-context-menu-right-click')?.checked
      )
    )
    .toBe(expected);
}

async function openViewMenu(page: Page) {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  return page.getByRole('menuitemcheckbox', { name: settingLabel });
}

async function expectViewMenuChecked(page: Page, expected: boolean): Promise<void> {
  if (process.platform === 'darwin') {
    await expectNativeMenuChecked(expected);
    return;
  }
  await expect(await openViewMenu(page)).toHaveAttribute('aria-checked', String(expected));
  await page.keyboard.press('Escape');
}

async function toggleViewMenuPreference(page: Page): Promise<void> {
  if (process.platform === 'darwin') {
    await toggleNativeMenu();
    return;
  }
  await (await openViewMenu(page)).click();
}

async function toggleNativeMenu(): Promise<void> {
  await session.app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('terminal-context-menu-right-click')?.click();
  });
}

async function recordNextContextMenu(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as Window & { __lastContextMenuPrevented?: boolean };
    delete target.__lastContextMenuPrevented;
    document.addEventListener(
      'contextmenu',
      (event) => {
        window.setTimeout(() => {
          target.__lastContextMenuPrevented = event.defaultPrevented;
        }, 0);
      },
      { capture: true, once: true }
    );
  });
}

async function rightClickTerminal(host: Locator): Promise<void> {
  await host.click({ button: 'right' });
}

async function expectBrowserContextMenuSuppressed(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __lastContextMenuPrevented?: boolean }).__lastContextMenuPrevented
      )
    )
    .toBe(true);
}

test('synchronizes the right-click preference across settings, menus, restart, and terminal input', async () => {
  const { app, page } = session;
  expect(await savedPreference()).toBe(true);
  await expectNativeMenuChecked(true);

  const settingsPagePromise = app.waitForEvent('window');
  await page.evaluate(() => window.geared.openSettings('terminal'));
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForLoadState('domcontentloaded');
  await expect(settingsPage.locator('.settings-window')).toBeVisible();
  await expect(settingCheckbox(settingsPage)).toBeChecked();

  await settingCheckbox(settingsPage).click();
  await expect.poll(savedPreference).toBe(false);
  await expectNativeMenuChecked(false);
  await expectViewMenuChecked(page, false);

  await toggleNativeMenu();
  await expect.poll(savedPreference).toBe(true);
  await expect(settingCheckbox(settingsPage)).toBeChecked();
  await expectViewMenuChecked(page, true);
  await expectNativeMenuChecked(true);

  await toggleNativeMenu();
  await expect.poll(savedPreference).toBe(false);
  await expect(settingCheckbox(settingsPage)).not.toBeChecked();
  await expectNativeMenuChecked(false);
  await settingsPage.close();

  await page.bringToFront();
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const host = page.locator('.terminal-wrapper:not([hidden]) .xterm-screen');
  await host.click();
  await page.keyboard.type(
    process.platform === 'darwin'
      ? "printf 'MOUSE-READY\\r\\n'; cat -v"
      : "clear; stty raw -echo; printf '\\033[?1000h\\033[?1006h'; printf 'MOUSE-READY\\r\\n'; cat -v"
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
    'MOUSE-READY'
  );
  await page.keyboard.type('x');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText('x');

  await recordNextContextMenu(page);
  await rightClickTerminal(host);
  await expect(page.locator('.sftp-context-menu')).toHaveCount(0);
  await expectBrowserContextMenuSuppressed(page);
  if (process.platform === 'darwin') {
    await page.keyboard.type('y');
    await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText('y');
  } else {
    await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
      /\^\[\[(?:<2;\d+;\d+[Mm]|M)/,
      { timeout: 15_000 }
    );
  }

  await toggleViewMenuPreference(page);
  await expect.poll(savedPreference).toBe(true);
  await expectNativeMenuChecked(true);

  await rightClickTerminal(host);
  await expect(page.locator('.sftp-context-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  const profileDirectory = session.userDataDirectory;
  await app.close();
  session = await launchApp(DOM_RENDERER_ARGS, { userDataDirectory: profileDirectory });
  expect(await savedPreference()).toBe(true);
  await expectNativeMenuChecked(true);
});
