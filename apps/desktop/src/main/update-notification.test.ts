import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateNoticeStore } from './persistence/update-notice-store';
import { UpdateNotificationController } from './update-notification';
import type { NightlyRelease } from './update-release';

const commitSha = 'abcdef0123456789abcdef0123456789abcdef01';
const nextSha = '1234567890abcdef1234567890abcdef12345678';

function release(sha: string): NightlyRelease {
  return {
    commitSha: sha,
    htmlUrl: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
    hasWindowsInstaller: true
  };
}

function makeStore(dismissed?: string): UpdateNoticeStore {
  let dismissedCommitSha = dismissed;
  return {
    dismissedCommitSha: () => dismissedCommitSha,
    dismiss: vi.fn(async (sha: string) => {
      dismissedCommitSha = sha;
    })
  } as unknown as UpdateNoticeStore;
}

function makeWindow(visible: () => boolean): BrowserWindow {
  return {
    isDestroyed: () => false,
    isVisible: visible,
    isMinimized: () => false
  } as unknown as BrowserWindow;
}

describe('UpdateNotificationController', () => {
  it('keeps a visible notice until the user dismisses or opens About', async () => {
    const window = makeWindow(() => true);
    const store = makeStore();
    const publish = vi.fn();
    const controller = new UpdateNotificationController(() => window, store, publish);

    controller.notify(release(commitSha));
    expect(controller.getNotice()).toEqual({ commitSha });
    expect(publish).toHaveBeenLastCalledWith({ commitSha });

    await controller.dismiss({ commitSha });
    expect(store.dismiss).toHaveBeenCalledWith(commitSha);
    expect(controller.getNotice()).toBeNull();
    expect(publish).toHaveBeenLastCalledWith(null);
  });

  it('defers notices while hidden and replays them when the main window is shown', () => {
    let visible = false;
    const window = makeWindow(() => visible);
    const publish = vi.fn();
    const controller = new UpdateNotificationController(() => window, makeStore(), publish);

    controller.notify(release(commitSha));
    expect(publish).not.toHaveBeenCalled();
    expect(controller.getNotice()).toBeNull();

    visible = true;
    controller.onMainWindowPresented();
    expect(controller.getNotice()).toEqual({ commitSha });
    expect(publish).toHaveBeenLastCalledWith({ commitSha });
  });

  it('suppresses the dismissed SHA and permits a newer nightly commit', async () => {
    const window = makeWindow(() => true);
    const store = makeStore();
    const controller = new UpdateNotificationController(() => window, store, vi.fn());

    controller.notify(release(commitSha));
    await controller.dismiss({ commitSha });
    controller.notify(release(commitSha));
    expect(controller.getNotice()).toBeNull();

    controller.notify(release(nextSha));
    expect(controller.getNotice()).toEqual({ commitSha: nextSha });
  });

  it('clears a pending notice while automatic checks are disabled', () => {
    const window = makeWindow(() => true);
    const publish = vi.fn();
    const controller = new UpdateNotificationController(() => window, makeStore(), publish);

    controller.notify(release(commitSha));
    controller.setEnabled(false);
    expect(controller.getNotice()).toBeNull();
    expect(publish).toHaveBeenLastCalledWith(null);

    controller.setEnabled(true);
    expect(controller.getNotice()).toBeNull();
  });

  it('rejects stale or malformed dismiss requests', async () => {
    const controller = new UpdateNotificationController(
      () => makeWindow(() => true),
      makeStore(),
      vi.fn()
    );

    await expect(controller.dismiss({ commitSha })).rejects.toThrow(
      'The update notice is no longer active'
    );
    await expect(controller.dismiss({ commitSha: 'invalid' })).rejects.toThrow();
  });
});
