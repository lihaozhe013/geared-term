import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

const require = createRequire(import.meta.url);
const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');
const secondaryLaunchArgs = [
  appDirectory,
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--enable-unsafe-swiftshader',
  ...DOM_RENDERER_ARGS
];

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
  if (process.platform === 'darwin') {
    await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    return;
  }
  await session.page.locator('.window-control-close').click();
}

async function setBackgroundMode(enabled: boolean): Promise<void> {
  await session.page.evaluate(async (keepRunningInBackground) => {
    const geared = (
      window as unknown as {
        geared: {
          getSettings: () => Promise<Record<string, unknown>>;
          saveSettings: (input: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).geared;
    const current = await geared.getSettings();
    await geared.saveSettings({ ...current, keepRunningInBackground });
  }, enabled);
}

function spawnSecondaryInstance(): ChildProcess {
  return spawn(require('electron') as unknown as string, secondaryLaunchArgs, {
    stdio: 'ignore',
    env: {
      ...process.env,
      GEARED_USER_DATA: join(session.userDataDirectory, 'user-data')
    }
  });
}

async function waitForProcessExit(
  child: ChildProcess
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

test('keeps the process resident and restores the window when the app relaunches', async () => {
  test.skip(process.platform === 'darwin', 'Background tray flow is Windows/Linux behavior');
  session = await launchApp(DOM_RENDERER_ARGS);
  const { app, page } = session;

  // Fresh installs opt in to background mode explicitly.
  const settings = await page.evaluate(() =>
    (
      window as unknown as {
        geared: { getSettings: () => Promise<{ keepRunningInBackground: boolean }> };
      }
    ).geared.getSettings()
  );
  expect(settings.keepRunningInBackground).toBe(false);
  await setBackgroundMode(true);

  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const terminal = page.locator('.terminal-wrapper:not([hidden])');
  const sessionId = await terminal.getAttribute('data-session-id');
  expect(sessionId).toBeTruthy();
  await terminal.locator('.terminal-host').click();
  await page.keyboard.type('echo geared-background-before');
  await page.keyboard.press('Enter');
  await expect(terminal.locator('.xterm-rows')).toContainText('geared-background-before', {
    timeout: 15_000
  });

  await closeMainWindow();
  await expect
    .poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
      { timeout: 10_000 }
    )
    .toBe(false);
  const electronProcess = app.process();
  expect(electronProcess.exitCode).toBeNull();

  // A second launch of the same profile must hand off to the resident
  // instance, which re-shows the hidden window.
  const secondExit = await waitForProcessExit(spawnSecondaryInstance());
  expect(secondExit).toEqual({ code: 0, signal: null });
  await expect
    .poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
      { timeout: 10_000 }
    )
    .toBe(true);
  await expect(page.locator(`.terminal-wrapper[data-session-id="${sessionId}"]`)).toBeVisible();
  await page.locator('.terminal-wrapper:not([hidden]) .terminal-host').click();
  await page.keyboard.type('echo geared-background-after');
  await page.keyboard.press('Enter');
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
    'geared-background-after',
    { timeout: 15_000 }
  );
});

test('keeps bounded high-volume output flowing while hidden', async () => {
  test.skip(process.platform !== 'linux', 'Uses POSIX shell output tools');
  session = await launchApp(DOM_RENDERER_ARGS);
  const { app, page } = session;
  await setBackgroundMode(true);
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const terminal = page.locator('.terminal-wrapper:not([hidden])');
  await terminal.locator('.terminal-host').click();
  await page.keyboard.type(
    "yes geared-background-output | head -n 4000; printf '\\ngeared-background-after\\n'"
  );
  await page.keyboard.press('Enter');
  await closeMainWindow();
  await expect
    .poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
      { timeout: 10_000 }
    )
    .toBe(false);

  const secondExit = await waitForProcessExit(spawnSecondaryInstance());
  expect(secondExit).toEqual({ code: 0, signal: null });
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(
    'geared-background-after',
    { timeout: 20_000 }
  );
});

test('restores the hidden session when macOS activates the app from the Dock', async () => {
  test.skip(process.platform !== 'darwin', 'Dock activation is macOS-specific');
  session = await launchApp(DOM_RENDERER_ARGS);
  const { app, page } = session;
  await setBackgroundMode(true);
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const terminal = page.locator('.terminal-wrapper:not([hidden])');
  const sessionId = await terminal.getAttribute('data-session-id');
  expect(sessionId).toBeTruthy();

  await closeMainWindow();
  await expect
    .poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
      { timeout: 10_000 }
    )
    .toBe(false);

  await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
  await expect
    .poll(
      () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible()),
      { timeout: 10_000 }
    )
    .toBe(true);
  await expect(page.locator(`.terminal-wrapper[data-session-id="${sessionId}"]`)).toBeVisible();
});

test('explicitly quitting the app ends a resident background process', async () => {
  session = await launchApp();
  const { app, page } = session;
  await setBackgroundMode(true);
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });

  const electronProcess = app.process();
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  await expect
    .poll(() => electronProcess.exitCode ?? electronProcess.signalCode, { timeout: 10_000 })
    .not.toBeNull();
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
