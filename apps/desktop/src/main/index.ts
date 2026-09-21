import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  safeStorage,
  screen,
  session,
  shell
} from 'electron';
import { mkdir as fsMkdir } from 'node:fs/promises';
import { basename, join, posix } from 'node:path';
import {
  AppInfoSchema,
  BUILTIN_THEME_NAMES,
  AiConnectionDeleteRequestSchema,
  AiEndpointConsentRequestSchema,
  AiConnectionInputSchema,
  AiConnectionRecordSchema,
  AiStreamClientMessageSchema,
  AiStreamEventSchema,
  AiStreamRequestSchema,
  AiDiscoverModelsRequestSchema,
  AiDiscoveredModelsSchema,
  AiHistoryListSchema,
  AiHistoryLoadRequestSchema,
  AiHistoryLoadResultSchema,
  AiHistorySaveRequestSchema,
  AiHistorySavedSchema,
  EnvironmentFactsSchema,
  EnvironmentProbeRequestSchema,
  EnvironmentRecordSchema,
  EmptyRequestSchema,
  AutoUnlockStatusSchema,
  ProfileIdRequestSchema,
  SETTINGS_CATEGORIES,
  SessionProfileRecordSchema,
  SessionProfileSaveRequestSchema,
  SettingsOpenRequestSchema,
  SettingsRecordSchema,
  SftpListRequestSchema,
  SftpListResultSchema,
  SftpMkdirRequestSchema,
  SftpSendCdRequestSchema,
  SftpSessionRequestSchema,
  SftpRenameRequestSchema,
  SftpDeleteRequestSchema,
  SftpUploadPathsRequestSchema,
  SftpDownloadPathsRequestSchema,
  SftpTransferIdRequestSchema,
  SftpTransferSchema,
  SftpTransferEventSchema,
  SftpRemoteCommandRequestSchema,
  SftpCdEventSchema,
  LocalListRequestSchema,
  LocalSessionRequestSchema,
  LocalWorkingDirectorySchema,
  LocalEntrySchema,
  LocalMkdirRequestSchema,
  LocalRenameRequestSchema,
  LocalDeleteRequestSchema,
  LocalOpenRequestSchema,
  RuntimeInfoSchema,
  UserThemeListSchema,
  SftpDownloadRequestSchema,
  SftpOperationResultSchema,
  SftpUploadRequestSchema,
  SshProfileTerminalRequestSchema,
  TerminalCommandActionSchema,
  TerminalLigatureRequestSchema,
  TerminalLigatureSequencesSchema,
  UiStateRecordSchema,
  VaultPasswordRequestSchema,
  VaultRotateRequestSchema,
  VaultStatusSchema,
  WslDistributionSchema,
  normalizeTerminalLineEndings,
  parseRemoteFileCommands
} from '@geared-term/protocol';
import { createLogger, type Logger } from './logging';
import {
  buildChatCompletionsPayload,
  buildResponsesPayload,
  normalizeEndpoint
} from './ai/endpoint';
import { AiProviderError, streamAiRequest } from './ai/provider';
import { discoverModels } from './ai/discovery';
import { AiHistoryStore } from './ai/history';
import { LocalTerminalManager } from './local-terminal';
import { resolveTerminalLigatureSequences } from './ligatures';
import { commandRevision, parseCommandBlock } from '@geared-term/command-parser';
import { AppStorage } from './persistence/app-storage';
import { loadUserThemes } from './persistence/user-themes';
import {
  listLocalDirectory,
  makeLocalDirectory,
  removeLocalPaths,
  renameLocalPath
} from './files/local-files';
import { KnownHostsStore } from './ssh/known-hosts';
import { SshSessionManager } from './ssh/ssh-session';
import { buildRemoteFileCommand, quoteRemotePath } from './sftp/remote-commands';
import { TransferManager } from './sftp/transfers';
import { buildApplicationMenu, executeApplicationMenuAction, type MenuLocale } from './menu';
import { HistoryWindowManager } from './history-window';
import { SettingsWindowManager, type SettingsCategory } from './settings-window';
import { TrayController } from './tray';
import {
  forwardWindowControlState,
  hideNativeMenuBar,
  showWindowWhenReady,
  windowChromeOptions
} from './window-chrome';
import { discoverWsl } from './wsl/discovery';
import { probeEnvironment } from './environment/probe';
import { EnvironmentManager } from './environment/manager';
import { buildAssistantContext } from './ai/context';

const isDevelopment = !app.isPackaged;
// Depth of in-flight key-capture sessions (shortcut recording in the settings
// window). While positive, the application menu is detached so its registered
// accelerators cannot swallow the keys being recorded.
let keyCaptureDepth = 0;
// Keeps automated runs (E2E tests, portable scenarios) hermetic by redirecting
// profile storage away from the machine-wide default location.
const userDataOverride = process.env.GEARED_USER_DATA?.trim();
if (userDataOverride) app.setPath('userData', userDataOverride);
// Keyed on the userData directory, so the override above must land first.
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  // The secondary process has not initialized any application resources, so
  // exit immediately instead of waiting for Electron's ready/quit lifecycle.
  app.exit(0);
} else {
  app.on('second-instance', () => restoreMainWindow());
}
let logger: Logger;
let mainWindow: BrowserWindow | undefined;
let pendingRestore = false;
let applicationReady = false;
let quitRequested = false;
let trayController: TrayController | undefined;
let settingsWindow: SettingsWindowManager;
let historyWindow: HistoryWindowManager;
let localTerminals: LocalTerminalManager;
let storage: AppStorage;
let environmentManager: EnvironmentManager;
let sshSessions: SshSessionManager;
let transferManager: TransferManager;
const aiControllers = new Map<string, AbortController>();
const aiHistory = new AiHistoryStore(isDevelopment ? process.cwd() : app.getPath('userData'));
const themesDirectory = join(isDevelopment ? process.cwd() : app.getPath('userData'), 'themes');

