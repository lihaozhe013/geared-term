import { expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

const evidenceDirectory = join(process.cwd(), 'test-results', 'panel-layout-evidence');

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session?.close();
});

type LayoutMetrics = {
  workspace: { left: number; right: number; top: number; height: number };
  terminal: { left: number; right: number };
  leftPanel: { left: number; right: number } | null;
  rightPanel: { left: number; right: number } | null;
  handles: Record<
    'left' | 'right',
    { left: number; right: number; top: number; width: number; height: number } | null
  >;
  visibleResizers: string[];
};

async function layoutMetrics(page: Page): Promise<LayoutMetrics> {
  return page.evaluate(() => {
    const rect = (selector: string): DOMRect | null =>
      document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    const workspace = rect('.workspace');
    const terminal = rect('.terminal-card');
    if (!workspace || !terminal) throw new Error('Workspace or terminal layout is missing');

    const box = (value: DOMRect | null): { left: number; right: number } | null =>
      value ? { left: value.left, right: value.right } : null;
    const handle = (side: 'left' | 'right') => {
      const value = rect(`.panel-expand-handle-${side}`);
      return value
        ? {
            left: value.left,
            right: value.right,
            top: value.top,
            width: value.width,
            height: value.height
          }
        : null;
    };

    return {
      workspace: {
        left: workspace.left,
        right: workspace.right,
        top: workspace.top,
        height: workspace.height
      },
      terminal: { left: terminal.left, right: terminal.right },
      leftPanel: box(rect('.workspace > .sidebar')),
      rightPanel: box(rect('.workspace > .right-panel:not(.is-hidden)')),
      handles: { left: handle('left'), right: handle('right') },
      visibleResizers: Array.from(document.querySelectorAll<HTMLElement>('.panel-resizer'))
        .filter((resizer) => resizer.getBoundingClientRect().width > 0)
        .map((resizer) => resizer.getAttribute('aria-label') ?? '')
    };
  });
}

async function saveLayoutEvidence(name: string): Promise<void> {
  await fs.mkdir(evidenceDirectory, { recursive: true });
  const dataUrl = await session.app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('Main application window is missing');
    const image = await window.webContents.capturePage();
    return image.toDataURL();
  });
  const image = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/u, ''), 'base64');
  expect(image.toString('hex', 0, 8)).toBe('89504e470d0a1a0a');
  await fs.writeFile(join(evidenceDirectory, `${name}.png`), image);
}

async function expectCollapsedGeometry(
  page: Page,
  side: 'left' | 'right',
  scale = 1
): Promise<void> {
  const metrics = await layoutMetrics(page);
  const handle = metrics.handles[side];
  expect(handle).not.toBeNull();
  if (!handle) return;

  if (side === 'left') {
    expect(handle.left).toBeCloseTo(metrics.workspace.left, 0);
    expect(metrics.terminal.left).toBeCloseTo(metrics.workspace.left, 0);
    expect(metrics.leftPanel).toBeNull();
    expect(metrics.visibleResizers).not.toContain('Resize sessions sidebar');
  } else {
    expect(handle.right).toBeCloseTo(metrics.workspace.right, 0);
    expect(metrics.terminal.right).toBeCloseTo(metrics.workspace.right, 0);
    expect(metrics.rightPanel).toBeNull();
    expect(metrics.visibleResizers).not.toContain('Resize right panel');
  }

  expect(handle.height).toBeCloseTo(36 * scale, 0);
  expect(handle.width).toBeCloseTo(24 * scale, 0);
  expect(handle.top + handle.height / 2).toBeCloseTo(
    metrics.workspace.top + metrics.workspace.height / 2,
    0
  );
}

