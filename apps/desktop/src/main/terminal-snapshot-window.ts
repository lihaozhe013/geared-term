import { BrowserWindow, type WebContents } from 'electron';
import { join } from 'node:path';
import type {
  TerminalSnapshotDraft,
  TerminalSnapshotDraftChatRequest,
  TerminalSnapshotDraftRequest
} from '@geared-term/protocol';
import type { Logger } from './logging';
import {
  forwardWindowControlState,
  hideNativeMenuBar,
  showWindowWhenReady,
  windowChromeOptions
} from './window-chrome';

type SnapshotEditorState = {
  window: BrowserWindow;
  draft: TerminalSnapshotDraft;
};

type TerminalSnapshotWindowOptions = {
  logger: Logger;
  isDevelopment: boolean;
  onAddToAssistant: (text: string) => void;
};

export class TerminalSnapshotWindowManager {
  private state: SnapshotEditorState | undefined;

  public constructor(private readonly options: TerminalSnapshotWindowOptions) {}

  public open(request: TerminalSnapshotDraftRequest): { accepted: true } {
    const current = this.liveState();
    if (current) {
      this.focus(current.window);
      return { accepted: true };
    }

    const window = this.createWindow();
    const state: SnapshotEditorState = { window, draft: { text: request.text } };
    this.state = state;
    window.on('closed', () => {
      if (this.state === state) this.state = undefined;
    });
    this.load(window);
    this.options.logger.info('terminal', 'Snapshot draft editor opened', {
      characterCount: request.text.length
    });
    return { accepted: true };
  }

  public draft(sender: WebContents): TerminalSnapshotDraft {
    return this.requireSender(sender).draft;
  }

  public addToAssistant(
    sender: WebContents,
    request: TerminalSnapshotDraftChatRequest
  ): { accepted: true } {
    this.requireSender(sender);
    this.options.onAddToAssistant(request.text);
    return { accepted: true };
  }

  private requireSender(sender: WebContents): SnapshotEditorState {
    const state = this.liveState();
    if (!state || state.window.webContents.id !== sender.id) {
      throw new Error('Terminal snapshot request did not come from the active draft window');
    }
    return state;
  }

  private focus(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  private liveState(): SnapshotEditorState | undefined {
    if (this.state?.window.isDestroyed()) this.state = undefined;
    return this.state;
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: 1080,
      height: 740,
      minWidth: 760,
      minHeight: 500,
      title: 'Terminal Snapshot Draft — Geared Term',
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
    showWindowWhenReady(window, this.options.logger, 'terminal-snapshot-editor');
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
      this.options.logger.warn('system', 'Blocked terminal snapshot window navigation', { url });
    };
    window.webContents.on('will-navigate', blockExternalNavigation);
    window.webContents.on('will-redirect', blockExternalNavigation);
    return window;
  }

  private load(window: BrowserWindow): void {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (this.options.isDevelopment && rendererUrl) {
      void window.loadURL(`${rendererUrl}/snapshot.html`);
    } else {
      void window.loadFile(join(__dirname, '../renderer/snapshot.html'));
    }
  }
}