function sendToRenderer(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function backgroundModeEnabled(): boolean {
  return storage !== undefined && storage.settingsSnapshot().keepRunningInBackground;
}

function restoreMainWindow(): void {
  if (!applicationReady || !storage || !logger) {
    pendingRestore = true;
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.webContents.setBackgroundThrottling(true);
  mainWindow.focus();
}

function toggleMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.webContents.setBackgroundThrottling(false);
    mainWindow.hide();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.webContents.setBackgroundThrottling(true);
  mainWindow.focus();
}

function resolveMenuLocale(language: 'system' | 'en-US' | 'zh-CN'): MenuLocale {
  if (language !== 'system') return language;
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function showAboutDialog(locale: MenuLocale): void {
  const aboutLabels = {
    'en-US': { title: 'About Geared Term', detail: 'A secure Electron terminal application.' },
    'zh-CN': { title: '关于 Geared Term', detail: '一个安全的 Electron 终端应用。' }
  } as const;
  void dialog.showMessageBox({
    type: 'info',
    title: aboutLabels[locale].title,
    message: `Geared Term ${app.getVersion()}`,
    detail: `${aboutLabels[locale].detail}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`
  });
}

async function rebuildApplicationMenu(): Promise<void> {
  const settings = storage.settingsSnapshot();
  const locale = resolveMenuLocale(settings.language);
  const userThemes = await loadUserThemes(themesDirectory).catch(() => ({
    themes: [],
    invalid: []
  }));
  buildApplicationMenu(
    {
      locale,
      language: settings.language,
      theme: settings.theme,
      themeNames: [
        ...new Set([...BUILTIN_THEME_NAMES, ...userThemes.themes.map((theme) => theme.name)])
      ],
      isDevelopment,
      keybindings: settings.keybindings
    },
    {
      onCommand: (command) => sendToRenderer('menu-command', command),
      onOpenConfigFolder: () => {
        void shell.openPath(app.getPath('userData'));
      },
      onOpenSettings: () => settingsWindow.open(),
      onAbout: () => showAboutDialog(locale)
    }
  );
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeAssistantFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancelled|aborted/iu.test(message)) return 'cancelled';
  if (/timeout/iu.test(message)) return 'timeout';
  if (/response size limit/iu.test(message)) return 'response-size-limit';
  const status = message.match(/provider rejected request \((\d{3})\)/u)?.[1];
  if (status) return `provider-http-${status}`;
  if (/endpoint/iu.test(message)) return 'invalid-endpoint';
  return 'request-failed';
}

function attachedEnvironmentForTarget(
  targetKey: string
): ReturnType<AppStorage['environmentSnapshot']>[number] | undefined {
  const records = storage.environmentSnapshot().filter((record) => record.attachToAi);
  const exact = records.find((record) => record.targetKey === targetKey);
  if (exact) return exact;
  if (targetKey.startsWith('local:')) {
    return records.find((record) => record.kind === 'local' && record.targetKey === 'local');
  }
  if (targetKey.startsWith('wsl:')) {
    const legacy = records.filter(
      (record) => record.kind === 'wsl' && record.targetKey.startsWith('wsl:')
    );
    return legacy.length === 1 ? legacy[0] : undefined;
  }
  return undefined;
}

function installSecurityHandlers(): void {
  // Deny-by-default per SEC-005; terminal/field paste is core functionality,
  // so only the two clipboard permissions are allowlisted. clipboard-read is
  // additionally gated by a permission *check* (not a request) in Chromium.
  const allowedPermissions = new Set(['clipboard-read', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, _requestingOrigin, details) =>
      allowedPermissions.has(permission) && details.isMainFrame
  );
}

function installContentSecurityPolicy(): void {
  const contentSecurityPolicy = isDevelopment
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:*;"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy]
      }
    });
  });
}

function restoredBounds(): { x: number; y: number; width: number; height: number } | undefined {
  const saved = storage.uiStateSnapshot().bounds;
  if (!saved) return undefined;
  const displays = screen.getAllDisplays();
  const display =
    displays.find(
      ({ workArea }) =>
        saved.x < workArea.x + workArea.width &&
        saved.x + saved.width > workArea.x &&
        saved.y < workArea.y + workArea.height &&
        saved.y + saved.height > workArea.y
    ) ?? displays[0];
  if (!display) return undefined;
  const { x, y, width, height } = display.workArea;
  const restoredWidth = Math.min(Math.max(Math.round(saved.width), 900), width);
  const restoredHeight = Math.min(Math.max(Math.round(saved.height), 600), height);
  return {
    width: restoredWidth,
    height: restoredHeight,
    x: Math.max(x, Math.min(Math.round(saved.x), x + width - restoredWidth)),
    y: Math.max(y, Math.min(Math.round(saved.y), y + height - restoredHeight))
  };
}