async function dragHandle(page: Page, label: string, deltaX: number): Promise<void> {
  const handle = page.locator(`[aria-label="${label}"]`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Resize handle "${label}" is not visible`);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + deltaX, centerY, { steps: 8 });
  await page.mouse.up();
}

test('collapsed panel handles preserve the full terminal column in every layout', async () => {
  const { page } = session;
  await openLocalTab(session.app);

  await page.locator('button[aria-label="Expand panel"]').click();
  await expect(page.locator('.assistant-panel')).toBeVisible();
  let metrics = await layoutMetrics(page);
  expect(metrics.leftPanel).not.toBeNull();
  expect(metrics.rightPanel).not.toBeNull();
  expect(metrics.terminal.left).toBeCloseTo(metrics.leftPanel!.right, 0);
  expect(metrics.terminal.right).toBeCloseTo(metrics.rightPanel!.left, 0);
  await saveLayoutEvidence('both-open');

  await page.locator('.workspace > .sidebar .sidebar-switcher > button:last-child').click();
  await expectCollapsedGeometry(page, 'left');
  metrics = await layoutMetrics(page);
  expect(metrics.rightPanel).not.toBeNull();
  expect(metrics.terminal.right).toBeCloseTo(metrics.rightPanel!.left, 0);
  await saveLayoutEvidence('left-collapsed');

  await page.locator('.right-panel-switcher button[aria-label="Collapse panel"]').click();
  await expectCollapsedGeometry(page, 'left');
  await expectCollapsedGeometry(page, 'right');
  metrics = await layoutMetrics(page);
  expect(metrics.terminal.left).toBeCloseTo(metrics.workspace.left, 0);
  expect(metrics.terminal.right).toBeCloseTo(metrics.workspace.right, 0);
  const edgeHitTest = await page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace')!.getBoundingClientRect();
    const leftHandle = document
      .querySelector<HTMLElement>('.panel-expand-handle-left')!
      .getBoundingClientRect();
    const rightHandle = document
      .querySelector<HTMLElement>('.panel-expand-handle-right')!
      .getBoundingClientRect();
    const centerY = workspace.top + workspace.height / 2;
    return [
      document.elementFromPoint(leftHandle.right + 2, centerY)?.closest('.panel-expand-handle'),
      document.elementFromPoint(rightHandle.left - 2, centerY)?.closest('.panel-expand-handle')
    ];
  });
  expect(edgeHitTest).toEqual([null, null]);
  await saveLayoutEvidence('both-collapsed');

  await page.locator('.panel-expand-handle-left').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.panel-expand-handle-right')).toBeFocused();
  await expect(page.locator('.panel-expand-handle-right')).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page.locator('.assistant-panel')).toBeVisible();
  await page.locator('.right-panel-switcher button[aria-label="Collapse panel"]').click();
  await page.locator('.panel-expand-handle-left').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.workspace > .sidebar')).toBeVisible();
  await expectCollapsedGeometry(page, 'right');
  metrics = await layoutMetrics(page);
  expect(metrics.leftPanel).not.toBeNull();
  expect(metrics.terminal.left).toBeCloseTo(metrics.leftPanel!.right, 0);
  expect(metrics.terminal.right).toBeCloseTo(metrics.workspace.right, 0);
  await saveLayoutEvidence('right-collapsed');
});

test('panel widths and collapsed state persist across toggles and restart', async () => {
  const { app, page, userDataDirectory } = session;
  await page.locator('button[aria-label="Expand panel"]').click();
  await dragHandle(page, 'Resize right panel', -64);
  await expect
    .poll(async () => {
      const panel = (await layoutMetrics(page)).rightPanel;
      return panel ? panel.right - panel.left : -1;
    })
    .toBe(424);

  await page.locator('.right-panel-switcher button[aria-label="Collapse panel"]').click();
  await page.locator('.panel-expand-handle-right').click();
  let metrics = await layoutMetrics(page);
  expect(metrics.rightPanel!.right - metrics.rightPanel!.left).toBeCloseTo(424, 0);

  await page.locator('.workspace > .sidebar .sidebar-switcher > button:last-child').click();
  await expectCollapsedGeometry(page, 'left');
  await page.locator('.right-panel-switcher button[aria-label="Collapse panel"]').click();
  await expectCollapsedGeometry(page, 'right');

  const statePath = join(userDataDirectory, 'user-data', 'ui-state.json');
  await expect
    .poll(async () => {
      const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as {
        sidebarCollapsed?: boolean;
        rightPanelCollapsed?: boolean;
        rightPanelWidth?: number;
      };
      return state;
    })
    .toMatchObject({ sidebarCollapsed: true, rightPanelCollapsed: true, rightPanelWidth: 424 });

  await app.close();
  session = await launchApp(undefined, { userDataDirectory });
  await expect(session.page.locator('.panel-expand-handle-left')).toBeVisible();
  await expect(session.page.locator('.panel-expand-handle-right')).toBeVisible();
  await session.page.locator('.panel-expand-handle-right').click();
  await expect(session.page.locator('.assistant-panel')).toBeVisible();
  metrics = await layoutMetrics(session.page);
  expect(metrics.rightPanel!.right - metrics.rightPanel!.left).toBeCloseTo(424, 0);
  await expectCollapsedGeometry(session.page, 'left');
});

test('edge handle dimensions follow interface scale', async () => {
  const { page } = session;
  await page.locator('.workspace > .sidebar .sidebar-switcher > button:last-child').click();

  for (const percent of [75, 100, 150]) {
    await page.evaluate(async (uiScalePercent) => {
      const settings = await window.geared.getSettings();
      await window.geared.saveSettings({ ...settings, uiScalePercent });
    }, percent);
    const scale = percent / 100;
    await expect
      .poll(async () => (await layoutMetrics(page)).handles.left?.height ?? 0)
      .toBeCloseTo(36 * scale, 0);
    await expectCollapsedGeometry(page, 'left', scale);
    await expectCollapsedGeometry(page, 'right', scale);
    await expect(page.locator('.panel-expand-handle-left')).toHaveCSS('z-index', '8');
  }
});

test('edge handle colors follow light and dark themes', async () => {
  const { app, page, userDataDirectory } = session;
  await page.evaluate(async () => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, windowEffect: 'solid' });
  });
  await app.close();
  session = await launchApp(undefined, { userDataDirectory });
  const solidPage = session.page;
  await solidPage.locator('.workspace > .sidebar .sidebar-switcher > button:last-child').click();
  const handle = solidPage.locator('.panel-expand-handle-left');

  for (const [theme, expectedBackground] of [
    ['Light', 'rgb(246, 248, 251)'],
    ['Geared Dark', 'rgb(13, 17, 23)']
  ] as const) {
    await solidPage.evaluate(async (nextTheme) => {
      const settings = await window.geared.getSettings();
      await window.geared.saveSettings({ ...settings, theme: nextTheme });
    }, theme);
    await expect
      .poll(() => handle.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(expectedBackground);
  }
});
