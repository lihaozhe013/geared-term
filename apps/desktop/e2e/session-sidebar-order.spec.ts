import { expect, test, type Locator } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session?.close();
});

test('reorders sessions and groups, moves sessions between sections, and restores the order', async () => {
  const { page } = session;
  const createProfile = async (name: string, group?: string): Promise<void> => {
    await page.getByRole('button', { name: 'New session profile' }).click();
    await page.getByRole('menuitem', { name: 'New local session' }).click();
    const editor = page.locator('.profile-editor');
    await editor.getByLabel('Name').fill(name);
    if (group) await editor.getByLabel('Group (optional)').fill(group);
    await editor.getByRole('button', { name: 'Save profile' }).click();
    await expect(editor).toHaveCount(0);
  };
  const createEmptyGroup = async (name: string): Promise<void> => {
    await page.getByRole('button', { name: 'New session profile' }).click();
    await page.getByRole('menuitem', { name: 'Empty group' }).click();
    const dialog = page.locator('.group-editor');
    await dialog.getByLabel('Group name').fill(name);
    await dialog.getByRole('button', { name: 'Create group' }).click();
    await expect(dialog).toHaveCount(0);
  };

  await createProfile('Ungrouped one');
  for (const name of ['Alpha one', 'Alpha two', 'Alpha three']) {
    await createProfile(name, 'Alpha');
  }
  for (const name of ['Beta one', 'Beta two']) await createProfile(name, 'Beta');
  await createEmptyGroup('Empty');

  const group = (name: string) => page.locator(`.profile-tree-group[aria-label="${name}"]`);
  const groupHandle = (name: string) =>
    page.getByRole('button', { name: `Drag to reorder group: ${name}` });
  const profileHandle = (name: string) =>
    page.getByRole('button', { name: `Drag to reorder session: ${name}` });
  const row = (name: string) => page.locator('.profile-row').filter({ hasText: name });
  const groupNames = () => page.locator('.profile-tree-header span').allTextContents();
  const profileNames = (name: string) =>
    group(name).locator('.profile-button span').allTextContents();
  const ungroupedNames = () =>
    page.locator('.sidebar-body > .profile-row .profile-button span').allTextContents();

  await expect(group('Empty').locator('.profile-tree-header small')).toHaveText('0');

  const drag = async (
    source: Locator,
    target: Locator,
    position: 'before' | 'after' | 'center',
    dropClass: string
  ): Promise<void> => {
    await expect(source).toHaveAttribute('draggable', 'true');
    await source.evaluate((element) => {
      const state = window as Window & {
        sidebarTestTransfer?: DataTransfer;
        sidebarTestSource?: Element;
      };
      const transfer = new DataTransfer();
      state.sidebarTestTransfer = transfer;
      state.sidebarTestSource = element;
      element.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
    });
    await target.evaluate((element, dropPosition) => {
      const transfer = (window as Window & { sidebarTestTransfer?: DataTransfer })
        .sidebarTestTransfer;
      const rect = element.getBoundingClientRect();
      const clientY =
        dropPosition === 'before'
          ? rect.top + 1
          : dropPosition === 'after'
            ? rect.bottom - 1
            : rect.top + rect.height / 2;
      element.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: rect.left + rect.width / 2,
          clientY
        })
      );
    }, position);
    await expect(target).toHaveClass(new RegExp(dropClass));
    await target.evaluate((element) => {
      const state = window as Window & {
        sidebarTestSource?: Element;
        sidebarTestTransfer?: DataTransfer;
      };
      const transfer = state.sidebarTestTransfer;
      const rect = element.getBoundingClientRect();
      element.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2
        })
      );
      state.sidebarTestSource?.dispatchEvent(
        new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
      delete state.sidebarTestSource;
      delete state.sidebarTestTransfer;
    });
  };

  await drag(
    groupHandle('Beta'),
    group('Alpha').locator('.profile-tree-heading'),
    'before',
    'drop-before'
  );
  await expect.poll(groupNames).toEqual(['Beta', 'Alpha', 'Empty']);

  await drag(profileHandle('Alpha one'), row('Alpha two'), 'after', 'drop-after');
  await expect.poll(() => profileNames('Alpha')).toEqual(['Alpha two', 'Alpha one', 'Alpha three']);

  await drag(profileHandle('Alpha two'), row('Beta one'), 'after', 'drop-after');
  await expect.poll(() => profileNames('Beta')).toEqual(['Beta one', 'Alpha two', 'Beta two']);

  await group('Beta').locator('.profile-tree-header').click();
  await expect(row('Beta one')).toHaveCount(0);
  await drag(
    profileHandle('Alpha three'),
    group('Beta').locator('.profile-tree-heading'),
    'center',
    'drop-append'
  );
  await group('Beta').locator('.profile-tree-header').click();
  await expect
    .poll(() => profileNames('Beta'))
    .toEqual(['Beta one', 'Alpha two', 'Beta two', 'Alpha three']);

  await drag(
    profileHandle('Alpha two'),
    page.locator('.sidebar-ungrouped-drop-target'),
    'center',
    'is-drop-target'
  );
  await expect.poll(ungroupedNames).toEqual(['Ungrouped one', 'Alpha two']);

  await drag(
    profileHandle('Alpha one'),
    group('Empty').locator('.profile-tree-heading'),
    'center',
    'drop-append'
  );
  await expect.poll(() => profileNames('Empty')).toEqual(['Alpha one']);
  await drag(
    profileHandle('Alpha one'),
    group('Alpha').locator('.profile-tree-heading'),
    'center',
    'drop-append'
  );
  await expect.poll(() => profileNames('Alpha')).toEqual(['Alpha one']);
  await expect(group('Empty').locator('.profile-tree-header small')).toHaveText('0');

  await page.reload();
  await expect.poll(groupNames).toEqual(['Beta', 'Alpha', 'Empty']);
  await expect.poll(() => profileNames('Beta')).toEqual(['Beta one', 'Beta two', 'Alpha three']);
  await expect.poll(() => profileNames('Alpha')).toEqual(['Alpha one']);
  await expect.poll(ungroupedNames).toEqual(['Ungrouped one', 'Alpha two']);
  await expect(group('Empty').locator('.profile-tree-header small')).toHaveText('0');

  await group('Empty').getByRole('button', { name: 'Group actions: Empty' }).click();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  await expect(group('Empty')).toHaveCount(0);
  await page.reload();
  await expect.poll(groupNames).toEqual(['Beta', 'Alpha']);
});

