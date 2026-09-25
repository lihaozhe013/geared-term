import type { BrowserWindow } from 'electron';
import {
  UpdateNoticeDismissRequestSchema,
  UpdateNoticeSchema,
  type UpdateNotice
} from '@geared-term/protocol';
import type { UpdateNoticeStore } from './persistence/update-notice-store';
import type { NightlyRelease } from './update-release';

type NoticePublisher = (notice: UpdateNotice | null) => void;

export class UpdateNotificationController {
  private pendingNotice: UpdateNotice | undefined;
  private enabled: boolean;
  private dismissPromise: { commitSha: string; promise: Promise<void> } | undefined;

  public constructor(
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly noticeStore: UpdateNoticeStore,
    private readonly publishNotice: NoticePublisher,
    enabled = true
  ) {
    this.enabled = enabled;
  }

  public notify(release: NightlyRelease): void {
    const notice = UpdateNoticeSchema.parse({ commitSha: release.commitSha });
    if (!this.enabled || this.noticeStore.dismissedCommitSha() === notice.commitSha) return;
    this.pendingNotice = notice;
    this.publishIfVisible();
  }

  public getNotice(): UpdateNotice | null {
    return this.isMainWindowVisible() ? (this.enabled ? (this.pendingNotice ?? null) : null) : null;
  }

  public async dismiss(input: unknown): Promise<void> {
    const request = UpdateNoticeDismissRequestSchema.parse(input);
    if (this.dismissPromise) {
      if (this.dismissPromise.commitSha !== request.commitSha) {
        throw new Error('Another update notice is being dismissed');
      }
      return this.dismissPromise.promise;
    }
    if (!this.pendingNotice || this.pendingNotice.commitSha !== request.commitSha) {
      throw new Error('The update notice is no longer active');
    }
    const promise = this.noticeStore.dismiss(request.commitSha).then(() => {
      if (this.pendingNotice?.commitSha === request.commitSha) this.pendingNotice = undefined;
      this.publishIfVisible();
    });
    this.dismissPromise = { commitSha: request.commitSha, promise };
    try {
      await promise;
    } finally {
      this.dismissPromise = undefined;
    }
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.pendingNotice = undefined;
      this.publishNotice(null);
      return;
    }
    this.publishIfVisible();
  }

  public onMainWindowPresented(): void {
    this.publishIfVisible();
  }

  private publishIfVisible(): void {
    if (!this.isMainWindowVisible()) return;
    this.publishNotice(this.enabled ? (this.pendingNotice ?? null) : null);
  }

  private isMainWindowVisible(): boolean {
    const window = this.getMainWindow();
    if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) {
      return false;
    }
    return true;
  }
}
