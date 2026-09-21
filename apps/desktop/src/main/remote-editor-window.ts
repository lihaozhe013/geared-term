import { app, BrowserWindow, dialog, type WebContents } from 'electron';
import { join } from 'node:path';
import type {
  SettingsRecord,
  SftpEditorDocument,
  SftpEditorOpenRequest,
  SftpEditorOpenResult,
  SftpEditorSaveRequest,
  SftpEditorSaveResult,
  SftpEditorSavedEvent
} from '@geared-term/protocol';
import type { Logger } from './logging';
import {
  readRemoteEditorFile,
  saveRemoteEditorFile,
  type RemoteEditorSnapshot
} from './sftp/editor-file';
import type { SftpService } from './sftp/sftp-service';
import {
  forwardWindowControlState,
  hideNativeMenuBar,
  showWindowWhenReady,
  windowChromeOptions
} from './window-chrome';

type EditorState = {
  window: BrowserWindow;
  sessionId: string;
  remotePath: string;
  snapshot: RemoteEditorSnapshot;
  dirty: boolean;
  allowUnload: boolean;
  saving: boolean;
};

type RemoteEditorWindowOptions = {
  logger: Logger;
  isDevelopment: boolean;
  getLanguage: () => SettingsRecord['language'];
  getSftp: (sessionId: string) => Promise<SftpService>;
  onSaved: (event: SftpEditorSavedEvent) => void;
};

export class RemoteEditorWindowManager {
  private state: EditorState | undefined;
  private opening: Promise<SftpEditorOpenResult> | undefined;

  public constructor(private readonly options: RemoteEditorWindowOptions) {}

