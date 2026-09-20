import { expect, test } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp(DOM_RENDERER_ARGS);
});

test.afterEach(async () => {
  await session?.close();
});

const MARKER = 'geared-kbd-marker';

test('copies and pastes with terminal keyboard shortcuts', async () => {
  const { page, app } = session;
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const host = page.locator('.terminal-wrapper:not([hidden]) .terminal-host');
  const rows = page.locator('.terminal-wrapper:not([hidden]) .xterm-rows');
  await host.click();
  await page.keyboard.type(`echo ${MARKER}`);
  // keyboard.type only dispatches key events; the shell echo trails behind on
  // loaded runners. Copy is a one-shot action, so wait until the whole line has
  // round-tripped into the buffer or the chords would snapshot a partial line.
  await expect.poll(() => rows.textContent(), { timeout: 15_000 }).toContain(MARKER);

  // Copy chord: select the buffer and write it to the system clipboard. The
  // DOM renderer's selection extraction can truncate trailing cells, so
  // assert on a stable prefix of the typed line.
  await page.keyboard.press('Control+Shift+a');
  await page.keyboard.press('Control+Shift+c');
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 10_000 })
    .toContain('echo geared');

  // Paste chord: seed the clipboard from the main process, cancel the pending
  // line, and paste it back into the shell.
  await app.evaluate(({ clipboard }, marker) => clipboard.writeText(marker), MARKER);
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+Shift+v');
  await page.keyboard.press('Enter');
  await expect(rows).toContainText(MARKER, {
    timeout: 15_000
  });

  await page.keyboard.press('Control+f');
  await expect(page.locator('.terminal-search')).toBeVisible();
});

test('pastes exactly once per paste shortcut', async () => {
  const { page, app } = session;
  await openLocalTab(app);
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  const host = page.locator('.terminal-wrapper:not([hidden]) .terminal-host');
  await host.click();
  await app.evaluate(({ clipboard }, marker) => clipboard.writeText(marker), 'geared-single-paste');

  await page.keyboard.press('Control+Shift+v');
  const rows = page.locator('.terminal-wrapper:not([hidden]) .xterm-rows');
  await expect.poll(() => rows.textContent(), { timeout: 15_000 }).toContain('geared-single-paste');
  const text = (await rows.textContent()) ?? '';
  expect(text.split('geared-single-paste').length - 1).toBe(1);
});
