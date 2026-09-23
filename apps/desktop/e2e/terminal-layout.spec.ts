import { expect, test } from '@playwright/test';
import { launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeAll(async () => {
  session = await launchApp();
  await openLocalTab(session.app);
  await expect(session.page.locator('.terminal-surface')).toHaveAttribute(
    'data-active-status',
    'running',
    { timeout: 30_000 }
  );
});

test.afterAll(async () => {
  await session.app.close();
});

async function setTerminalPadding(padding: number): Promise<void> {
  await session.page.evaluate(async (next) => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, terminalPadding: next });
  }, padding);
}

type Geometry = { padding: number; insetLeft: number; insetTop: number };

function measure(): Promise<Geometry> {
  return session.page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>('.terminal-surface');
    const host = document.querySelector<HTMLElement>(
      '.terminal-wrapper:not([hidden]) .terminal-host'
    );
    if (!surface || !host) return { padding: -1, insetLeft: -1, insetTop: -1 };
    const surfaceRect = surface.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      padding: parseFloat(getComputedStyle(surface).paddingLeft),
      insetLeft: hostRect.left - surfaceRect.left,
      insetTop: hostRect.top - surfaceRect.top
    };
  });
}

test('terminal fills the workspace edge to edge by default', async () => {
  const geometry = await measure();
  expect(geometry.padding).toBe(0);
  expect(geometry.insetLeft).toBeCloseTo(0, 0);
  expect(geometry.insetTop).toBeCloseTo(0, 0);
});

test('terminal padding setting insets the terminal surface', async () => {
  await setTerminalPadding(12);
  await expect.poll(async () => (await measure()).padding, { timeout: 10_000 }).toBe(12);
  const geometry = await measure();
  expect(geometry.insetLeft).toBeCloseTo(12, 0);
  expect(geometry.insetTop).toBeCloseTo(12, 0);
  await setTerminalPadding(0);
});
