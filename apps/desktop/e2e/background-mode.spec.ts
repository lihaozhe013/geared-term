import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

const require = createRequire(import.meta.url);
const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

let session: AppSession;

test.afterEach(async () => {
  if (!session) return;
  const { userDataDirectory } = session;
  try {
    await session.close();
  } catch {
    // The app already exited (background-mode-off quit path); Playwright's
    // app.close() rejects in that case, so clean up the profile manually.
    await fs.rm(userDataDirectory, { recursive: true, force: true });
  }
  session = undefined as unknown as AppSession;
});

async function closeMainWindow(): Promise<void> {
  await session.page.locator('.window-control-close').click();
}

test('keeps the process resident and restores the window when the app relaunches', async () => {
  test.skip(process.platform === 'darwin', 'Background tray flow is Windows/Linux behavior');
  session = await launchApp();
  const { app, page } = session;

  // Fresh installs default to background mode.
  const settings = await page.evaluate(() =>
    (
      window as unknown as {
        geared: { getSettings: () => Promise<{ keepRunningInBackground: boolean }> };
      }
    ).geared.getSettings()
  );
  expect(settings.keepRunningInBackground).toBe(true);

  await closeMainWindow();
  await expect(
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
  ).resolves.toBe(false);
  const electronProcess = app.process();
  expect(electronProcess.exitCode).toBeNull();

  // A second launch of the same profile must hand off to the resident
  // instance, which re-shows the hidden window.
  const electronBinary = require('electron') as unknown as string;
  const secondInstance = spawn(electronBinary, [appDirectory], {
    stdio: 'ignore',
    env: {
      ...process.env,
      GEARED_USER_DATA: join(session.userDataDirectory, 'user-data')
    }
  });
  const secondExit = new Promise<number | null>((resolve) => {
    secondInstance.on('exit', (code) => resolve(code));
  });
  expect(await secondExit).toBe(0);
  await expect
    .poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
      { timeout: 10_000 }
    )
    .toBe(true);
});

test('quits after closing the window when background mode is disabled', async () => {
  test.skip(process.platform === 'darwin', 'Background tray flow is Windows/Linux behavior');
  session = await launchApp();
  const { app, page } = session;

  await page.evaluate(async () => {
    const geared = (
      window as unknown as {
        geared: {
          getSettings: () => Promise<Record<string, unknown>>;
          saveSettings: (input: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).geared;
    const current = await geared.getSettings();
    await geared.saveSettings({ ...current, keepRunningInBackground: false });
  });

  const electronProcess = app.process();
  await closeMainWindow();
  await expect
    .poll(() => electronProcess.exitCode ?? electronProcess.signalCode, { timeout: 10_000 })
    .not.toBeNull();
});
