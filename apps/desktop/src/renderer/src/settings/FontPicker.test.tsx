// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FontPicker } from './FontPicker';
import type { Translate } from './sections';

const labels: Record<string, string> = {
  searchFonts: 'Search fonts',
  systemDefaultFont: 'System default font',
  fontScanLoading: 'Loading installed fonts',
  fontScanEmpty: 'No installed fonts were found',
  fontScanFailed: 'Installed fonts could not be loaded',
  useCustomFont: 'Use custom name “{name}”',
  autoUnlockRetry: 'Retry'
};
const t = ((key: string) => labels[key] ?? key) as Translate;

describe('FontPicker', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  async function renderPicker(onCommit: (font: string) => void): Promise<HTMLDivElement> {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <FontPicker
          value="System UI"
          fonts={['JetBrains Mono', 'Jasper Mono', 'Arial']}
          label="Terminal font family"
          t={t}
          onCommit={onCommit}
        />
      );
    });
    return container;
  }

  it('fuzzy searches discovered fonts and commits by keyboard', async () => {
    const onCommit = vi.fn();
    const view = await renderPicker(onCommit);
    const trigger = view.querySelector<HTMLElement>('button[aria-label="Terminal font family"]');
    await act(async () => trigger?.click());

    const search = view.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(search).not.toBeNull();
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        'jbm'
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(
      [...view.querySelectorAll('[role="option"]')].map((option) => option.textContent)
    ).toEqual(['JetBrains Mono']);
    await act(async () => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onCommit).toHaveBeenCalledWith('JetBrains Mono');
  });

  it('does not commit search text until the custom font is explicitly chosen', async () => {
    const onCommit = vi.fn();
    const view = await renderPicker(onCommit);
    await act(async () =>
      view.querySelector<HTMLElement>('button[aria-label="Terminal font family"]')?.click()
    );
    const search = view.querySelector<HTMLInputElement>('input[role="combobox"]');
    await act(async () => {
      if (!search) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        'Custom Font'
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => {
      const custom = [...view.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Custom Font')
      );
      custom?.click();
    });
    expect(onCommit).toHaveBeenCalledWith('Custom Font');
  });

  it('keeps system-default and exposes discovery failures with a retry action', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <FontPicker
          value=""
          fonts={[]}
          label="UI font family"
          t={t}
          includeSystemDefault
          loadError
          onRetry={vi.fn()}
          onCommit={vi.fn()}
        />
      );
    });
    await act(async () =>
      container?.querySelector<HTMLElement>('button[aria-label="UI font family"]')?.click()
    );
    expect(container.textContent).toContain('System default font');
    expect(container.textContent).toContain('Installed fonts could not be loaded');
    expect(container.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  });
});
