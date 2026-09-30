import { expect, test, type Page } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp(DOM_RENDERER_ARGS);
  await session.page.evaluate(async () => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, language: 'en-US' });
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

test('synchronizes the right-click preference across settings, menus, restart, and TUI input', async () => {
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
  const disabledItem = await openViewMenu(page);
  await expect(disabledItem).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  await toggleNativeMenu();
  await expect.poll(savedPreference).toBe(true);
  await expect(settingCheckbox(settingsPage)).toBeChecked();
  const enabledItem = await openViewMenu(page);
  await expect(enabledItem).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
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
    "clear; stty raw -echo; printf $'\\e[?1000h\\e[?1006h'; printf 'MOUSE-READY\\r\\n'; cat -v"
  );
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
    'MOUSE-READY'
  );
  await page.keyboard.type('x');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText('x');

  await recordNextContextMenu(page);
  await host.click({ button: 'right' });
  await expect(page.locator('.sftp-context-menu')).toHaveCount(0);
  await expectBrowserContextMenuSuppressed(page);
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
    /\^\[\[(?:<2;\d+;\d+[Mm]|M)/,
    { timeout: 15_000 }
  );

  const viewItem = await openViewMenu(page);
  await viewItem.click();
  await expect.poll(savedPreference).toBe(true);
  await expectNativeMenuChecked(true);

  await host.click({ button: 'right' });
  await expect(page.locator('.sftp-context-menu')).toBeVisible();
  await page.keyboard.press('Escape');

  const profileDirectory = session.userDataDirectory;
  await app.close();
  session = await launchApp(DOM_RENDERER_ARGS, { userDataDirectory: profileDirectory });
  expect(await savedPreference()).toBe(true);
  await expectNativeMenuChecked(true);
});
