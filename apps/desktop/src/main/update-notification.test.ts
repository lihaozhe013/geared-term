import type { BrowserWindow, MessageBoxOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './logging';
import { UpdateNotificationController } from './update-notification';
import type { NightlyRelease } from './update-release';

const release: NightlyRelease = {
  commitSha: 'abcdef0123456789abcdef0123456789abcdef01',
  htmlUrl: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
  hasWindowsInstaller: true
};

function makeWindow(visible: () => boolean): BrowserWindow {
  return {
    isDestroyed: () => false,
    isVisible: visible,
    isMinimized: () => false
  } as unknown as BrowserWindow;
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger;
}

describe('UpdateNotificationController', () => {
  it('shows a localized prompt and opens About when selected', async () => {
    const window = makeWindow(() => true);
    const openAboutSettings = vi.fn();
    const showMessageBox = vi
      .fn<(parent: BrowserWindow, options: MessageBoxOptions) => Promise<{ response: number }>>()
      .mockResolvedValue({ response: 0 });
    const controller = new UpdateNotificationController(
      makeLogger(),
      () => window,
      () => 'zh-CN',
      openAboutSettings,
      showMessageBox
    );

    controller.notify(release);
    await vi.waitFor(() => expect(openAboutSettings).toHaveBeenCalledOnce());

    expect(showMessageBox).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        title: '\u53d1\u73b0\u65b0\u7248\u672c',
        buttons: ['\u524d\u5f80\u8bbe\u7f6e', '\u7a0d\u540e'],
        message: expect.stringContaining('abcdef0')
      })
    );
  });

  it('defers while the main window is hidden and does not reopen after Later', async () => {
    let visible = false;
    const window = makeWindow(() => visible);
    const openAboutSettings = vi.fn();
    const showMessageBox = vi
      .fn<(parent: BrowserWindow, options: MessageBoxOptions) => Promise<{ response: number }>>()
      .mockResolvedValue({ response: 1 });
    const controller = new UpdateNotificationController(
      makeLogger(),
      () => window,
      () => 'en-US',
      openAboutSettings,
      showMessageBox
    );

    controller.notify(release);
    expect(showMessageBox).not.toHaveBeenCalled();

    visible = true;
    controller.onMainWindowPresented();
    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledOnce());
    controller.onMainWindowPresented();
    controller.notify(release);

    expect(showMessageBox).toHaveBeenCalledOnce();
    expect(showMessageBox).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        title: 'Update available',
        buttons: ['Open Settings', 'Later']
      })
    );
    expect(openAboutSettings).not.toHaveBeenCalled();
  });
});
