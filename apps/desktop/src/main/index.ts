import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { join } from 'node:path';
import {
  AppInfoSchema,
  EmptyRequestSchema,
  VaultPasswordRequestSchema
} from '@geared-term/protocol';
import { createLogger, type Logger } from './logging';
import { LocalTerminalManager } from './local-terminal';
import { AppStorage } from './persistence/app-storage';
import { KnownHostsStore } from './ssh/known-hosts';
import { SshSessionManager } from './ssh/ssh-session';

const isDevelopment = !app.isPackaged;
let logger: Logger;
let mainWindow: BrowserWindow | undefined;
let localTerminals: LocalTerminalManager;
let storage: AppStorage;
let sshSessions: SshSessionManager;

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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
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

  window.once('ready-to-show', () => window.show());
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
