import {
  BrowserWindow,
  WebContentsView,
  session,
  shell,
  type Session,
  type WebContents
} from 'electron';
import { join } from 'node:path';
import {
  LlmWebAdapterReportSchema,
  LlmWebCandidatesSchema,
  LlmWebNavigationSchema,
  LlmWebPaneStatusSchema,
  type LlmWebCandidates,
  type LlmWebNavigation,
  type LlmWebPaneBounds,
  type LlmWebPaneStatus,
  type LlmWebSiteId,
  type SettingsRecord
} from '@geared-term/protocol';
import type { Logger } from '../logging';
import { LLM_WEB_SITES, siteHostAllowed, sitePopupAllowed, type LlmWebSiteConfig } from './sites';
import { AdapterHealth, CandidateRelay, enhancementActiveFor } from './relay';

const partitionPoliciesInstalled = new WeakSet<Session>();

function installPartitionPolicies(webSession: Session, logger: Logger, partition: string): void {
  if (partitionPoliciesInstalled.has(webSession)) return;
  partitionPoliciesInstalled.add(webSession);
  // Embedded sites are untrusted origins: no permission may be granted through
  // the application and no download may touch disk without an app action.
  webSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    logger.warn('web', 'Denied site permission request', { partition, permission });
    callback(false);
  });
  webSession.setPermissionCheckHandler(() => false);
  webSession.on('will-download', (event) => {
    logger.warn('web', 'Denied site download', { partition });
    event.preventDefault();
  });
}

export type LlmWebPaneOptions = {
  logger: Logger;
  getMainWindow: () => BrowserWindow | undefined;
  settings: () => SettingsRecord;
  onNavigation: (navigation: LlmWebNavigation) => void;
  onStatus: (status: LlmWebPaneStatus) => void;
  onCandidates: (candidates: LlmWebCandidates) => void;
};

export class LlmWebPaneManager {
  private view: WebContentsView | undefined;
  private attachedWindow: BrowserWindow | undefined;
  private site: LlmWebSiteId | undefined;
  private bounds: LlmWebPaneBounds = { x: 0, y: 0, width: 0, height: 0 };
  private shown = false;
  private failed = false;
  private failureDetail = '';
  private readonly relay = new CandidateRelay();
  private readonly health = new AdapterHealth();
  private destroyed = false;

  public constructor(private readonly options: LlmWebPaneOptions) {}

  public get preloadWebPath(): string {
    return join(__dirname, '../preload/web.js');
  }

  public open(site: LlmWebSiteId): void {
    if (this.destroyed) return;
    if (!this.options.settings().llmWebEnabled) {
      this.setSite(site);
      this.emitStatus();
      return;
    }
    const window = this.options.getMainWindow();
    if (!window || window.isDestroyed()) {
      throw new Error('The main window is unavailable');
    }
    if (this.site === site && this.view && !this.view.webContents.isDestroyed()) {
      this.ensureAttached(window);
      this.show();
      return;
    }
    this.destroyView();
    const config = LLM_WEB_SITES[site];
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadWebPath,
        partition: config.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    this.view = view;
    this.site = site;
    this.failed = false;
    this.failureDetail = '';
    this.relay.reset();
    this.health.clear(site);
    view.setBackgroundColor('#111318');
    window.contentView.addChildView(view);
    this.attachedWindow = window;
    this.wireWebContents(view.webContents, config);
    installPartitionPolicies(view.webContents.session, this.options.logger, config.partition);
    void view.webContents.loadURL(config.homeUrl);
    this.show();
    this.options.logger.info('web', 'Opened LLM web pane', { site });
  }

  public navigate(action: 'back' | 'forward' | 'reload' | 'home'): void {
    const contents = this.currentWebContents();
    if (!contents) return;
    if (action === 'back' && contents.canGoBack()) contents.goBack();
    else if (action === 'forward' && contents.canGoForward()) contents.goForward();
    else if (action === 'reload') contents.reload();
    else if (action === 'home' && this.site) {
      void contents.loadURL(LLM_WEB_SITES[this.site].homeUrl);
    }
  }

  public setBounds(bounds: LlmWebPaneBounds): void {
    this.bounds = bounds;
    this.applyBounds();
  }

  public setVisible(visible: boolean): void {
    this.shown = visible;
    this.applyVisibility();
    if (visible) this.emitStatus();
  }

  public async clearSiteData(site: LlmWebSiteId): Promise<void> {
    const webSession = session.fromPartition(LLM_WEB_SITES[site].partition);
    await webSession.clearStorageData();
    this.options.logger.info('web', 'Cleared LLM web site data', { site });
    if (this.site === site) {
      this.currentWebContents()?.reload();
    }
  }

  public refreshStatus(): void {
    this.emitStatus();
  }

  public revealBlock(blockId: string): void {
    this.currentWebContents()?.send('llm-web:reveal-block', blockId);
  }

  public acceptCandidates(senderId: number, input: unknown): void {
    const parsed = LlmWebCandidatesSchema.safeParse(input);
    if (!parsed.success) return;
    if (
      !this.view ||
      this.view.webContents.isDestroyed() ||
      this.view.webContents.id !== senderId
    ) {
      return;
    }
    if (parsed.data.site !== this.site) return;
    const decision = this.relay.accept(
      parsed.data,
      this.options.settings(),
      parsed.data.site,
      Date.now()
    );
    if (decision.action === 'forward') this.options.onCandidates(decision.candidates);
    if (decision.action === 'clear') {
      this.options.onCandidates(
        LlmWebCandidatesSchema.parse({ site: parsed.data.site, groups: [] })
      );
    }
    if (decision.action === 'drop' && decision.reason === 'size') {
      this.options.logger.warn('web', 'Dropped oversized candidate report', {
        site: parsed.data.site,
        groups: parsed.data.groups.length
      });
    }
  }

