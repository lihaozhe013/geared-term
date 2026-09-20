import { expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session.close();
});

async function workspaceColumns(page: Page): Promise<string> {
  return page.evaluate(() => {
    const workspace = document.querySelector<HTMLElement>('.workspace');
    if (!workspace) throw new Error('Workspace section is missing');
    return workspace.style.gridTemplateColumns;
  });
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

test('sidebar resizer drags the left panel width and persists it', async () => {
  const { page, userDataDirectory } = session;
  const before = await workspaceColumns(page);
  expect(before).toContain('240px');

  await dragHandle(page, 'Resize sessions sidebar', 120);

  const after = await workspaceColumns(page);
  expect(after).toContain('360px');

  const stateFile = join(userDataDirectory, 'user-data', 'ui-state.json');
  await expect
    .poll(async () => {
      const raw = await fs.readFile(stateFile, 'utf8');
      return (JSON.parse(raw) as { sidebarWidth?: number }).sidebarWidth;
    })
    .toBe(360);
});

test('right panel resizer drags the assistant panel width', async () => {
  const { page } = session;
  await page.locator('button[aria-label="Expand panel"]').click();
  await expect(page.locator('.assistant-panel')).toBeVisible();

  const before = await workspaceColumns(page);
  expect(before).toContain('360px');

  await dragHandle(page, 'Resize right panel', -100);

  const after = await workspaceColumns(page);
  expect(after).toContain('460px');
});

test('resizer honors the configured width bounds', async () => {
  const { page } = session;
  await dragHandle(page, 'Resize sessions sidebar', 900);
  const columns = await workspaceColumns(page);
  expect(columns).toContain('520px');
});