function createWindow(): BrowserWindow {
  const bounds = restoredBounds();
  const window = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...windowChromeOptions(),
    backgroundColor: '#111318',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  hideNativeMenuBar(window);
  forwardWindowControlState(window);
  let persistingWindowState = false;

  showWindowWhenReady(window, logger, 'main');
  window.once('ready-to-show', () => {
    if (storage.uiStateSnapshot().maximized) window.maximize();
  });
  window.webContents.once('did-finish-load', () => {
    if (storage.uiStateSnapshot().maximized && !window.isMaximized()) window.maximize();
  });
  window.on('close', (event) => {
    if (persistingWindowState) return;
    persistingWindowState = true;
    event.preventDefault();
    const nextBounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
    void storage
      .saveUiState({
        ...storage.uiStateSnapshot(),
        bounds: nextBounds,
        maximized: window.isMaximized()
      })
      .catch((error: unknown) => {
        logger.error('system', 'Unable to persist window state', {
          error: error instanceof Error ? error.message : String(error)
        });
      })
      .finally(() => {
        // Preventing the first close canceled the in-flight quit cycle, and on
        // macOS window-all-closed does not re-issue it, which would leave the
        // app running without windows until a second quit is requested.
        if (quitRequested || !backgroundModeEnabled()) {
          window.close();
          if (quitRequested) app.quit();
          return;
        }
        // Background mode keeps the whole renderer (tabs, PTYs, scrollback)
        // alive behind a hidden window; rearm the interception for the next
        // real close.
        window.webContents.setBackgroundThrottling(false);
        window.hide();
        persistingWindowState = false;
      });
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (isDevelopment && rendererUrl && url.startsWith(rendererUrl)) {
      return;
    }
    event.preventDefault();
    logger.warn('system', 'Blocked renderer navigation', { url });
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (isDevelopment && rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

function registerIpc(): void {
  ipcMain.handle('app:get-info', (_event, input: unknown) => {
    const parsed = EmptyRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error('Invalid app information request');
    }

    return AppInfoSchema.parse({
      name: 'Geared Term',
      version: app.getVersion(),
      isPackaged: app.isPackaged,
      platform: process.platform
    });
  });

  ipcMain.handle('menu:execute', (event, action: unknown) => {
    if (typeof action !== 'string' || action.length > 160) {
      throw new Error('Invalid application menu action');
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('Application window is unavailable');
    executeApplicationMenuAction(action, window);
    return SftpOperationResultSchema.parse({ accepted: true });
  });

  ipcMain.handle('window:maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('Application window is unavailable');
    return window.isMaximized();
  });

  ipcMain.handle('window:control', (event, action: unknown) => {
    if (action !== 'minimize' && action !== 'toggle-maximize' && action !== 'close') {
      throw new Error('Invalid window control action');
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error('Application window is unavailable');
    if (action === 'minimize') {
      window.minimize();
    } else if (action === 'toggle-maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    } else {
      window.close();
    }
    return SftpOperationResultSchema.parse({ accepted: true });
  });

  ipcMain.handle('vault:get-status', () => storage.vaultStatus());
  ipcMain.handle('vault:initialize', async (_event, input: unknown) => {
    const request = VaultPasswordRequestSchema.parse(input);
    await storage.initializeVault(request.password);
    const status = storage.vaultStatus();
    sendToRenderer('vault:changed', VaultStatusSchema.parse(status));
    return status;
  });
  ipcMain.handle('vault:unlock', async (_event, input: unknown) => {
    const request = VaultPasswordRequestSchema.parse(input);
    await storage.unlockVault(request.password);
    const status = storage.vaultStatus();
    sendToRenderer('vault:changed', VaultStatusSchema.parse(status));
    return status;
  });
  ipcMain.handle('vault:lock', () => {
    storage.lockVault();
    const status = storage.vaultStatus();
    sendToRenderer('vault:changed', VaultStatusSchema.parse(status));
    return status;
  });
  ipcMain.handle('vault:rotate', async (_event, input: unknown) => {
    const request = VaultRotateRequestSchema.parse(input);
    await storage.rotateVault(request.oldPassword, request.newPassword);
    const status = storage.vaultStatus();
    sendToRenderer('vault:changed', VaultStatusSchema.parse(status));
    return status;
  });
  ipcMain.handle('vault:auto-unlock-status', () =>
    AutoUnlockStatusSchema.parse(storage.autoUnlockStatus())
  );
  ipcMain.handle('vault:enable-auto-unlock', () => {
    storage.enableAutoUnlock();
    return AutoUnlockStatusSchema.parse(storage.autoUnlockStatus());
  });
  ipcMain.handle('vault:disable-auto-unlock', () => {
    storage.disableAutoUnlock();
    return AutoUnlockStatusSchema.parse(storage.autoUnlockStatus());
  });

  ipcMain.handle('profile:list', () =>
    SessionProfileRecordSchema.array().parse(storage.profileSnapshot())
  );
  ipcMain.handle('profile:save', async (_event, input: unknown) => {
    const profile = SessionProfileRecordSchema.parse(input);
    const { secretRefs: _secretRefs, ...profileWithoutSecrets } = profile;
    return SessionProfileRecordSchema.array().parse(
      await storage.saveProfile(profileWithoutSecrets)
    );
  });
  ipcMain.handle('profile:save-with-credentials', async (_event, input: unknown) => {
    const request = SessionProfileSaveRequestSchema.parse(input);
    return SessionProfileRecordSchema.array().parse(
      await storage.saveProfileWithCredentials(request.profile, request.credentials)
    );
  });
  ipcMain.handle('profile:delete', async (_event, input: unknown) => {
    const request = ProfileIdRequestSchema.parse(input);
    return SessionProfileRecordSchema.array().parse(await storage.deleteProfile(request.id));
  });
  ipcMain.handle('ui:get-state', () => UiStateRecordSchema.parse(storage.uiStateSnapshot()));
  ipcMain.handle('ui:save-state', async (_event, input: unknown) => {
    const nextState = UiStateRecordSchema.parse(input);
    return UiStateRecordSchema.parse(await storage.saveUiState(nextState));
  });
  ipcMain.handle('settings:get', () => SettingsRecordSchema.parse(storage.settingsSnapshot()));
  ipcMain.handle('settings:save', async (_event, input: unknown) => {
    const settings = SettingsRecordSchema.parse(input);
    const saved = SettingsRecordSchema.parse(await storage.saveSettings(settings));
    await rebuildApplicationMenu();
    trayController?.sync(saved.keepRunningInBackground, resolveMenuLocale(saved.language));
    sendToRenderer('settings:changed', saved);
    return saved;
  });
  ipcMain.handle('app:open-settings', (_event, input: unknown) => {
    const parsed = SettingsOpenRequestSchema.parse(input ?? {});
    settingsWindow.open(parsed.category as SettingsCategory | undefined);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  // While a shortcut is being recorded the application menu is detached so its
  // accelerators cannot steal the pressed keys before the renderer sees them.
  // begin/end are counted because a second recording can start while the
  // rebuild triggered by the first end is still in flight.
  ipcMain.handle('app:begin-key-capture', () => {
    keyCaptureDepth += 1;
    Menu.setApplicationMenu(null);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('app:end-key-capture', async () => {
    keyCaptureDepth = Math.max(0, keyCaptureDepth - 1);
    if (keyCaptureDepth > 0) return SftpOperationResultSchema.parse({ accepted: true });
    await rebuildApplicationMenu();
    if (keyCaptureDepth > 0) Menu.setApplicationMenu(null);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('app:open-history', () => {
    historyWindow.open();
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('app:continue-history', (_event, input: unknown) => {
    const request = AiHistoryLoadRequestSchema.parse(input);
    sendToRenderer('ai:history:continue', { id: request.id });
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('sftp:list', async (_event, input: unknown) => {
    const request = SftpListRequestSchema.parse(input);
    return SftpListResultSchema.parse(
      await sshSessions.listSftp(request.sessionId, request.directory, request.reanchor)
    );
  });
  ipcMain.handle('sftp:send-cd', async (_event, input: unknown) => {
    const request = SftpSendCdRequestSchema.parse(input);
    sshSessions.sendInput(request.sessionId, `cd ${quoteRemotePath(request.directory)}\r`);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('sftp:tracked-directory', async (_event, input: unknown) => {
    const request = SftpSessionRequestSchema.parse(input);
    return SftpCdEventSchema.parse({
      sessionId: request.sessionId,
      directory: sshSessions.trackedDirectory(request.sessionId)
    });
  });
  ipcMain.handle('sftp:mkdir', async (_event, input: unknown) => {
    const request = SftpMkdirRequestSchema.parse(input);
    await sshSessions.runSftp(request.sessionId, (service) => service.ensureDir(request.path));
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('sftp:rename', async (_event, input: unknown) => {
    const request = SftpRenameRequestSchema.parse(input);
    await sshSessions.runSftp(request.sessionId, (service) =>
      service.rename(request.source, request.destination)
    );
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('sftp:delete', async (_event, input: unknown) => {
    const request = SftpDeleteRequestSchema.parse(input);
    await sshSessions.runSftp(request.sessionId, async (service) => {
      for (const path of request.paths) await service.remove(path);
    });
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('sftp:upload-paths', async (_event, input: unknown) => {
    const request = SftpUploadPathsRequestSchema.parse(input);
    return SftpTransferSchema.array().parse(await transferManager.uploadPaths(request));
  });
  ipcMain.handle('sftp:download-paths', async (_event, input: unknown) => {
    const request = SftpDownloadPathsRequestSchema.parse(input);
    await fsMkdir(request.localDirectory, { recursive: true });
    return SftpTransferSchema.array().parse(await transferManager.downloadPaths(request));
  });
  ipcMain.handle('sftp:transfers', (_event, input: { sessionId?: string } | undefined) =>
    SftpTransferSchema.array().parse(transferManager.transfers(input?.sessionId))
  );
  ipcMain.handle('sftp:cancel-transfer', (_event, input: unknown) => {
    const request = SftpTransferIdRequestSchema.parse(input);
    return SftpOperationResultSchema.parse({
      accepted: transferManager.cancel(request.transferId)
    });
  });
  ipcMain.handle('sftp:upload', async (_event, input: unknown) => {
    const request = SftpUploadRequestSchema.parse(input);
    if (!mainWindow) throw new Error('Application window is not available');
    const properties: ('openFile' | 'openDirectory' | 'multiSelections')[] = ['multiSelections'];
    if (request.choose === 'files' || request.choose === 'both') properties.push('openFile');
    if (request.choose === 'folders' || request.choose === 'both') properties.push('openDirectory');
    const selection = await dialog.showOpenDialog(mainWindow, {
      properties,
      title:
        request.choose === 'folders'
          ? 'Select folders to upload'
          : request.choose === 'files'
            ? 'Select files to upload'
            : 'Select files or folders to upload'
    });
    if (selection.canceled || selection.filePaths.length === 0) {
      return SftpOperationResultSchema.parse({ accepted: false });
    }
    await transferManager.uploadPaths({
      sessionId: request.sessionId,
      localPaths: selection.filePaths,
      remoteDirectory: request.remoteDirectory
    });
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('sftp:download', async (_event, input: unknown) => {
    const request = SftpDownloadRequestSchema.parse(input);
    if (!mainWindow) throw new Error('Application window is not available');
    const selection = await dialog.showSaveDialog(mainWindow, {
      defaultPath: request.suggestedName,
      title: 'Save remote file'
    });
    if (selection.canceled || !selection.filePath) {
      return SftpOperationResultSchema.parse({ accepted: false });
    }
    await transferManager.downloadPaths({
      sessionId: request.sessionId,
      remotePaths: [request.remotePath],
      localDirectory: selection.filePath
    });
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('sftp:remote-command', async (_event, input: unknown) => {
    const request = SftpRemoteCommandRequestSchema.parse(input);
    const configured = parseRemoteFileCommands(storage.settingsSnapshot().remoteFileCommands);
    if (!configured.includes(request.command)) {
      throw new Error('That command is not in the configured remote-file commands');
    }
    const line = buildRemoteFileCommand(request.command, request.remotePath);
    sshSessions.sendInput(request.sessionId, `${line}\r`);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('local:list', async (_event, input: unknown) => {
    const request = LocalListRequestSchema.parse(input);
    return LocalEntrySchema.array().parse(await listLocalDirectory(request.directory));
  });
  ipcMain.handle('local:working-directory', (_event, input: unknown) => {
    const request = LocalSessionRequestSchema.parse(input);
    return LocalWorkingDirectorySchema.parse(localTerminals.workingDirectory(request.sessionId));
  });
  ipcMain.handle('local:mkdir', async (_event, input: unknown) => {
    const request = LocalMkdirRequestSchema.parse(input);
    await makeLocalDirectory(request.parent, request.name);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('local:rename', async (_event, input: unknown) => {
    const request = LocalRenameRequestSchema.parse(input);
    await renameLocalPath(request.source, request.destination);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('local:delete', async (_event, input: unknown) => {
    const request = LocalDeleteRequestSchema.parse(input);
    await removeLocalPaths(request.paths);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('local:open', async (_event, input: unknown) => {
    const request = LocalOpenRequestSchema.parse(input);
    const result = await shell.openPath(request.path);
    if (result) throw new Error(result);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('local:reveal', async (_event, input: unknown) => {
    const request = LocalOpenRequestSchema.parse(input);
    shell.showItemInFolder(request.path);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('themes:list', async () =>
    UserThemeListSchema.parse(await loadUserThemes(themesDirectory))
  );
  ipcMain.handle('themes:open-folder', async () => {
    await fsMkdir(themesDirectory, { recursive: true });
    const result = await shell.openPath(themesDirectory);
    if (result) throw new Error(result);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('app:downloads-dir', () => app.getPath('downloads'));
  ipcMain.handle('app:open-config-folder', async () => {
    const result = await shell.openPath(app.getPath('userData'));
    if (result) throw new Error(result);
    return SftpOperationResultSchema.parse({ accepted: true });
  });
  ipcMain.handle('app:runtime-info', () =>
    RuntimeInfoSchema.parse({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      configDirectory: app.getPath('userData'),
      themeDirectory: themesDirectory
    })
  );
  ipcMain.handle('environment:list', () =>
    EnvironmentRecordSchema.array().parse(storage.environmentSnapshot())
  );
  ipcMain.handle('environment:save', async (_event, input: unknown) => {
    const environment = EnvironmentRecordSchema.parse(input);
    return EnvironmentRecordSchema.array().parse(await storage.saveEnvironment(environment));
  });
  ipcMain.handle('environment:delete', async (_event, input: unknown) => {
    const request = ProfileIdRequestSchema.parse(input);
    return EnvironmentRecordSchema.array().parse(await storage.deleteEnvironment(request.id));
  });
  ipcMain.handle('environment:probe', async (_event, input: unknown) => {
    const request = EnvironmentProbeRequestSchema.parse(input);
    return EnvironmentFactsSchema.parse(
      await probeEnvironment(request.kind, request.distribution, process.platform, {
        shell: request.shell,
        cwd: request.cwd,
        environment: request.environment
      })
    );
  });
  ipcMain.handle('terminal:command-action', (_event, input: unknown) => {
    const request = TerminalCommandActionSchema.parse(input);
    if (commandRevision(request.payload) !== request.revision) {
      throw new Error('The command changed before the action was submitted');
    }
    if (request.action === 'run') {
      const candidate = parseCommandBlock(`\`\`\`${request.shell}\n${request.payload}\n\`\`\``);
      const riskyRunAllowed = storage.settingsSnapshot().allowRiskyRun;
      if (
        !candidate.runAllowed ||
        (candidate.risk === 'destructive' && !riskyRunAllowed) ||
        candidate.exactText !== request.payload
      ) {
        throw new Error('The command is not safe to run');
      }
    }
    // Validation (revision, run re-parse) compares against the raw payload;
    // only the bytes handed to the PTY are reworked. LF must become CR here
    // because ConPTY does not treat LF as Enter and PSReadLine garbles the
    // multi-line echo otherwise.
    const terminalInput = normalizeTerminalLineEndings(request.payload);
    const data = request.action === 'run' ? `${terminalInput}\r` : terminalInput;
    try {
      localTerminals.sendInput(request.sessionId, data);
      return { accepted: true };
    } catch {
      sshSessions.sendInput(request.sessionId, data);
      return { accepted: true };
    }
  });
  ipcMain.handle('terminal:ligature-sequences', async (_event, input: unknown) => {
    const request = TerminalLigatureRequestSchema.parse(input);
    return TerminalLigatureSequencesSchema.parse(await resolveTerminalLigatureSequences(request));
  });
  ipcMain.handle('wsl:list', async () => WslDistributionSchema.array().parse(await discoverWsl()));
  ipcMain.handle('ai:list', () =>
    AiConnectionRecordSchema.array().parse(storage.aiConnectionsSnapshot())
  );
  ipcMain.handle('ai:save', async (_event, input: unknown) => {
    const connection = AiConnectionInputSchema.parse(input);
    const saved = AiConnectionRecordSchema.array().parse(
      await storage.saveAiConnection(connection)
    );
    sendToRenderer('ai:connections-changed', saved);
    return saved;
  });
  ipcMain.handle('ai:accept-endpoint', async (_event, input: unknown) => {
    const request = AiEndpointConsentRequestSchema.parse(input);
    const saved = AiConnectionRecordSchema.array().parse(
      await storage.acceptAiEndpoint(request.connectionId, request.identity)
    );
    sendToRenderer('ai:connections-changed', saved);
    return saved;
  });
  ipcMain.handle('ai:delete', async (_event, input: unknown) => {
    const request = AiConnectionDeleteRequestSchema.parse(input);
    const saved = AiConnectionRecordSchema.array().parse(
      await storage.deleteAiConnection(request.id)
    );
    sendToRenderer('ai:connections-changed', saved);
    return saved;
  });

  ipcMain.on('terminal:create-local', (event, input: unknown) => {
    const port = event.ports[0];
    if (!port) {
      logger.warn('terminal', 'Local terminal request did not include a MessagePort');
      return;
    }
    try {
      localTerminals.create(input, port);
    } catch (error) {
      logger.error('terminal', 'Local terminal creation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      port.postMessage({
        kind: 'state',
        sessionId: 'unknown',
        sequence: 1,
        state: 'failed',
        detail: 'Unable to start local terminal'
      });
      port.close();
    }
  });

  ipcMain.on('terminal:create-ssh', (event, input: unknown) => {
    const port = event.ports[0];
    if (!port) {
      logger.warn('ssh', 'SSH terminal request did not include a MessagePort');
      return;
    }
    try {
      sshSessions.create(input, port);
    } catch (error) {
      logger.error('ssh', 'SSH terminal creation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      port.close();
    }
  });

  ipcMain.on('terminal:create-saved-ssh', (event, input: unknown) => {
    const port = event.ports[0];
    if (!port) {
      logger.warn('ssh', 'Saved SSH terminal request did not include a MessagePort');
      return;
    }
    try {
      const request = SshProfileTerminalRequestSchema.parse(input);
      sshSessions.create(
        storage.resolveSshProfile(request.profileId, request.sessionId, request.cols, request.rows),
        port
      );
    } catch (error) {
      logger.error('ssh', 'Saved SSH terminal creation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      port.close();
    }
  });

  ipcMain.on('ai:stream', (event, input: unknown) => {
    const port = event.ports[0];
    if (!port) {
      logger.warn('assistant', 'AI stream request did not include a MessagePort');
      return;
    }
    let request;
    try {
      request = AiStreamRequestSchema.parse(input);
    } catch (error) {
      port.postMessage({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Invalid AI stream request'
      });
      port.close();
      return;
    }
    if (aiControllers.has(request.streamId)) {
      port.postMessage({ kind: 'error', message: 'AI stream ID is already active' });
      port.close();
      return;
    }
    const controller = new AbortController();
    aiControllers.set(request.streamId, controller);
    let closed = false;
    port.start();
    port.on('message', (messageEvent) => {
      const message = AiStreamClientMessageSchema.safeParse(messageEvent.data);
      if (message.success && message.data.kind === 'cancel') controller.abort();
    });
    port.on('close', () => {
      closed = true;
      controller.abort();
      aiControllers.delete(request.streamId);
    });
    void (async () => {
      const startedAt = Date.now();
      let httpStatus: number | undefined;
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let reasoningTokens: number | undefined;
      const sourceUrls = new Set<string>();
      try {
        const connection = storage.resolveAiConnection(request.connectionId, request.model);
        const endpoint = normalizeEndpoint(connection.endpoint, connection.protocol);
        const environment = request.targetKey
          ? attachedEnvironmentForTarget(request.targetKey)
          : undefined;
        const context = buildAssistantContext({
          globalInstructions: storage.settingsSnapshot().globalAiInstructions,
          environment,
          history: request.messages,
          currentPrompt: request.prompt
        });
        const responseOptions = request.responseOptions ?? connection.responseOptions;
        logger.info('assistant', 'AI request prepared', {
          streamId: request.streamId,
          connectionId: connection.connectionId,
          model: connection.model,
          protocol: connection.protocol,
          messageCount: context.messages.length,
          systemBytes: context.systemBytes,
          inputBytes: context.inputBytes,
          categories: context.categories,
          reasoningEffort: responseOptions.reasoningEffort,
          verbosity: responseOptions.verbosity,
          reasoningSummary: responseOptions.reasoningSummary,
          webSearch: responseOptions.webSearch
        });
        if (connection.acceptedEndpoint !== endpoint.identity) {
          port.postMessage(
            AiStreamEventSchema.parse({
              kind: 'consent-required',
              endpoint: endpoint.baseUrl,
              identity: endpoint.identity,
              categories: context.categories
            })
          );
          return;
        }
        logger.info('assistant', 'AI request started', {
          streamId: request.streamId,
          connectionId: connection.connectionId,
          model: connection.model,
          protocol: connection.protocol
        });
        const payload =
          connection.protocol === 'responses'
            ? buildResponsesPayload(
                connection.model,
                context.messages,
                responseOptions,
                connection.connectionId
              )
            : buildChatCompletionsPayload(connection.model, context.messages);
        const providerResult = await streamAiRequest({
          connectionId: connection.connectionId,
          endpoint: connection.endpoint,
          protocol: connection.protocol,
          model: connection.model,
          payload,
          apiKey: connection.apiKey,
          signal: controller.signal,
          onEvent: (streamEvent) => {
            if (streamEvent.kind === 'usage') {
              inputTokens = streamEvent.inputTokens;
              outputTokens = streamEvent.outputTokens;
              reasoningTokens = streamEvent.reasoningTokens;
            } else if (streamEvent.kind === 'source') {
              sourceUrls.add(streamEvent.url);
            }
            if (!closed) port.postMessage(AiStreamEventSchema.parse(streamEvent));
          }
        });
        httpStatus = providerResult.status;
        logger.info('assistant', 'AI request completed', {
          streamId: request.streamId,
          connectionId: connection.connectionId,
          model: connection.model,
          protocol: connection.protocol,
          durationMs: Date.now() - startedAt,
          httpStatus,
          inputTokens,
          outputTokens,
          reasoningTokens,
          sourceCount: sourceUrls.size
        });
      } catch (error) {
        if (error instanceof AiProviderError) httpStatus = error.status;
        logger.warn('assistant', 'AI request failed', {
          streamId: request.streamId,
          connectionId: (() => {
            try {
              return storage.resolveAiConnection(request.connectionId, request.model).connectionId;
            } catch {
              return request.connectionId;
            }
          })(),
          model: request.model,
          protocol: (() => {
            try {
              return storage.resolveAiConnection(request.connectionId, request.model).protocol;
            } catch {
              return 'unknown';
            }
          })(),
          durationMs: Date.now() - startedAt,
          httpStatus,
          inputTokens,
          outputTokens,
          reasoningTokens,
          sourceCount: sourceUrls.size,
          failureReason: safeAssistantFailure(error)
        });
        if (!controller.signal.aborted && !closed) {
          port.postMessage({
            kind: 'error',
            message: error instanceof Error ? error.message : 'AI request failed'
          });
        }
      } finally {
        aiControllers.delete(request.streamId);
        if (!closed) {
          closed = true;
          port.close();
        }
      }
    })();
  });

  ipcMain.handle('ai:discover-models', async (_event, input: unknown) => {
    const request = AiDiscoverModelsRequestSchema.parse(input);
    if (request.connectionId) {
      const connection = storage.resolveAiConnection(request.connectionId, request.model ?? '');
      const result = await discoverModels({
        protocol: connection.protocol,
        baseUrl: connection.endpoint,
        apiKey: connection.apiKey
      });
      return AiDiscoveredModelsSchema.parse(result);
    }
    if (!request.protocol || !request.baseUrl) {
      throw new Error('Model discovery requires a connection or a protocol and base URL');
    }
    const endpoint = normalizeEndpoint(request.baseUrl, request.protocol);
    const result = await discoverModels({
      protocol: request.protocol,
      baseUrl: endpoint.baseUrl,
      model: request.model,
      apiKey: request.apiKey
    });
    return AiDiscoveredModelsSchema.parse(result);
  });

  ipcMain.handle('ai:history:list', async () => {
    const entries = await aiHistory.list();
    return AiHistoryListSchema.parse({
      entries: entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        model: entry.model,
        updatedAt: entry.updatedAt,
        messageCount: entry.messageCount
      }))
    });
  });

  ipcMain.handle('ai:history:load', async (_event, input: unknown) => {
    const request = AiHistoryLoadRequestSchema.parse(input);
    const record = await aiHistory.load(request.id);
    if (!record) throw new Error('Conversation was not found');
    return AiHistoryLoadResultSchema.parse({
      id: record.id,
      title: record.title,
      model: record.model,
      messages: record.messages
    });
  });

  ipcMain.handle('ai:history:save', async (_event, input: unknown) => {
    const request = AiHistorySaveRequestSchema.parse(input);
    try {
      return AiHistorySavedSchema.parse(await aiHistory.save(request));
    } catch (error) {
      logger.warn('assistant', 'AI history save failed', {
        id: request.id,
        messageCount: request.messages.length,
        failureReason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  });

  ipcMain.handle('ai:history:delete', async (_event, input: unknown) => {
    const request = AiHistoryLoadRequestSchema.parse(input);
    await aiHistory.remove(request.id);
    return { deleted: true };
  });

  ipcMain.handle('ai:history:clear', async () => {
    const removed = await aiHistory.clear();
    logger.debug('assistant', 'AI history cleared', { removed });
    return { cleared: true, removed };
  });

  ipcMain.handle('ai:history:open-directory', async () => {
    await fsMkdir(aiHistory.path, { recursive: true });
    await shell.openPath(aiHistory.path);
    return { opened: true };
  });
}

if (hasSingleInstanceLock) {
  void app.whenReady().then(async () => {
    const logDirectory = isDevelopment
      ? join(process.cwd(), 'debug-logs')
      : join(app.getPath('userData'), 'logs');
    logger = createLogger(logDirectory);
    storage = new AppStorage(app.getPath('userData'), logger, {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plaintext) => safeStorage.encryptString(plaintext),
      decryptString: (encrypted) => safeStorage.decryptString(encrypted),
      selectedStorageBackend: () =>
        process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined
    });
    await storage.load();
    environmentManager = new EnvironmentManager(storage, logger, (record) =>
      sendToRenderer('environment:updated', EnvironmentRecordSchema.parse(record))
    );
    localTerminals = new LocalTerminalManager(logger, {
      onReady: (details) => environmentManager.onLocalReady(details),
      onClosed: (sessionId) => environmentManager.onClosed(sessionId)
    });
    const knownHosts = new KnownHostsStore(
      join(app.getPath('userData'), 'known-hosts.json'),
      logger
    );
    transferManager = new TransferManager(
      (sessionId) => sshSessions.sftpService(sessionId),
      (event) => sendToRenderer('sftp:transfer-event', SftpTransferEventSchema.parse(event))
    );
    sshSessions = new SshSessionManager(logger, knownHosts, {
      onReady: (details) =>
        environmentManager.onSshReady(details, (signal) =>
          sshSessions.exec(details.sessionId, undefined, signal)
        ),
      onSftpCd: (sessionId, directory) =>
        sendToRenderer('sftp:cd', SftpCdEventSchema.parse({ sessionId, directory })),
      onClosed: (sessionId) => {
        environmentManager.onClosed(sessionId);
        transferManager.cancelForSession(sessionId);
      }
    });
    process.on('uncaughtException', (error) =>
      logger.error('system', 'Uncaught exception', { error: error.message })
    );
    process.on('unhandledRejection', (reason) =>
      logger.error('system', 'Unhandled rejection', { reason })
    );
    installSecurityHandlers();
    installContentSecurityPolicy();
    registerIpc();
    settingsWindow = new SettingsWindowManager(logger, isDevelopment, () => {
      // Safety net: restore the application menu if the settings window closes
      // mid-capture and the renderer never got to end the key capture.
      keyCaptureDepth = 0;
      void rebuildApplicationMenu();
    });
    historyWindow = new HistoryWindowManager(logger, isDevelopment);
    await rebuildApplicationMenu();
    trayController = new TrayController(
      logger,
      () => toggleMainWindow(),
      () => app.quit()
    );
    trayController.sync(
      storage.settingsSnapshot().keepRunningInBackground,
      resolveMenuLocale(storage.settingsSnapshot().language)
    );
    mainWindow = createWindow();
    applicationReady = true;
    if (pendingRestore) {
      pendingRestore = false;
      restoreMainWindow();
    }
    logger.info('app', 'Application ready', { packaged: app.isPackaged });
  });
}

app.on('before-quit', () => {
  quitRequested = true;
  localTerminals?.closeAll();
  sshSessions?.closeAll();
});

app.on('will-quit', () => {
  trayController?.destroy();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  // Background mode intentionally keeps the process resident with no windows;
  // the tray icon (or a fresh single-instance launch) restores it.
  if (backgroundModeEnabled()) return;
  app.quit();
});

app.on('activate', () => {
  restoreMainWindow();
});
