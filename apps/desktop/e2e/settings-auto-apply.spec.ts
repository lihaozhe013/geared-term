import { expect, test } from '@playwright/test';
import {
  DOM_RENDERER_ARGS,
  launchApp,
  openLocalTab,
  openSettingsWindow,
  type AppSession
} from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp(DOM_RENDERER_ARGS);
  await session.page.evaluate(() => window.geared.patchSettings({ language: 'en-US' }));
});

test.afterEach(async () => {
  await session?.close();
});

test('applies appearance, terminal, and searched-font changes without an Apply button', async () => {
  await openLocalTab(session.app);
  await expect(session.page.locator('.terminal-surface')).toHaveAttribute(
    'data-active-status',
    'running',
    { timeout: 30_000 }
  );

  const settings = await openSettingsWindow(session, 'Appearance');
  await expect(settings.getByRole('button', { name: 'Apply' })).toHaveCount(0);

  const fonts = await settings.evaluate(() => window.geared.listSystemFonts());
  const font = fonts.find((name) => name.length <= 128);
  expect(font).toBeTruthy();
  const terminalFont = settings.getByRole('button', { name: 'Terminal font family' });
  await terminalFont.click();
  await settings.getByRole('combobox', { name: 'Search fonts' }).fill(font as string);
  await settings.getByRole('option', { name: font as string, exact: true }).click();

  await expect
    .poll(() => session.page.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ terminalFontFamily: font });
  await expect
    .poll(() =>
      session.page.evaluate(() => {
        const rows = document.querySelector('.terminal-wrapper:not([hidden]) .xterm-rows');
        return rows ? getComputedStyle(rows).fontFamily : '';
      })
    )
    .toContain(`"${font}"`);

  const fallbackFont = fonts.find((name) => name !== font && name.length <= 128);
  expect(fallbackFont).toBeTruthy();
  await settings.getByRole('button', { name: 'Add fallback font' }).click();
  await expect
    .poll(() => settings.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ terminalFontFallbacks: [] });
  await settings.getByRole('button', { name: 'Fallback font 1' }).click();
  await settings.getByRole('combobox', { name: 'Search fonts' }).fill(fallbackFont as string);
  await settings.getByRole('option', { name: fallbackFont as string, exact: true }).click();
  await expect
    .poll(() => settings.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ terminalFontFallbacks: [{ name: fallbackFont }] });
  await settings.getByRole('button', { name: 'Remove' }).click();
  await expect
    .poll(() => settings.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ terminalFontFallbacks: [] });

  const paddingRow = settings.locator('.settings-row').filter({ hasText: 'Terminal padding' });
  await paddingRow.getByRole('button', { name: 'Increase' }).click();
  await expect
    .poll(() => settings.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ terminalPadding: 15 });
  await expect
    .poll(() =>
      session.page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--gt-terminal-padding').trim()
      )
    )
    .toBe('15px');

  const directory = session.userDataDirectory;
  await session.app.close();
  session = await launchApp(DOM_RENDERER_ARGS, { userDataDirectory: directory });
  await expect(session.page.locator('.compact-menu-trigger')).toBeVisible();
  await expect
    .poll(() => session.page.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ terminalFontFamily: font, terminalPadding: 15 });
});

test('serializes rapid patches from the main and Settings windows', async () => {
  const settings = await openSettingsWindow(session, 'Terminal');
  await Promise.all([
    session.page.evaluate(() => window.geared.patchSettings({ uiScalePercent: 110 })),
    settings.evaluate(() => window.geared.patchSettings({ terminalCursor: 'underline' })),
    settings.evaluate(() => window.geared.patchSettings({ defaultTerm: 'screen' }))
  ]);

  await expect
    .poll(() => session.page.evaluate(() => window.geared.getSettings()))
    .toMatchObject({
      uiScalePercent: 110,
      terminalCursor: 'underline',
      defaultTerm: 'screen'
    });
  await settings.close();
  const reopened = await openSettingsWindow(session, 'Terminal');
  await expect(reopened.getByRole('button', { name: 'Bar' })).toBeVisible();
});

test('keeps SFTP commands and assistant instructions behind their existing buttons', async () => {
  const settings = await openSettingsWindow(session, 'SFTP');
  const previousCommands = await session.page.evaluate(() =>
    window.geared.getSettings().then((record) => record.remoteFileCommands)
  );
  const commands = settings.locator('.settings-textarea').first();
  await commands.fill('tail');
  await expect
    .poll(() => session.page.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ remoteFileCommands: previousCommands });
  await settings.getByRole('button', { name: 'Apply' }).click();
  await expect
    .poll(() => session.page.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ remoteFileCommands: 'tail' });

  await settings.getByRole('button', { name: 'AI Assistant' }).click();
  const instructions = settings.locator('.settings-textarea').first();
  const previousInstructions = await session.page.evaluate(() =>
    window.geared.getSettings().then((record) => record.globalAiInstructions)
  );
  await instructions.fill('Use concise responses for E2E verification.');
  await expect
    .poll(() => session.page.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ globalAiInstructions: previousInstructions });
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(() => session.page.evaluate(() => window.geared.getSettings()))
    .toMatchObject({ globalAiInstructions: 'Use concise responses for E2E verification.' });
});
