import { expect, test, type Page } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp(DOM_RENDERER_ARGS);
});

test.afterEach(async () => {
  await session?.close();
});

const MARKER = 'geared-custom-kbd';

async function saveKeybindings(page: Page, keybindings: Record<string, string>): Promise<void> {
  await page.evaluate((overrides) => {
    const geared = (
      window as unknown as {
        geared: {
          getSettings: () => Promise<{ keybindings: Record<string, string> } & object>;
          saveSettings: (settings: object) => Promise<unknown>;
        };
      }
    ).geared;
    return geared
      .getSettings()
      .then((settings) => geared.saveSettings({ ...settings, keybindings: overrides }));
  }, keybindings);
}

test('applies a customized copy binding to the terminal', async () => {
  const { page, app } = session;
  await saveKeybindings(page, { 'terminal.copy': 'ctrl+alt+c' });
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const host = page.locator('.terminal-wrapper:not([hidden]) .terminal-host');
  const rows = page.locator('.terminal-wrapper:not([hidden]) .xterm-rows');
  await host.click();
  await page.keyboard.type(`echo ${MARKER}`);
  await expect.poll(() => rows.textContent(), { timeout: 15_000 }).toContain(MARKER);

  await page.keyboard.press('Control+Shift+a');
  await page.keyboard.press('Control+Alt+c');
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
    .toContain('echo geared');
});

test('rebuilds menu accelerators from persisted overrides', async () => {
  const { page, app } = session;
  await saveKeybindings(page, { 'tab.close': 'ctrl+shift+u' });
  await expect
    .poll(() =>
      app.evaluate(
        ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('tab-close')?.accelerator
      )
    )
    .toBe('Ctrl+Shift+U');
});

test('records a new binding through the shortcuts settings section', async () => {
  const { page, app } = session;
  const settingsPage = app.waitForEvent('window');
  await page.evaluate(() => {
    void (
      window as unknown as {
        geared: { openSettings: (category: string) => Promise<unknown> };
      }
    ).geared.openSettings('shortcuts');
  });
  const settings = await settingsPage;

  const row = settings.locator('.settings-row', { hasText: 'Clear terminal' });
  await row.locator('.kbd-capture').click();
  await expect(row.locator('.kbd-capture')).toHaveText('Press keys…');
  await settings.keyboard.press('Control+Shift+L');
  await expect(row.locator('.kbd-capture')).toHaveText('Ctrl+Shift+L');

  await expect
    .poll(() =>
      settings.evaluate(() => {
        const geared = (
          window as unknown as {
            geared: {
              getSettings: () => Promise<{ keybindings: Record<string, string> }>;
            };
          }
        ).geared;
        return geared.getSettings().then((settings) => settings.keybindings['terminal.clear']);
      })
    )
    .toBe('ctrl+shift+l');
});
