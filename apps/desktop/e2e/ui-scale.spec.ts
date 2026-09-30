import { expect, test } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp(DOM_RENDERER_ARGS);
});

test.afterEach(async () => {
  await session?.close();
});

async function setScale(scale: number): Promise<void> {
  await session.page.evaluate(async (uiScalePercent) => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, uiScalePercent });
  }, scale);
}

async function metric(
  selector: string,
  property: 'height' | 'width' | 'fontSize'
): Promise<number> {
  return session.page.evaluate(
    ([query, key]) => {
      const element = document.querySelector(query);
      return element ? Number.parseFloat(getComputedStyle(element)[key]) : -1;
    },
    [selector, property] as const
  );
}

test('persists interface scale and reflows the terminal viewport without changing its font size', async () => {
  const { app, page } = session;
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  await setScale(100);

  const base = {
    titlebar: await metric('.titlebar', 'height'),
    sidebar: await metric('.sidebar-switcher', 'height'),
    terminal: await metric('.terminal-wrapper:not([hidden]) .xterm-rows', 'fontSize'),
    terminalWidth: await metric('.terminal-wrapper:not([hidden]) .terminal-host', 'width')
  };

  await setScale(150);
  await expect
    .poll(() => metric('.titlebar', 'height'), { timeout: 10_000 })
    .toBeGreaterThan(base.titlebar * 1.4);
  expect(await metric('.sidebar-switcher', 'height')).toBeGreaterThan(base.sidebar * 1.4);
  expect(await metric('.terminal-wrapper:not([hidden]) .xterm-rows', 'fontSize')).toBeCloseTo(
    base.terminal,
    1
  );
  expect(await metric('.terminal-wrapper:not([hidden]) .terminal-host', 'width')).toBeLessThan(
    base.terminalWidth
  );
  expect(await page.evaluate(async () => (await window.geared.getSettings()).uiScalePercent)).toBe(
    150
  );

  const settingsPagePromise = app.waitForEvent('window');
  await page.evaluate(() => window.geared.openSettings());
  const settingsPage = await settingsPagePromise;
  await settingsPage.waitForLoadState('domcontentloaded');
  const settingsNav = settingsPage.locator('.settings-nav-item').first();
  await expect(settingsNav).toBeVisible();
  const settingsHeight = await settingsNav.evaluate(
    (element) => element.getBoundingClientRect().height
  );
  expect(settingsHeight).toBeGreaterThan(20);

  await setScale(75);
  await expect
    .poll(() => metric('.titlebar', 'height'), { timeout: 10_000 })
    .toBeLessThan(base.titlebar * 0.85);
  expect(await metric('.terminal-wrapper:not([hidden]) .xterm-rows', 'fontSize')).toBeCloseTo(
    base.terminal,
    1
  );
  expect(await metric('.terminal-wrapper:not([hidden]) .terminal-host', 'width')).toBeGreaterThan(
    base.terminalWidth
  );
  expect(
    await settingsPage
      .locator('.settings-nav-item')
      .first()
      .evaluate((element) => element.getBoundingClientRect().height)
  ).toBeLessThan(settingsHeight);
  expect(await page.evaluate(async () => (await window.geared.getSettings()).uiScalePercent)).toBe(
    75
  );
});
