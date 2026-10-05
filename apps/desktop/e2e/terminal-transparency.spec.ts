import { expect, test, type Locator, type Page } from '@playwright/test';
import { DOM_RENDERER_ARGS, launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.afterEach(async () => {
  await session?.close();
});

async function launchWithTranslucency(rendererArgs: readonly string[] = []): Promise<AppSession> {
  const initialSession = await launchApp(rendererArgs);
  session = initialSession;
  const userDataDirectory = initialSession.userDataDirectory;

  await initialSession.page.evaluate(async () => {
    const geared = (
      window as unknown as {
        geared: {
          getSettings: () => Promise<Record<string, unknown>>;
          saveSettings: (settings: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).geared;
    const current = await geared.getSettings();
    await geared.saveSettings({ ...current, windowEffect: 'translucent' });
  });

  await initialSession.app.close();
  session = await launchApp(rendererArgs, { userDataDirectory });
  return session;
}

async function expectTransparentBackground(element: Locator): Promise<void> {
  await expect
    .poll(() =>
      element.evaluate((node) => {
        const color = getComputedStyle(node).backgroundColor;
        const alpha = color.match(/\/\s*([\d.]+)\s*\)$/u)?.[1];
        if (alpha !== undefined) return Number(alpha);
        if (color.startsWith('rgba(')) return Number(color.slice(color.lastIndexOf(',') + 1, -1));
        return 1;
      })
    )
    .toBe(0);
}

async function checkTransparentViewport(page: Page, expectWebgl: boolean): Promise<void> {
  await openLocalTab(session.app);
  const terminal = page.locator('.terminal-wrapper:not([hidden])');
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: 30_000
  });
  await expect(terminal.locator('.xterm-viewport')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await expectTransparentBackground(terminal.locator('.xterm-scrollable-element'));

  if (expectWebgl) {
    await expect(terminal.locator('canvas.xterm-link-layer')).toBeAttached();
  } else {
    await expect(terminal.locator('.xterm-rows')).toBeAttached();
  }

  const sessionId = await terminal.getAttribute('data-session-id');
  expect(sessionId).toBeTruthy();

  if (expectWebgl) {
    const alphaEnabled = await terminal.locator('.xterm-screen canvas').evaluateAll((canvases) => {
      for (const node of canvases) {
        const context = (node as HTMLCanvasElement).getContext('webgl2');
        const lossExtension = context?.getExtension('WEBGL_lose_context');
        if (context && lossExtension) {
          const alpha = context.getContextAttributes()?.alpha ?? false;
          lossExtension.loseContext();
          return alpha;
        }
      }
      return false;
    });
    expect(alphaEnabled).toBe(true);
    await expect(terminal.locator('.xterm-rows')).toBeAttached({ timeout: 10_000 });
    await expect(terminal.locator('.xterm-viewport')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)'
    );
  }

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--gt-window-opacity', '0%');
    const checker = document.createElement('canvas');
    checker.width = 32;
    checker.height = 32;
    const context = checker.getContext('2d');
    if (!context) throw new Error('Could not create the checkerboard canvas');
    context.fillStyle = '#ff00ff';
    context.fillRect(0, 0, 16, 16);
    context.fillRect(16, 16, 16, 16);
    context.fillStyle = '#404040';
    context.fillRect(16, 0, 16, 16);
    context.fillRect(0, 16, 16, 16);
    document.body.style.backgroundImage = `url("${checker.toDataURL()}")`;
    document.body.style.backgroundRepeat = 'repeat';
    document.body.style.backgroundSize = '32px 32px';
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator('body')).toHaveCSS('background-image', /^url\("?data:image\/png/u);
  await expect(terminal.locator('.xterm-viewport')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await page.evaluate(() => {
    document.documentElement.style.removeProperty('--gt-window-opacity');
    document.body.style.removeProperty('background-image');
    document.body.style.removeProperty('background-repeat');
    document.body.style.removeProperty('background-size');
  });

  const rows = terminal.locator('.xterm-rows');
  await terminal.locator('.terminal-host').click();
  await page.keyboard.type("printf '\\033[48;2;255;0;0mGEARED_TRUE_COLOR\\033[0m'");
  await page.keyboard.press('Enter');
  await expect(rows).toContainText('GEARED_TRUE_COLOR', { timeout: 15_000 });
  await expect
    .poll(() =>
      rows
        .locator('span')
        .evaluateAll((spans) =>
          spans.some((span) => getComputedStyle(span).backgroundColor === 'rgb(255, 0, 0)')
        )
    )
    .toBe(true);

  const workspaceAlpha = async (): Promise<number> =>
    page.locator('.workspace').evaluate((element) => {
      const color = getComputedStyle(element).backgroundColor;
      const alpha = color.match(/\/\s*([\d.]+)\s*\)$/u)?.[1];
      return alpha === undefined ? 1 : Number(alpha);
    });

  await expect.poll(workspaceAlpha).toBeCloseTo(0.75);
  const settings = await page.evaluate(async () => {
    const geared = (
      window as unknown as {
        geared: {
          getSettings: () => Promise<Record<string, unknown>>;
          saveSettings: (settings: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).geared;
    const current = await geared.getSettings();
    await geared.saveSettings({
      ...current,
      theme: 'Light',
      windowBackgroundOpacityPercent: 60,
      minimalMode: true
    });
    return current;
  });
  await expect.poll(workspaceAlpha).toBeCloseTo(0.6);
  await expect(terminal).toHaveAttribute('data-session-id', sessionId!);
  await expect(terminal.locator('.xterm-viewport')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );

  await page.evaluate(async (currentSettings) => {
    const geared = (
      window as unknown as {
        geared: { saveSettings: (settings: Record<string, unknown>) => Promise<unknown> };
      }
    ).geared;
    await geared.saveSettings({
      ...currentSettings,
      theme: 'Catppuccin Mocha',
      windowBackgroundOpacityPercent: 100
    });
  }, settings);
  await expect.poll(workspaceAlpha).toBeCloseTo(1);
  await expect(terminal).toHaveAttribute('data-session-id', sessionId!);

  await openLocalTab(session.app);
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-viewport')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
}

test('keeps the default terminal background transparent with the DOM renderer', async () => {
  const { page } = await launchWithTranslucency(DOM_RENDERER_ARGS);
  await checkTransparentViewport(page, false);
});

test('keeps the default terminal background transparent with the WebGL renderer', async () => {
  const { page } = await launchWithTranslucency();
  await checkTransparentViewport(page, true);
});

test('preserves the theme background when window translucency is disabled', async () => {
  session = await launchApp(DOM_RENDERER_ARGS);
  const userDataDirectory = session.userDataDirectory;
  await session.page.evaluate(async () => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, windowEffect: 'solid' });
  });
  await session.app.close();
  session = await launchApp(DOM_RENDERER_ARGS, { userDataDirectory });
  await openLocalTab(session.app);
  const terminal = session.page.locator('.terminal-wrapper:not([hidden])');
  await expect(session.page.locator('.terminal-surface')).toHaveAttribute(
    'data-active-status',
    'running',
    { timeout: 30_000 }
  );
  await expect(terminal.locator('.xterm-viewport')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(terminal.locator('.xterm-scrollable-element')).toHaveCSS(
    'background-color',
    'rgb(38, 38, 36)'
  );
});
