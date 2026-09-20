import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITerminalAddon, Terminal } from '@xterm/xterm';
import { attachWebglRenderer } from './renderer';

const h = vi.hoisted(() => ({
  throwOnConstruct: false,
  throwOnActivate: false
}));

type FakeAddon = ITerminalAddon & {
  disposed: boolean;
  lossHandlers: (() => void)[];
};

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class implements ITerminalAddon {
    disposed = false;
    lossHandlers: (() => void)[] = [];
    constructor() {
      if (h.throwOnConstruct) throw new Error('WebGL2 not supported');
    }
    onContextLoss(handler: () => void): { dispose: () => void } {
      this.lossHandlers.push(handler);
      return { dispose: () => undefined };
    }
    activate(): void {
      if (h.throwOnActivate) throw new Error('renderer activation failed');
    }
    dispose(): void {
      this.disposed = true;
    }
  }
}));

function fakeTerminal(loaded: ITerminalAddon[]): Terminal {
  const terminal: Partial<Terminal> = {
    loadAddon: (addon: ITerminalAddon) => {
      loaded.push(addon);
      addon.activate(terminal as Terminal);
    }
  };
  return terminal as Terminal;
}

beforeEach(() => {
  h.throwOnConstruct = false;
  h.throwOnActivate = false;
});

describe('attachWebglRenderer', () => {
  it('activates the WebGL addon and disposes it on demand', () => {
    const loaded: ITerminalAddon[] = [];
    const handle = attachWebglRenderer(fakeTerminal(loaded));

    expect(handle.active).toBe(true);
    expect(loaded).toHaveLength(1);
    handle.dispose();
    expect((loaded[0] as FakeAddon).disposed).toBe(true);
  });

  it('keeps the DOM renderer when the WebGL context cannot be created', () => {
    h.throwOnConstruct = true;
    const loaded: ITerminalAddon[] = [];
    const handle = attachWebglRenderer(fakeTerminal(loaded));

    expect(handle.active).toBe(false);
    expect(loaded).toHaveLength(0);
    expect(() => handle.dispose()).not.toThrow();
  });

  it('keeps the DOM renderer when addon activation throws', () => {
    h.throwOnActivate = true;
    const handle = attachWebglRenderer(fakeTerminal([]));

    expect(handle.active).toBe(false);
    expect(() => handle.dispose()).not.toThrow();
  });

  it('disposes the addon on context loss so xterm reverts to the DOM renderer', () => {
    const loaded: ITerminalAddon[] = [];
    const handle = attachWebglRenderer(fakeTerminal(loaded));
    const addon = loaded[0] as FakeAddon;

    addon.lossHandlers.forEach((handler) => handler());
    expect(addon.disposed).toBe(true);
    expect(() => handle.dispose()).not.toThrow();
  });
});
