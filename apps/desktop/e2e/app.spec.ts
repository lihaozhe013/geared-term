import { expect, test } from '@playwright/test';
import { launchApp, openLocalTab, type AppSession } from './fixtures';

let session: AppSession;

test.beforeEach(async () => {
  session = await launchApp();
});

test.afterEach(async () => {
  await session?.close();
});

test('opens the main window and connects the secure bridge', async () => {
  const { page } = session;
  await expect(
    session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
  ).resolves.toBe(true);
  await expect(page).toHaveTitle('Geared Term');
  await expect(page.locator('.titlebar-app')).toHaveText('Geared Term');
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
      'acceptAiEndpoint',
      'addTerminalSnapshotToAssistant',
      'beginKeyCapture',
      'cancelSftpTransfer',
      'checkForUpdates',
      'clearAiHistory',
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
      'endKeyCapture',
      'executeMenuAction',
      'executeCommandAction',
      'getAppInfo',
      'getAutoUnlockStatus',
      'getDownloadsDirectory',
      'getLocalWorkingDirectory',
      'getRuntimeInfo',
      'getSettings',
      'getSftpEditorDocument',
      'getTerminalSnapshotDraft',
      'getTerminalLigatureSequences',
      'getUiState',
      'getUpdateStatus',
      'getVaultStatus',
      'initializeVault',
      'installDownloadedUpdate',
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
      'onAiHistoryContinue',
      'onAiConnectionsChanged',
      'onEnvironmentUpdated',
      'onMenuCommand',
      'onSettingsChanged',
      'onSettingsNavigate',
      'onSftpCd',
      'onSftpEditorSaved',
      'onTerminalSnapshotAddToAssistant',
      'onUpdateStatus',
      'onSftpTransferEvent',
      'onVaultChanged',
      'onWindowMaximizeChanged',
      'openAiHistoryDirectory',
      'openConfigFolder',
      'openHistoryWindow',
      'openLocalPath',
      'openNightlyRelease',
      'openSettings',
      'openSftpEditor',
      'openTerminalSnapshotEditor',
      'openThemesFolder',
      'platform',
      'probeEnvironment',
      'isWindowMaximized',
      'renameLocalPath',
      'reorderProfiles',
      'reloadSftpEditor',
      'rotateVault',
      'runRemoteFileCommand',
      'saveSftpEditor',
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
      'sftpSendCd',
      'sftpTrackedDirectory',
      'setSftpEditorDirty',
      'unlockVault',
      'uploadPathsSftp',
      'uploadSftp',
      'windowControl'
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
  expect(info.platform).toBe(process.platform);
  expect(info.isPackaged).toBe(false);
  expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
});

test('opens Files as a single local pane at the shell startup cwd', async () => {
  const { page, app } = session;
  await openLocalTab(app);
  const terminal = page.locator('.terminal-wrapper:not([hidden])');
  await expect(terminal).toHaveAttribute('data-session-id', /.+/u);
  const sessionId = await terminal.getAttribute('data-session-id');
  if (!sessionId) throw new Error('Local terminal session id is missing');

  await page.evaluate(() => {
    const api = (
      window as unknown as { geared: { executeMenuAction: (action: string) => Promise<void> } }
    ).geared;
    return api.executeMenuAction('toggle-sftp');
  });

  await expect(page.locator('.local-files-panel')).toBeVisible();
  await expect(page.locator('.local-file-pane')).toHaveCount(1);
  await expect(page.locator('.sftp-divider')).toHaveCount(0);
  await expect(page.locator('.sftp-sync')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true');

  const startupDirectory = await page.evaluate((id) => {
    const api = (
      window as unknown as {
        geared: { getLocalWorkingDirectory: (sessionId: string) => Promise<string | null> };
      }
    ).geared;
    return api.getLocalWorkingDirectory(id);
  }, sessionId);
  expect(startupDirectory).toBeTruthy();
  await expect(page.locator('.local-file-pane input[aria-label="Local directory"]')).toHaveValue(
    startupDirectory!
  );
  await expect(page.getByRole('button', { name: 'Open in file manager' })).toBeVisible();
});

test('renders and executes the virtual menu on non-macOS platforms', async () => {
  test.skip(process.platform === 'darwin', 'macOS uses the native application menu');
  const { page } = session;
  await expect(page.locator('.desktop-menu')).toBeVisible();
  await page.locator('.desktop-menu-button').first().click();
  await expect(page.locator('.desktop-menu-popover').first()).toBeVisible();
  await page.getByRole('menuitem', { name: 'New local terminal' }).click();
  await expect(page.locator('.terminal-tab')).toHaveCount(1);
});

test('keeps the macOS application menu separate from File', async () => {
  test.skip(process.platform !== 'darwin', 'Windows and Linux use the virtual renderer menu');
  const structure = await session.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    return {
      topLevel: menu?.items.map((item) => item.label) ?? [],
      application: menu?.items[0]?.submenu?.items.map((item) => item.label) ?? [],
      file:
        menu?.items
          .find((item) => item.label === 'File')
          ?.submenu?.items.map((item) => item.label) ?? []
    };
  });
  expect(structure.topLevel[0]).toBe('Geared Term');
  expect(structure.application).toContain('About Geared Term');
  expect(structure.file).toContain('New local terminal');
  expect(structure.file).not.toContain('About Geared Term');
});