  public async open(request: SftpEditorOpenRequest): Promise<SftpEditorOpenResult> {
    let current = this.liveState();
    if (current) {
      return this.focusResult(current, request);
    }

    if (this.opening) {
      await this.opening;
      current = this.liveState();
      if (current) return this.focusResult(current, request);
    }

    const opening = this.openFresh(request);
    this.opening = opening;
    try {
      return await opening;
    } catch (error) {
      this.options.logger.warn('ssh', 'Remote editor open failed', {
        sessionId: request.sessionId,
        failureReason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }

  public document(sender: WebContents): SftpEditorDocument {
    return this.requireSender(sender).snapshot.document;
  }

  public async reload(sender: WebContents): Promise<SftpEditorDocument> {
    const state = this.requireSender(sender);
    try {
      const service = await this.options.getSftp(state.sessionId);
      state.snapshot = await readRemoteEditorFile(service, state.remotePath);
      state.dirty = false;
      this.options.logger.info('ssh', 'Remote editor reloaded', {
        sessionId: state.sessionId,
        byteLength: state.snapshot.document.byteLength
      });
      return state.snapshot.document;
    } catch (error) {
      this.options.logger.warn('ssh', 'Remote editor reload failed', {
        sessionId: state.sessionId,
        failureReason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  public async save(
    sender: WebContents,
    request: SftpEditorSaveRequest
  ): Promise<SftpEditorSaveResult> {
    const state = this.requireSender(sender);
    if (state.saving) throw new Error('A remote editor save is already in progress');
    state.saving = true;
    try {
      const service = await this.options.getSftp(state.sessionId);
      const outcome = await saveRemoteEditorFile(
        service,
        state.remotePath,
        request.content,
        state.snapshot.document,
        state.snapshot.revision,
        request.overwriteConflict
      );
      if (outcome.result.status === 'saved' && outcome.snapshot) {
        state.snapshot = outcome.snapshot;
        state.dirty = false;
        this.options.onSaved({ sessionId: state.sessionId, remotePath: state.remotePath });
        this.options.logger.info('ssh', 'Remote editor saved', {
          sessionId: state.sessionId,
          byteLength: outcome.result.byteLength
        });
      } else {
        this.options.logger.info('ssh', 'Remote editor save conflict', {
          sessionId: state.sessionId,
          reason: outcome.result.status === 'conflict' ? outcome.result.reason : 'unknown'
        });
      }
      return outcome.result;
    } catch (error) {
      this.options.logger.warn('ssh', 'Remote editor save failed', {
        sessionId: state.sessionId,
        failureReason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      state.saving = false;
    }
  }

  public setDirty(sender: WebContents, dirty: boolean): void {
    this.requireSender(sender).dirty = dirty;
  }

  public confirmBeforeQuit(): boolean {
    const state = this.liveState();
    if (!state || !state.dirty || state.allowUnload) return true;
    if (!this.confirmDiscard(state.window)) return false;
    state.allowUnload = true;
    return true;
  }

  private async openFresh(request: SftpEditorOpenRequest): Promise<SftpEditorOpenResult> {
    const service = await this.options.getSftp(request.sessionId);
    const snapshot = await readRemoteEditorFile(service, request.remotePath);
    const window = this.createWindow(snapshot.document.name);
    const state: EditorState = {
      window,
      sessionId: request.sessionId,
      remotePath: request.remotePath,
      snapshot,
      dirty: false,
      allowUnload: false,
      saving: false
    };
    this.state = state;
    this.attachLifecycle(state);
    this.load(window);
    this.options.logger.info('ssh', 'Remote editor opened', {
      sessionId: request.sessionId,
      byteLength: snapshot.document.byteLength
    });
    return { status: 'opened', activePath: request.remotePath };
  }

  private focusResult(state: EditorState, request: SftpEditorOpenRequest): SftpEditorOpenResult {
    if (state.window.isMinimized()) state.window.restore();
    state.window.focus();
    return {
      status:
        state.sessionId === request.sessionId && state.remotePath === request.remotePath
          ? 'focused'
          : 'busy',
      activePath: state.remotePath
    };
  }

  private liveState(): EditorState | undefined {
    if (this.state?.window.isDestroyed()) this.state = undefined;
    return this.state;
  }

  private requireSender(sender: WebContents): EditorState {
    const state = this.liveState();
    if (!state || state.window.webContents.id !== sender.id) {
      throw new Error('Remote editor request did not come from the active editor window');
    }
    return state;
  }

  private createWindow(name: string): BrowserWindow {
    const window = new BrowserWindow({
      width: 1000,
      height: 720,
      minWidth: 900,
      minHeight: 600,
      title: `${name} — Geared Term`,
      show: false,
      ...windowChromeOptions(),
      backgroundColor: '#0d1117',
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
    showWindowWhenReady(window, this.options.logger, 'remote-editor');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const blockExternalNavigation = (event: Electron.Event, url: string): void => {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL;
      if (this.options.isDevelopment && rendererUrl) {
        try {
          if (new URL(url).origin === new URL(rendererUrl).origin) return;
        } catch {
          // Treat malformed navigation URLs as external content.
        }
      }
      event.preventDefault();
      this.options.logger.warn('system', 'Blocked remote editor window navigation', { url });
    };
    window.webContents.on('will-navigate', blockExternalNavigation);
    window.webContents.on('will-redirect', blockExternalNavigation);
    return window;
  }

  private attachLifecycle(state: EditorState): void {
    const { window } = state;
    window.on('close', (event) => {
      if (state.allowUnload || !state.dirty) return;
      event.preventDefault();
      if (!this.confirmDiscard(window)) return;
      state.allowUnload = true;
      window.close();
    });
    window.webContents.on('will-prevent-unload', (event) => {
      if (state.allowUnload || !state.dirty) {
        event.preventDefault();
        return;
      }
      if (!this.confirmDiscard(window)) return;
      state.dirty = false;
      event.preventDefault();
    });
    window.on('closed', () => {
      if (this.state === state) this.state = undefined;
    });
  }

  private confirmDiscard(window: BrowserWindow): boolean {
    const language = this.options.getLanguage();
    const locale = language === 'system' ? app.getLocale().toLowerCase() : language.toLowerCase();
    const chinese = locale.startsWith('zh');
    const response = dialog.showMessageBoxSync(window, {
      type: 'warning',
      title: chinese ? '未保存的远端文件' : 'Unsaved remote file',
      message: chinese ? '放弃尚未保存的修改吗？' : 'Discard the unsaved changes?',
      detail: chinese
        ? '关闭窗口后，这些内容无法恢复。'
        : 'The edited content cannot be recovered after the window closes.',
      buttons: chinese ? ['放弃修改', '取消'] : ['Discard changes', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    });
    return response === 0;
  }

  private load(window: BrowserWindow): void {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
      void window.loadURL(`${rendererUrl}/editor.html`);
    } else {
      void window.loadFile(join(__dirname, '../renderer/editor.html'));
    }
  }
}
