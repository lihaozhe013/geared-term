// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoUnlockStatus, VaultStatus } from '@geared-term/protocol';
import { SecurityVaultSection } from './SecurityVault';
import type { Translate } from './sections';

const supported: AutoUnlockStatus = { supported: true, enabled: false };
const unavailable: AutoUnlockStatus = {
  supported: false,
  enabled: false,
  reasonCode: 'service_unavailable'
};
const vault: VaultStatus = { initialized: true, unlocked: true };
const translate = ((key: string) => key) as Translate;

describe('SecurityVaultSection auto-unlock status', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function renderWithAutoUnlockStatus(
    getAutoUnlockStatus: () => Promise<AutoUnlockStatus>
  ): HTMLDivElement {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    Object.defineProperty(window, 'geared', {
      configurable: true,
      value: {
        getVaultStatus: vi.fn(async () => vault),
        getAutoUnlockStatus,
        onVaultChanged: vi.fn(() => () => undefined),
        initializeVault: vi.fn(),
        unlockVault: vi.fn(),
        lockVault: vi.fn(async () => ({ ...vault, unlocked: false })),
        rotateVault: vi.fn(async () => vault),
        enableAutoUnlock: vi.fn(async () => supported),
        disableAutoUnlock: vi.fn(async () => ({ ...supported, enabled: false }))
      },
      writable: true
    });
    return container;
  }

  it('lets the user retry after an initial status query fails', async () => {
    const getAutoUnlockStatus = vi
      .fn<() => Promise<AutoUnlockStatus>>()
      .mockRejectedValueOnce(new Error('temporary query failure'))
      .mockResolvedValueOnce(supported);
    const view = renderWithAutoUnlockStatus(getAutoUnlockStatus);
    await act(async () => root?.render(<SecurityVaultSection t={translate} />));

    expect(view.textContent).toContain('autoUnlockStatusError');
    const checkbox = view.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.disabled).toBe(true);
    const retryButton = [...view.querySelectorAll('button')].find(
      (button) => button.textContent === 'autoUnlockRetry'
    );
    expect(retryButton).toBeDefined();

    await act(async () => retryButton?.click());

    expect(getAutoUnlockStatus).toHaveBeenCalledTimes(2);
    expect(checkbox?.disabled).toBe(false);
    expect(view.textContent).toContain('autoUnlockHint');
  });

  it('ignores an older status response after a focus refresh succeeds', async () => {
    let finishFirstRequest!: (status: AutoUnlockStatus) => void;
    const firstRequest = new Promise<AutoUnlockStatus>((resolve) => {
      finishFirstRequest = resolve;
    });
    const getAutoUnlockStatus = vi
      .fn<() => Promise<AutoUnlockStatus>>()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce(supported);
    const view = renderWithAutoUnlockStatus(getAutoUnlockStatus);
    await act(async () => root?.render(<SecurityVaultSection t={translate} />));

    await act(async () => window.dispatchEvent(new Event('focus')));
    const checkbox = view.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.disabled).toBe(false);

    await act(async () => finishFirstRequest(unavailable));

    expect(checkbox?.disabled).toBe(false);
    expect(view.textContent).toContain('autoUnlockHint');
  });
});
