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
    const editor = page.locator('.profile-editor');
    await editor.getByLabel('Name').fill(name);
    if (group) await editor.getByLabel('Group (optional)').fill(group);
    await editor.getByRole('button', { name: 'Save profile' }).click();
    await expect(editor).toHaveCount(0);
  };

  await createProfile('Ungrouped one');
  for (const name of ['Alpha one', 'Alpha two', 'Alpha three']) {
    await createProfile(name, 'Alpha');
  }
  for (const name of ['Beta one', 'Beta two']) await createProfile(name, 'Beta');

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
  await expect.poll(groupNames).toEqual(['Beta', 'Alpha']);

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

  await page.reload();
  await expect.poll(groupNames).toEqual(['Beta', 'Alpha']);
  await expect.poll(() => profileNames('Beta')).toEqual(['Beta one', 'Beta two', 'Alpha three']);
  await expect.poll(() => profileNames('Alpha')).toEqual(['Alpha one']);
  await expect.poll(ungroupedNames).toEqual(['Ungrouped one', 'Alpha two']);
});
