import { expect, test } from '@playwright/test';
import { launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

const DEFAULT_SHELL_PADDING = 12;
const DEFAULT_FULL_SCREEN_PADDING = 8;
const CUSTOM_SHELL_PADDING = 16;
const CUSTOM_FULL_SCREEN_PADDING = 20;

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

async function setPadding(
  field: 'terminalPadding' | 'fullScreenTerminalPadding',
  padding: number
): Promise<void> {
  await session.page.evaluate(
    async (next) => {
      const settings = await window.geared.getSettings();
      await window.geared.saveSettings({ ...settings, [next.field]: next.padding });
    },
    { field, padding }
  );
}

// `node -e` keeps the escape sequence portable across the pwsh/cmd/bash shells a
// local profile can start. The program only toggles the mode and exits, but the
// shell never leaves the alternate buffer, so the state persists at its prompt.
async function emitMode(set: 'h' | 'l'): Promise<void> {
  await session.page.locator('.terminal-wrapper:not([hidden]) .terminal-host').click();
  await session.page.keyboard.insertText(`node -e "process.stdout.write('\\u001b[?1049${set}')"`);
  await session.page.keyboard.press('Enter');
}

type Geometry = {
  alternate: boolean;
  padding: number;
  insetLeft: number;
  insetTop: number;
};

function measure(): Promise<Geometry> {
  return session.page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>('.terminal-surface');
    const host = document.querySelector<HTMLElement>(
      '.terminal-wrapper:not([hidden]) .terminal-host'
    );
    if (!surface || !host) {
      return { alternate: false, padding: -1, insetLeft: -1, insetTop: -1 };
    }
    const surfaceRect = surface.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      alternate: surface.dataset.alternateScreen === 'true',
      padding: parseFloat(getComputedStyle(surface).paddingLeft),
      insetLeft: hostRect.left - surfaceRect.left,
      insetTop: hostRect.top - surfaceRect.top
    };
  });
}

async function expectPadding(expected: number): Promise<void> {
  await expect.poll(async () => (await measure()).padding, { timeout: 10_000 }).toBe(expected);
}

test('shell prompt keeps its existing default padding', async () => {
  const geometry = await measure();
  expect(geometry.alternate).toBe(false);
  expect(geometry.padding).toBe(DEFAULT_SHELL_PADDING);
  expect(geometry.insetLeft).toBeCloseTo(DEFAULT_SHELL_PADDING, 0);
  expect(geometry.insetTop).toBeCloseTo(DEFAULT_SHELL_PADDING, 0);
});

test('full-screen programs use their own padding and restore the shell padding', async () => {
  await emitMode('h');
  await expect.poll(async () => (await measure()).alternate, { timeout: 15_000 }).toBe(true);
  await expectPadding(DEFAULT_FULL_SCREEN_PADDING);
  let fullScreen = await measure();
  expect(fullScreen.insetLeft).toBeCloseTo(DEFAULT_FULL_SCREEN_PADDING, 0);
  expect(fullScreen.insetTop).toBeCloseTo(DEFAULT_FULL_SCREEN_PADDING, 0);

  await emitMode('l');
  await expect.poll(async () => (await measure()).alternate, { timeout: 15_000 }).toBe(false);
  await expectPadding(DEFAULT_SHELL_PADDING);

  await setPadding('terminalPadding', CUSTOM_SHELL_PADDING);
  await setPadding('fullScreenTerminalPadding', CUSTOM_FULL_SCREEN_PADDING);
  await expectPadding(CUSTOM_SHELL_PADDING);
  await emitMode('h');
  await expect.poll(async () => (await measure()).alternate, { timeout: 15_000 }).toBe(true);
  await expectPadding(CUSTOM_FULL_SCREEN_PADDING);
  fullScreen = await measure();
  expect(fullScreen.insetLeft).toBeCloseTo(CUSTOM_FULL_SCREEN_PADDING, 0);
  expect(fullScreen.insetTop).toBeCloseTo(CUSTOM_FULL_SCREEN_PADDING, 0);

  await setPadding('fullScreenTerminalPadding', 0);
  await expectPadding(0);
  fullScreen = await measure();
  expect(fullScreen.insetLeft).toBeCloseTo(0, 0);
  expect(fullScreen.insetTop).toBeCloseTo(0, 0);

  await emitMode('l');
  await expect.poll(async () => (await measure()).alternate, { timeout: 15_000 }).toBe(false);
  await expectPadding(CUSTOM_SHELL_PADDING);

  await setPadding('terminalPadding', DEFAULT_SHELL_PADDING);
  await setPadding('fullScreenTerminalPadding', DEFAULT_FULL_SCREEN_PADDING);
  await expectPadding(DEFAULT_SHELL_PADDING);
});
