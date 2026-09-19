import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron';
import { join } from 'node:path';
import {
  AppInfoSchema,
  AiConnectionDeleteRequestSchema,
  AiConnectionInputSchema,
  AiConnectionRecordSchema,
  AiStreamClientMessageSchema,
  AiStreamEventSchema,
  AiStreamRequestSchema,
  EnvironmentFactsSchema,
  EnvironmentProbeRequestSchema,
  EnvironmentRecordSchema,
  EmptyRequestSchema,
  ProfileIdRequestSchema,
  SessionProfileRecordSchema,
  SettingsRecordSchema,
  SftpListRequestSchema,
  SftpRemoteEntrySchema,
  SshProfileTerminalRequestSchema,
  TerminalCommandActionSchema,
  UiStateRecordSchema,
  VaultPasswordRequestSchema,
  WslDistributionSchema
} from '@geared-term/protocol';
import { createLogger, type Logger } from './logging';
import { buildChatCompletionsPayload, buildResponsesPayload } from './ai/endpoint';
import { streamAiRequest } from './ai/provider';
import { LocalTerminalManager } from './local-terminal';
import { commandRevision, parseCommandBlock } from '@geared-term/command-parser';
import { AppStorage } from './persistence/app-storage';
import { KnownHostsStore } from './ssh/known-hosts';
import { SshSessionManager } from './ssh/ssh-session';
import { discoverWsl } from './wsl/discovery';
import { probeEnvironment } from './environment/probe';

const isDevelopment = !app.isPackaged;
let logger: Logger;
let mainWindow: BrowserWindow | undefined;
let localTerminals: LocalTerminalManager;
let storage: AppStorage;
let sshSessions: SshSessionManager;
const aiControllers = new Map<string, AbortController>();

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function installSecurityHandlers(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
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
    backgroundColor: '#111318',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  let persistingWindowState = false;

  window.once('ready-to-show', () => {
    if (storage.uiStateSnapshot().maximized) window.maximize();
    window.show();
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
      .finally(() => window.close());
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

  const contentSecurityPolicy = isDevelopment
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' http://localhost:*; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:* ws://localhost:*;"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';";
  window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy]
      }
    });
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

  ipcMain.handle('vault:get-status', () => storage.vaultStatus());
  ipcMain.handle('vault:initialize', async (_event, input: unknown) => {
    const request = VaultPasswordRequestSchema.parse(input);
    await storage.initializeVault(request.password);
    return storage.vaultStatus();
  });
  ipcMain.handle('vault:unlock', async (_event, input: unknown) => {
    const request = VaultPasswordRequestSchema.parse(input);
    await storage.unlockVault(request.password);
    return storage.vaultStatus();
  });
  ipcMain.handle('vault:lock', () => {
    storage.lockVault();
    return storage.vaultStatus();
  });

  ipcMain.handle('profile:list', () =>
    SessionProfileRecordSchema.array().parse(storage.profileSnapshot())
  );
  ipcMain.handle('profile:save', async (_event, input: unknown) => {
    const profile = SessionProfileRecordSchema.parse(input);
    return SessionProfileRecordSchema.array().parse(await storage.saveProfile(profile));
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
    return SettingsRecordSchema.parse(await storage.saveSettings(settings));
  });
  ipcMain.handle('sftp:list', async (_event, input: unknown) => {
    const request = SftpListRequestSchema.parse(input);
    return SftpRemoteEntrySchema.array().parse(
      await sshSessions.listSftp(request.sessionId, request.directory)
    );
  });
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
    return EnvironmentFactsSchema.parse(await probeEnvironment(request.kind, request.distribution));
  });
  ipcMain.handle('terminal:command-action', (_event, input: unknown) => {
    const request = TerminalCommandActionSchema.parse(input);
    if (commandRevision(request.payload) !== request.revision) {
      throw new Error('The command changed before the action was submitted');
    }
    if (request.action === 'run') {
      const candidate = parseCommandBlock(`\`\`\`${request.shell}\n${request.payload}\n\`\`\``);
      if (
        !candidate.runAllowed ||
        candidate.risk === 'destructive' ||
        candidate.exactText !== request.payload
      ) {
        throw new Error('The command is not safe to run');
      }
    }
    const data = request.action === 'run' ? `${request.payload}\r` : request.payload;
    try {
      localTerminals.sendInput(request.sessionId, data);
      return { accepted: true };
    } catch {
      sshSessions.sendInput(request.sessionId, data);
      return { accepted: true };
    }
  });
  ipcMain.handle('wsl:list', async () => WslDistributionSchema.array().parse(await discoverWsl()));
  ipcMain.handle('ai:list', () =>
    AiConnectionRecordSchema.array().parse(storage.aiConnectionsSnapshot())
  );
  ipcMain.handle('ai:save', async (_event, input: unknown) => {
    const connection = AiConnectionInputSchema.parse(input);
    return AiConnectionRecordSchema.array().parse(await storage.saveAiConnection(connection));
  });
  ipcMain.handle('ai:delete', async (_event, input: unknown) => {
    const request = AiConnectionDeleteRequestSchema.parse(input);
    return AiConnectionRecordSchema.array().parse(await storage.deleteAiConnection(request.id));
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
      try {
        const connection = storage.resolveAiConnection(request.connectionId, request.model);
        const payload =
          connection.protocol === 'responses'
            ? buildResponsesPayload(connection.model, request.messages)
            : buildChatCompletionsPayload(connection.model, request.messages);
        await streamAiRequest({
          endpoint: connection.endpoint,
          protocol: connection.protocol,
          model: connection.model,
          payload,
          apiKey: connection.apiKey,
          signal: controller.signal,
          onEvent: (streamEvent) => {
            if (!closed) port.postMessage(AiStreamEventSchema.parse(streamEvent));
          }
        });
      } catch (error) {
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
}

void app.whenReady().then(async () => {
  const logDirectory = isDevelopment
    ? join(process.cwd(), 'debug-logs')
    : join(app.getPath('userData'), 'logs');
  logger = createLogger(logDirectory);
  localTerminals = new LocalTerminalManager(logger);
  storage = new AppStorage(app.getPath('userData'), logger);
  await storage.load();
  const knownHosts = new KnownHostsStore(join(app.getPath('userData'), 'known-hosts.json'), logger);
  sshSessions = new SshSessionManager(logger, knownHosts);
  process.on('uncaughtException', (error) =>
    logger.error('system', 'Uncaught exception', { error: error.message })
  );
  process.on('unhandledRejection', (reason) =>
    logger.error('system', 'Unhandled rejection', { reason })
  );
  installSecurityHandlers();
  registerIpc();
  mainWindow = createWindow();
  logger.info('app', 'Application ready', { packaged: app.isPackaged });
});

app.on('before-quit', () => {
  localTerminals?.closeAll();
  sshSessions?.closeAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
  }
});
