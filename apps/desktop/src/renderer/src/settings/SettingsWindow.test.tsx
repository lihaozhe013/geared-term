// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AppInfoSchema,
  RuntimeInfoSchema,
  SettingsRecordSchema,
  UpdateStatusSchema,
  type SettingsPatch,
  type SettingsRecord
} from '@geared-term/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsWindow } from './SettingsWindow';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
} {
  let resolve = (_value: T): void => undefined;
  let reject = (_reason: Error): void => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const initialSettings = SettingsRecordSchema.parse({
  schemaVersion: 1,
  language: 'en-US',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalCursor: 'block',
  defaultTerm: 'xterm-256color',
  terminalContextPrecedingLines: 100
});

function installBridge(
  patchSettings: (patch: SettingsPatch) => Promise<SettingsRecord>,
  getSettings: () => Promise<SettingsRecord>
): void {
  const bridge = {
    platform: 'darwin',
    getSettings,
    patchSettings,
    listUserThemes: async () => ({ themes: [], invalid: [] }),
    listSystemFonts: async () => [],
    getAppInfo: async () =>
      AppInfoSchema.parse({
        name: 'Geared Term',
        version: '0.1.0',
        isPackaged: false,
        platform: 'darwin'
      }),
    getRuntimeInfo: async () =>
      RuntimeInfoSchema.parse({
        electron: '44',
        chrome: '141',
        node: '24',
        configDirectory: '/tmp/config',
        themeDirectory: '/tmp/themes'
      }),
    getUpdateStatus: async () => UpdateStatusSchema.parse({ state: 'idle', currentSha: 'unknown' }),
    onSettingsChanged: () => () => undefined,
    onSettingsNavigate: () => () => undefined,
    onUpdateStatus: () => () => undefined
  };
  Object.defineProperty(window, 'geared', { configurable: true, value: bridge });
}

describe('SettingsWindow immediate saves', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    Reflect.deleteProperty(window, 'geared');
    root = undefined;
    container = undefined;
  });

  async function renderWindow(): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<SettingsWindow />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    const appearance = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Appearance')
    );
    await act(async () => appearance?.click());
    return container;
  }

  function minimalModeCheckbox(view: HTMLDivElement): HTMLInputElement {
    const label = [...view.querySelectorAll('.settings-check')].find((entry) =>
      entry.textContent?.includes('Minimal mode')
    );
    const input = label?.querySelector('input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Minimal mode checkbox is missing');
    return input;
  }

  it('ignores an older failed response after a newer value has saved', async () => {
    const first = deferred<SettingsRecord>();
    const second = deferred<SettingsRecord>();
    let saved = initialSettings;
    let call = 0;
    const patchSettings = vi.fn((patch: SettingsPatch) => {
      call += 1;
      if (call === 1) return first.promise;
      saved = SettingsRecordSchema.parse({ ...saved, ...patch });
      return second.promise;
    });
    installBridge(patchSettings, async () => saved);
    const view = await renderWindow();
    const checkbox = minimalModeCheckbox(view);

    await act(async () => checkbox.click());
    await act(async () => checkbox.click());
    expect(patchSettings).toHaveBeenNthCalledWith(1, { minimalMode: false });
    expect(patchSettings).toHaveBeenNthCalledWith(2, { minimalMode: true });

    await act(async () => {
      second.resolve(saved);
      await second.promise;
    });
    await act(async () => {
      first.reject(new Error('Superseded write failed'));
      await first.promise.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(minimalModeCheckbox(view).checked).toBe(true);
    expect(view.querySelector('[role="alert"]')).toBeNull();
    expect(view.textContent).not.toContain('Retry');
  });

  it('shows a failed save and retries it without claiming success early', async () => {
    let saved = initialSettings;
    const patchSettings = vi
      .fn(async (_patch: SettingsPatch) => initialSettings)
      .mockRejectedValueOnce(new Error('Disk is full'))
      .mockImplementationOnce(async (patch) => {
        saved = SettingsRecordSchema.parse({ ...saved, ...patch });
        return saved;
      });
    installBridge(patchSettings, async () => saved);
    const view = await renderWindow();
    const checkbox = minimalModeCheckbox(view);

    await act(async () => {
      checkbox.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(view.querySelector('[role="alert"]')?.textContent).toContain('Retry');
    expect(saved.minimalMode).toBe(true);

    const retry = [...view.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Retry')
    );
    await act(async () => {
      retry?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(saved.minimalMode).toBe(false);
    expect(view.querySelector('[role="alert"]')).toBeNull();
  });
});