  public acceptAdapterReport(senderId: number, input: unknown): void {
    const parsed = LlmWebAdapterReportSchema.safeParse(input);
    if (!parsed.success) return;
    if (
      !this.view ||
      this.view.webContents.isDestroyed() ||
      this.view.webContents.id !== senderId
    ) {
      return;
    }
    if (parsed.data.site !== this.site) return;
    this.health.record(parsed.data, Date.now());
    this.emitStatus();
  }

  public destroy(): void {
    this.destroyed = true;
    this.destroyView();
  }

  private currentWebContents(): WebContents | undefined {
    if (!this.view || this.view.webContents.isDestroyed()) return undefined;
    return this.view.webContents;
  }

  private ensureAttached(window: BrowserWindow): void {
    if (!this.view || this.attachedWindow === window) return;
    if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
      this.attachedWindow.contentView.removeChildView(this.view);
    }
    window.contentView.addChildView(this.view);
    this.attachedWindow = window;
    this.applyBounds();
    this.applyVisibility();
  }

  private show(): void {
    this.shown = true;
    this.applyBounds();
    this.applyVisibility();
    this.currentWebContents()?.focus();
    this.emitNavigation();
    this.emitStatus();
  }

  private applyBounds(): void {
    if (this.view && this.bounds.width > 0 && this.bounds.height > 0) {
      this.view.setBounds(this.bounds);
    }
  }

  private applyVisibility(): void {
    if (!this.view) return;
    const window = this.attachedWindow;
    const windowShown = Boolean(window && !window.isDestroyed() && window.isVisible());
    this.view.setVisible(this.shown && windowShown);
  }

  private destroyView(): void {
    if (!this.view) {
      this.site = undefined;
      return;
    }
    if (this.attachedWindow && !this.attachedWindow.isDestroyed()) {
      this.attachedWindow.contentView.removeChildView(this.view);
    }
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = undefined;
    this.site = undefined;
    this.relay.reset();
    this.failed = false;
  }

  private wireWebContents(contents: WebContents, config: LlmWebSiteConfig): void {
    const guardNavigation = (event: Electron.Event, url: string): void => {
      if (siteHostAllowed(config, url)) return;
      event.preventDefault();
      this.options.logger.warn('web', 'Blocked site navigation outside allowed hosts', {
        site: config.id
      });
      if (url.startsWith('https:')) void shell.openExternal(url);
    };
    contents.on('will-navigate', guardNavigation);
    contents.on('will-redirect', guardNavigation);
    contents.setWindowOpenHandler(({ url }) => {
      if (sitePopupAllowed(config, url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 720,
            height: 840,
            show: true,
            webPreferences: {
              partition: config.partition,
              preload: this.preloadWebPath,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
              spellcheck: false
            }
          }
        };
      }
      this.options.logger.warn('web', 'Denied site window.open', { site: config.id });
      if (url.startsWith('https:')) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('did-create-window', (childWindow) => {
      // Authentication popups stay inside the same partition but get the same
      // strict policies; they never host command surfaces.
      const childContents = childWindow.webContents;
      const guardChild = (event: Electron.Event, url: string): void => {
        if (siteHostAllowed(config, url) || sitePopupAllowed(config, url)) return;
        event.preventDefault();
        if (url.startsWith('https:')) void shell.openExternal(url);
      };
      childContents.on('will-navigate', guardChild);
      childContents.on('will-redirect', guardChild);
      childContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https:')) void shell.openExternal(url);
        return { action: 'deny' };
      });
      childWindow.once('ready-to-show', () => childWindow.show());
    });
    const emit = (): void => {
      this.emitNavigation();
    };
    contents.on('did-start-loading', emit);
    contents.on('did-stop-loading', emit);
    contents.on('did-navigate', emit);
    contents.on('did-navigate-in-page', emit);
    contents.on('page-title-updated', emit);
    contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      this.failed = true;
      this.failureDetail = errorDescription.slice(0, 200);
      this.emitNavigation();
      this.emitStatus();
    });
    contents.on('render-process-gone', (_event, details) => {
      this.failed = true;
      this.failureDetail = `render-process-${details.reason}`;
      this.options.logger.error('web', 'LLM web view renderer gone', {
        site: config.id,
        reason: details.reason
      });
      this.emitStatus();
    });
  }

  private emitNavigation(): void {
    const contents = this.currentWebContents();
    if (!contents) return;
    this.options.onNavigation(
      LlmWebNavigationSchema.parse({
        site: this.site ?? null,
        url: contents.getURL(),
        title: contents.getTitle(),
        canGoBack: contents.canGoBack(),
        canGoForward: contents.canGoForward(),
        isLoading: contents.isLoading()
      })
    );
  }

  private emitStatus(): void {
    const settings = this.options.settings();
    const contents = this.currentWebContents();
    let state: LlmWebPaneStatus['state'] = 'hidden';
    let detail = '';
    if (!settings.llmWebEnabled) {
      state = 'off';
    } else if (!contents) {
      state = 'hidden';
    } else if (this.failed) {
      state = 'failed';
      detail = this.failureDetail;
    } else if (contents.isLoading()) {
      state = 'loading';
    } else if (this.site !== undefined && !enhancementActiveFor(settings, this.site)) {
      state = 'ready';
    } else {
      const report = this.site ? this.health.get(this.site, Date.now()) : undefined;
      if (report?.report.chatSurface) state = 'enhanced';
      else if (report) state = 'degraded';
      else state = 'ready';
    }
    this.options.onStatus(
      LlmWebPaneStatusSchema.parse({
        site: this.site ?? null,
        state,
        detail
      })
    );
  }

  private setSite(site: LlmWebSiteId): void {
    this.site = site;
  }
}
