import { expect, test } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session.close();
});

test('wires navigation prevention onto the main window', async () => {
  const listenerCount = await session.app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return window ? window.webContents.listenerCount('will-navigate') : 0;
  });
  expect(listenerCount).toBeGreaterThan(0);
});

test('denies window.open popups from the renderer', async () => {
  const { app, page } = session;
  // A real shell.openExternal spawns xdg-open on headless Linux; it inherits
  // the app's stdio pipes and keeps Playwright's app.close() from seeing
  // process exit. The popup denial itself is the behavior under test.
  await app.evaluate(({ shell }) => {
    shell.openExternal = async () => undefined;
  });
  const opened = await page.evaluate(() =>
    window.open('https://example.com/popup', '_blank', 'noopener')
  );
  expect(opened).toBeNull();
  await expect(page.locator('.titlebar-app')).toHaveText('Geared Term');
});
