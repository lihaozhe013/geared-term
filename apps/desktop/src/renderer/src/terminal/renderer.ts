import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';

export type RendererHandle = {
  readonly active: boolean;
  dispose: () => void;
};

/**
 * Swap xterm's DOM renderer for the WebGL one. The WebGL renderer draws
 * box-drawing and block glyphs procedurally (customGlyphs) so they fill the
 * whole cell height even with lineHeight > 1, and batches repaints, which the
 * DOM renderer's per-row span updates cannot match for TUIs that redraw at
 * high frequency. Any failure — no WebGL2, activation error, or a later
 * context loss — disposes the addon and xterm reverts to the DOM renderer
 * without losing the session (SPEC TERM-009).
 */
export function attachWebglRenderer(terminal: Terminal): RendererHandle {
  try {
    const addon = new WebglAddon();
    addon.onContextLoss(() => addon.dispose());
    terminal.loadAddon(addon);
    return {
      active: true,
      dispose: () => addon.dispose()
    };
  } catch {
    return { active: false, dispose: () => undefined };
  }
}
