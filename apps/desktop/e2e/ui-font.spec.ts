import { expect, test } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeAll(async () => {
  // The spec reads the terminal font off the DOM renderer's .xterm-rows, the
  // only place xterm exposes it as CSS; force the DOM fallback renderer.
  session = await launchApp(DOM_RENDERER_ARGS);
  await openLocalTab(session.app);
  await expect(session.page.locator('.statusbar-state')).toHaveText('Running', {
    timeout: 30_000
  });
});

test.afterAll(async () => {
  await session.app.close();
});

async function setUiFontSize(size: number): Promise<void> {
  await session.page.evaluate(async (next) => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, uiFontSize: next });
  }, size);
}

function computed(selector: string, prop: 'fontSize' | 'height'): Promise<number> {
  return session.page.evaluate(
    ([sel, cssProp]) => {
      const el = document.querySelector(sel);
      return el ? parseFloat(getComputedStyle(el)[cssProp as 'fontSize' | 'height']) : -1;
    },
    [selector, prop] as const
  );
}

test('UI font size scales interface text and the chrome around it', async () => {
  await setUiFontSize(13);
  const base = {
    statusbarFont: await computed('.statusbar', 'fontSize'),
    titlebarAppFont: await computed('.titlebar-app', 'fontSize'),
    tabFont: await computed('.terminal-tab span', 'fontSize'),
    statusbarRow: await computed('.statusbar', 'height'),
    titlebarRow: await computed('.titlebar', 'height'),
    xtermFont: await computed('.terminal-wrapper:not([hidden]) .xterm-rows', 'fontSize')
  };

  await setUiFontSize(20);
  await expect
    .poll(() => computed('.statusbar', 'fontSize'), { timeout: 10_000 })
    .toBeGreaterThan(base.statusbarFont + 4);

  const large = {
    statusbarFont: await computed('.statusbar', 'fontSize'),
    titlebarAppFont: await computed('.titlebar-app', 'fontSize'),
    tabFont: await computed('.terminal-tab span', 'fontSize'),
    statusbarRow: await computed('.statusbar', 'height'),
    titlebarRow: await computed('.titlebar', 'height'),
    xtermFont: await computed('.terminal-wrapper:not([hidden]) .xterm-rows', 'fontSize')
  };

  expect(large.titlebarAppFont).toBeGreaterThan(base.titlebarAppFont + 4);
  expect(large.tabFont).toBeGreaterThan(base.tabFont + 4);
  expect(large.statusbarRow).toBeGreaterThan(base.statusbarRow + 8);
  expect(large.titlebarRow).toBeGreaterThan(base.titlebarRow + 16);
  // The terminal keeps its own font size setting.
  expect(large.xtermFont).toBeCloseTo(base.xtermFont, 1);
});

test('enlarged chrome shows no vertically clipped text', async () => {
  await setUiFontSize(24);
  await expect
    .poll(() => computed('.statusbar', 'fontSize'), { timeout: 10_000 })
    .toBeGreaterThan(15);
  const clipped = await session.page.evaluate(() => {
    const result: string[] = [];
    for (const selector of ['.statusbar', '.titlebar', '.tab-bar', '.terminal-tab span']) {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el && el.scrollHeight > el.clientHeight + 1) result.push(selector);
    }
    return result;
  });
  expect(clipped).toEqual([]);
  await setUiFontSize(13);
});
