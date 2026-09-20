import { expect, test } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.afterEach(async () => {
  await session?.close();
});

async function openRunningTerminal(args?: readonly string[]): Promise<AppSession> {
  session = await launchApp(args);
  await openLocalTab(session.app);
  await expect(session.page.locator('.statusbar-state')).toHaveText('Running', {
    timeout: 30_000
  });
  return session;
}

test('renders terminals with the WebGL renderer by default', async () => {
  const { page } = await openRunningTerminal();
  const screen = page.locator('.terminal-wrapper:not([hidden]) .xterm-screen');
  // The WebGL renderer owns the screen (canvas layers); the DOM renderer's
  // row spans must be gone, otherwise box-drawing glyphs would still be
  // font-shaped and break across rows at lineHeight > 1.
  await expect(screen.locator('canvas.xterm-link-layer')).toBeAttached();
  await expect(screen.locator('.xterm-rows')).toHaveCount(0);
});

test('falls back to the DOM renderer when WebGL is unavailable', async () => {
  const { page } = await openRunningTerminal(DOM_RENDERER_ARGS);
  const rows = page.locator('.terminal-wrapper:not([hidden]) .xterm-rows');
  await expect(rows).toBeAttached();
  await page.locator('.terminal-wrapper:not([hidden]) .terminal-host').click();
  await page.keyboard.type('echo geared-webgl-fallback\r');
  await expect(rows).toContainText('geared-webgl-fallback', { timeout: 15_000 });
});