test('keeps the create menu inside the viewport and flips or scrolls as needed', async () => {
  const { page } = session;
  const trigger = page.getByRole('button', { name: 'New session profile' });
  const menu = page.getByRole('menu', { name: 'New session profile' });

  await trigger.click();
  let triggerBox = await trigger.boundingBox();
  let menuBox = await menu.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await trigger.evaluate((element) => {
    element.style.position = 'fixed';
    element.style.top = 'calc(100vh - 34px)';
    element.style.right = '8px';
  });
  await trigger.click();
  triggerBox = await trigger.boundingBox();
  menuBox = await menu.boundingBox();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(triggerBox!.y + 1);

  await page.setViewportSize({ width: 180, height: 140 });
  await page.waitForFunction(() => {
    const popup = document.querySelector<HTMLElement>('.sidebar-create-menu');
    return Boolean(popup && popup.getBoundingClientRect().bottom <= window.innerHeight);
  });
  menuBox = await menu.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height);
  await expect.poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
});

test('localizes the Sessions sidebar and empty-group validation in Simplified Chinese', async () => {
  const { page } = session;
  await page.evaluate(async () => {
    const settings = await window.geared.getSettings();
    await window.geared.saveSettings({ ...settings, language: 'zh-CN' });
  });

  await expect(page.getByRole('tab', { name: '会话' })).toBeVisible();
  await expect(page.getByRole('button', { name: '收起会话侧边栏' })).toBeVisible();
  await expect(page.locator('.sidebar-body')).toHaveAttribute('aria-label', '已保存的会话');

  await page.getByRole('button', { name: '新建会话配置' }).click();
  await expect(page.getByRole('menuitem', { name: '新建本地会话' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '新建 SSH 会话' })).toBeVisible();
  await page.getByRole('menuitem', { name: '空分组' }).click();

  const dialog = page.locator('.group-editor');
  await dialog.getByRole('button', { name: '创建分组' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('请输入分组名称');
  await dialog.getByLabel('分组名称').fill('示例分组');
  await dialog.getByRole('button', { name: '创建分组' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: '新建会话配置' }).click();
  await page.getByRole('menuitem', { name: '空分组' }).click();
  await page.locator('.group-editor').getByLabel('分组名称').fill('示例分组');
  await page.locator('.group-editor').getByRole('button', { name: '创建分组' }).click();
  await expect(page.getByRole('alert')).toHaveText('已存在同名分组');

  await page.locator('.group-editor').getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '分组操作: 示例分组' }).click();
  await expect(page.getByRole('menuitem', { name: '删除分组' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '新建会话配置' }).click();
  await page.getByRole('menuitem', { name: '新建本地会话' }).click();
  const profileEditor = page.locator('.profile-editor');
  await profileEditor.getByLabel('名称').fill('本地示例');
  await profileEditor.getByRole('button', { name: '保存配置' }).click();
  await expect(profileEditor).toHaveCount(0);
  await expect(page.locator('.profile-kind').first()).toHaveText('本地');

  await page.getByRole('button', { name: '收起会话侧边栏' }).click();
  await page.getByRole('button', { name: '展开会话侧边栏' }).click();
});
