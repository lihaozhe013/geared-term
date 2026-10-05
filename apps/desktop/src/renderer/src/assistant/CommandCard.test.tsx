// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCommandBlock } from '@geared-term/command-parser';
import type { Translate } from '../settings/sections';
import { CommandCard } from './CommandCard';

const translate = ((key: string) => key) as Translate;

describe('CommandCard destructive runs', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it('requires confirmation before submitting a destructive command', async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const executeCommandAction = vi.fn(async () => ({ accepted: true as const }));
    Object.defineProperty(window, 'geared', {
      configurable: true,
      value: { executeCommandAction },
      writable: true
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const candidate = parseCommandBlock(
      '```bash\necho command-confirmation; rm -rf /tmp/geared-e2e-missing\n```'
    );

    await act(async () => {
      root?.render(
        <CommandCard
          candidate={candidate}
          targetSessionId="session-1"
          allowRiskyRun
          disabled={false}
          onError={vi.fn()}
          language="en-US"
        />
      );
    });

    const runButton = container.querySelectorAll('button')[2];
    expect(runButton).toBeDefined();
    expect(runButton?.disabled).toBe(false);

    await act(async () => runButton?.click());
    expect(confirm).toHaveBeenCalledOnce();
    expect(executeCommandAction).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => runButton?.click());
    expect(executeCommandAction).toHaveBeenCalledOnce();
  });
});
