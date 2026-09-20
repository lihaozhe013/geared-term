import { expect, test } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session.close();
});

test('opens the main window and connects the secure bridge', async () => {
  const { page } = session;
  await expect(page).toHaveTitle('Geared Term');
  await expect(page.locator('.titlebar-app')).toHaveText('Geared Term');
  await expect(page.locator('.terminal-line.success')).toContainText('bridge: Geared Term');
  await expect(page.locator('.terminal-line.success')).toContainText(`(${process.platform})`);
});

test('keeps the renderer sandboxed behind a frozen preload allowlist', async () => {
  const { page } = session;
  const boundary = await page.evaluate(() => {
    const scope = window as unknown as Record<string, unknown>;
    const api = (scope.geared ?? null) as Record<string, unknown> | null;
    return {
      apiKeyCount: api ? Object.keys(api).length : 0,
      frozen: api ? Object.isFrozen(api) : false,
      exposesNode: typeof scope.process !== 'undefined',
      exposesRequire: typeof scope.require !== 'undefined',
      exposesIpc: typeof scope.ipcRenderer !== 'undefined'
    };
  });
  expect(boundary.apiKeyCount).toBeGreaterThan(30);
  expect(boundary.frozen).toBe(true);
  expect(boundary.exposesNode).toBe(false);
  expect(boundary.exposesRequire).toBe(false);
  expect(boundary.exposesIpc).toBe(false);
});

test('exposes exactly the documented preload surface', async () => {
  const { page } = session;
  const keys = await page.evaluate(() =>
    Object.keys((window as unknown as { geared: Record<string, unknown> }).geared).sort()
  );
  expect(keys).toEqual(
    [
      'cancelSftpTransfer',
      'continueAiHistory',
      'createLocalTerminal',
      'createSavedSshTerminal',
      'createSshTerminal',
      'deleteAiConnection',
      'deleteAiHistory',
      'deleteEnvironment',
      'deleteLocalPaths',
      'deleteProfile',
      'disableAutoUnlock',
      'discoverAiModels',
      'discoverWsl',
      'downloadPathsSftp',
      'downloadSftp',
      'enableAutoUnlock',
      'executeCommandAction',
      'getAppInfo',
      'getAutoUnlockStatus',
      'getRuntimeInfo',
      'getSettings',
      'getUiState',
      'getVaultStatus',
      'initializeVault',
      'listAiConnections',
      'listAiHistory',
      'listEnvironments',
      'listLocalFiles',
      'listProfiles',
      'listSftpTransfers',
      'listSftp',
      'listUserThemes',
      'loadAiHistory',
      'lockVault',
      'makeLocalDirectory',
      'onMenuCommand',
      'onAiHistoryContinue',
      'onSettingsChanged',
      'onSettingsNavigate',
      'onSftpCd',
      'onSftpTransferEvent',
      'onVaultChanged',
      'openAiHistoryDirectory',
      'openConfigFolder',
      'openHistoryWindow',
      'openLocalPath',
      'openSettings',
      'openThemesFolder',
      'probeEnvironment',
      'renameLocalPath',
      'rotateVault',
      'runRemoteFileCommand',
      'saveAiConnection',
      'saveAiHistory',
      'saveEnvironment',
      'saveProfile',
      'saveProfileWithCredentials',
      'saveSettings',
      'saveUiState',
      'streamAi',
      'revealLocalPath',
      'sftpDelete',
      'sftpMkdir',
      'sftpRename',
      'unlockVault',
      'uploadPathsSftp',
      'uploadSftp'
    ].sort()
  );
});

test('reports application information from the main process', async () => {
  const { page } = session;
  const info = await page.evaluate(() =>
    (
      window as unknown as {
        geared: {
          getAppInfo: () => Promise<{
            name: string;
            version: string;
            platform: string;
            isPackaged: boolean;
          }>;
        };
      }
    ).geared.getAppInfo()
  );
  expect(info.name).toBe('Geared Term');
  expect(info.platform).toBe('win32');
  expect(info.isPackaged).toBe(false);
  expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
});
