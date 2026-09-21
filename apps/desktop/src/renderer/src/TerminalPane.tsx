import { useEffect, useMemo, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon, type ISearchDecorationOptions } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { normalizeTerminalFontFallbacks } from '@geared-term/protocol';
import {
  matchesKeybinding,
  normalizePlatform,
  resolveKeybindings,
  type KeybindingMap
} from '@geared-term/keybindings';
import {
  TerminalPortMessageSchema,
  type LocalTerminalRequest,
  type SshProfileTerminalRequest,
  type SshTerminalRequest,
  type SettingsRecord,
  type TerminalPortMessage
} from '@geared-term/protocol';
import { buildSearchDecorations, buildXtermTheme, type Palette } from './themes';
import { translate } from './i18n';
import { ContextMenu } from './sftp/context-menu';
import {
  buildTerminalContextMenu,
  terminalShortcutsFor,
  toTerminalPasteText
} from './terminal/context-menu';
import { extractSelectionText, extractViewportText, formatChatInsert } from './terminal/extract';
import { attachWebglRenderer } from './terminal/renderer';
import {
  buildLigatureJoiner,
  defaultLigatureSequences,
  loadLigatureSequences
} from './terminal/ligatures';
import {
  createLineTracker,
  extractCdFromScreenLine,
  observeKeystrokes,
  readAlternateScreenPath,
  readEchoedCommandLine
} from './terminal/line-tracker';
import { logInputDiagnostic } from './terminal/input-diagnostics';
import { isBareSpaceKeydown } from './terminal/space-guard';

type TerminalRequest = LocalTerminalRequest | SshTerminalRequest | SshProfileTerminalRequest;
type TerminalClient =
  | ReturnType<Window['geared']['createLocalTerminal']>
  | ReturnType<Window['geared']['createSshTerminal']>
  | ReturnType<Window['geared']['createSavedSshTerminal']>;

/** Imperative hooks the SFTP panel needs from the owning terminal. */
export type SftpTerminalControl = {
  /** Runs the quiet `stty -echo` + hidden `pwd` recovery and resolves with
   *  the shell's real working directory, or null when it could not be learned. */
  probeWorkingDirectory: () => Promise<string | null>;
};

type TerminalPaneProps = {
  request: TerminalRequest;
  settings: SettingsRecord;
  palette: Palette;
  active: boolean;
  onState: (state: TerminalPortMessage & { kind: 'state' }) => void;
  onHostKeyPrompt: (
    message: TerminalPortMessage & { kind: 'prompt' },
    client: TerminalClient
  ) => void;
  onAlternateScreen?: (active: boolean) => void;
  registerSftpControl?: (control: SftpTerminalControl | null) => void;
  onAddToChat?: (text: string) => void;
};

function isSshRequest(request: TerminalRequest): request is SshTerminalRequest {
  return 'host' in request || 'profileId' in request;
}

function isSavedSshRequest(request: TerminalRequest): request is SshProfileTerminalRequest {
  return 'profileId' in request;
}

function fontFamilyFor(settings: SettingsRecord): string {
  const fallbacks = normalizeTerminalFontFallbacks(
    settings.terminalFontFamily,
    settings.terminalFontFallbacks
  ).map((entry) => entry.name);
  return [`"${settings.terminalFontFamily.replace(/"/gu, '')}"`, ...fallbacks, 'monospace'].join(
    ', '
  );
}

export function TerminalPane({
  request,
  settings,
  palette,
  active,
  onState,
  onHostKeyPrompt,
  onAlternateScreen,
  registerSftpControl,
  onAddToChat
}: TerminalPaneProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuOpenRef = useRef(false);
  const terminalRef = useRef<Terminal | null>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  const sendToShellRef = useRef<((data: string) => void) | null>(null);
  const activeRef = useRef(active);
  const onStateRef = useRef(onState);
  const onHostKeyPromptRef = useRef(onHostKeyPrompt);
  const onAlternateScreenRef = useRef(onAlternateScreen);
  const registerSftpControlRef = useRef(registerSftpControl);
  const paletteRef = useRef(palette);
  activeRef.current = active;
  onStateRef.current = onState;
  onHostKeyPromptRef.current = onHostKeyPrompt;
  onAlternateScreenRef.current = onAlternateScreen;
  registerSftpControlRef.current = registerSftpControl;
  paletteRef.current = palette;

  const platform = useMemo(() => normalizePlatform(window.geared.platform), []);
  const keybindings = useMemo(
    () => resolveKeybindings(settings.keybindings, platform),
    [settings.keybindings, platform]
  );
  const keybindingsRef = useRef<KeybindingMap>(keybindings);
  keybindingsRef.current = keybindings;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: fontFamilyFor(settings),
      fontSize: settings.terminalFontSize,
      lineHeight: settings.terminalLineHeight,
      cursorStyle: settings.terminalCursor,
      customGlyphs: true,
      scrollback: 10_000,
      theme: buildXtermTheme(paletteRef.current)
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const search = new SearchAddon();
    searchRef.current = search;
    terminal.loadAddon(search);
    terminal.open(host);
    const renderer = attachWebglRenderer(terminal);
    terminal.attachCustomKeyEventHandler((event) => {
      // The open context menu owns the keyboard: block terminal input (and the
      // Escape byte) while it is visible without stopping DOM propagation so
      // the menu's own Escape handler still runs.
      if (event.type === 'keydown' && contextMenuOpenRef.current) return false;
      if (event.type !== 'keydown') {
        if (event.type === 'keypress') {
          logInputDiagnostic('keypress', {
            key: event.key,
            charCode: event.charCode,
            isComposing: event.isComposing
          });
        }
        return true;
      }
      if (event.keyCode === 229 || event.isComposing) {
        logInputDiagnostic('composition keydown', { key: event.key, keyCode: event.keyCode });
      }
      // xterm only transmits space from the textarea's keypress path (see
      // space-guard.ts), which IME/229 states can kill while keydown-driven
      // keys keep working; route bare space through the keydown path instead.
      if (isBareSpaceKeydown(event)) {
        logInputDiagnostic('bare space intercepted', {
          keyCode: event.keyCode,
          repeat: event.repeat
        });
        // preventDefault keeps the browser from inserting the character into
        // the textarea, which would deliver it a second time via keypress.
        event.preventDefault();
        sendToShellRef.current?.(' ');
        return false;
      }
      const bindings = keybindingsRef.current;
      // Returning false only makes xterm skip the key; without preventDefault
      // Chromium still runs its default edit command (Ctrl+Shift+V is
      // paste-as-plain-text on the focused textarea), which fires a native
      // paste event and the clipboard text reaches the shell twice.
      if (matchesKeybinding(event, bindings['terminal.copy'], platform)) {
        event.preventDefault();
        const selection = terminal.getSelection();
        if (selection) void navigator.clipboard.writeText(selection);
        return false;
      }
      if (matchesKeybinding(event, bindings['terminal.paste'], platform)) {
        event.preventDefault();
        void navigator.clipboard
          .readText()
          .then((text) => terminal.paste(toTerminalPasteText(text)))
          .catch(() => undefined);
        return false;
      }
      if (matchesKeybinding(event, bindings['terminal.selectAll'], platform)) {
        event.preventDefault();
        terminal.selectAll();
        return false;
      }
      if (matchesKeybinding(event, bindings['terminal.search'], platform)) {
        event.preventDefault();
        setShowSearch((current) => {
          if (!current) requestAnimationFrame(() => searchInputRef.current?.focus());
          return !current;
        });
        return false;
      }
      if (matchesKeybinding(event, bindings['terminal.clear'], platform)) {
        event.preventDefault();
        terminal.clear();
        return false;
      }
      return true;
    });
    fit.fit();
    fitRef.current = fit;
    terminalRef.current = terminal;

    let disposed = false;
    let client: TerminalClient | undefined;
    let inputSubscription: { dispose: () => void } | undefined;
    let resizeSubscription: { dispose: () => void } | undefined;
    let lineTracker = createLineTracker();
    let alternateActive = false;
    let probing = false;
    const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    // Quiet cwd recovery (mirrors the shell-side protocol used by the panel
    // re-sync): suppress echo, run `pwd` hidden on the alternate screen, read
    // the learned path, then restore the screen and echo in all cases.
    const probeWorkingDirectory = async (): Promise<string | null> => {
      const current = clientRef.current;
      if (!current || !isSshRequest(request) || probing || alternateActive) return null;
      probing = true;
      lineTracker = createLineTracker();
      try {
        try {
          current.sendInput('stty -echo\r');
          await delay(150);
          if (disposed || alternateActive) return null;
          current.sendInput("printf '\\033[1A\\033[K\\033[1B\\r\\033[?1049h'; pwd\r");
        } catch {
          return null; // the port or session vanished mid-probe
        }
        const deadline = Date.now() + 4_000;
        for (;;) {
          await delay(80);
          const path = readAlternateScreenPath(terminal, alternateActive);
          if (path) return path;
          if (disposed || Date.now() >= deadline) return null;
        }
      } finally {
        // Restore echo (and leave the probe's alternate screen when it is
        // still active) in every outcome; ignore failures from a dead port.
        const restore = alternateActive ? "printf '\\033[?1049l'; stty echo\r" : 'stty echo\r';
        try {
          clientRef.current?.sendInput(restore);
        } catch {
          // nothing left to restore on
        }
        probing = false;
      }
    };
    registerSftpControlRef.current?.({ probeWorkingDirectory });

    const sendResize = (): void => {
      if (client && activeRef.current) client.resize(terminal.cols, terminal.rows);
    };

    terminal.writeln(
      isSshRequest(request)
        ? isSavedSshRequest(request)
          ? 'Connecting to saved SSH profile...'
          : `Connecting to ${request.username}@${request.host}...`
        : 'Starting local terminal...'
    );
    const onMessage = (rawMessage: unknown): void => {
      const result = TerminalPortMessageSchema.safeParse(rawMessage);
      if (!result.success) return;
      const message = result.data;
      if (message.kind === 'output') {
        terminal.write(message.chunk);
        client?.acknowledge(new TextEncoder().encode(message.chunk).byteLength);
      } else if (message.kind === 'state') {
        onStateRef.current(message);
        if (message.state === 'failed') {
          terminal.writeln(`\r\n[terminal error] ${message.detail ?? 'unknown error'}`);
        } else if (message.state === 'exited') {
          terminal.writeln(`\r\n[process exited] ${message.detail ?? ''}`);
        }
      } else if (message.kind === 'prompt' && client) {
        onHostKeyPromptRef.current(message, client);
      }
    };

    try {
      client = isSavedSshRequest(request)
        ? window.geared.createSavedSshTerminal(request, onMessage)
        : isSshRequest(request)
          ? window.geared.createSshTerminal(request, onMessage)
          : window.geared.createLocalTerminal(request, onMessage);
      clientRef.current = client;
      if (!disposed) {
        // Single funnel for every keystroke that reaches the shell (xterm's
        // onData and the space keydown fallback alike) so cd following stays
        // accurate no matter which path delivered the data.
        const sendToShell = (data: string): void => {
          if (!client) return;
          client.sendInput(data);
          // Forward submitted command lines for cd following; while the SFTP
          // panel is detached or a full-screen program owns the terminal the
          // lines are not shell commands and must not be tracked.
          if (!isSshRequest(request)) return;
          if (alternateActive) {
            lineTracker = createLineTracker();
            return;
          }
          const observed = observeKeystrokes(lineTracker, data);
          lineTracker = observed.tracker;
          for (const line of observed.lines) {
            let text = line.text;
            if (line.edited) {
              const echoed = readEchoedCommandLine(terminal);
              const extracted = echoed ? extractCdFromScreenLine(echoed) : null;
              if (extracted) text = extracted;
            }
            if (text.trim()) client.sendCdLine(text.slice(0, 1024));
          }
        };
        sendToShellRef.current = sendToShell;
        inputSubscription = terminal.onData(sendToShell);
        resizeSubscription = terminal.onResize(sendResize);
        sendResize();
        terminal.focus();
      }
    } catch (error) {
      terminal.writeln(
        `\r\n[terminal error] ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const alternateScreenModes = new Set([47, 1047, 1049]);
    const isAlternateScreenMode = (params: unknown): boolean => {
      const first = params as (number | number[])[];
      const mode = Array.isArray(first[0]) ? (first[0] as number[])[0] : first[0];
      return alternateScreenModes.has(Number(mode));
    };
    const setAlternate = (value: boolean): void => {
      if (value !== alternateActive) lineTracker = createLineTracker();
      alternateActive = value;
      onAlternateScreenRef.current?.(value);
    };
    const handlerEnter = terminal.parser.registerCsiHandler(
      { prefix: '?', final: 'h' },
      (params) => {
        if (isAlternateScreenMode(params)) setAlternate(true);
        return false;
      }
    );
    const handlerLeave = terminal.parser.registerCsiHandler(
      { prefix: '?', final: 'l' },
      (params) => {
        if (isAlternateScreenMode(params)) setAlternate(false);
        return false;
      }
    );

    const resizeObserver = new ResizeObserver(() => {
      if (activeRef.current) {
        fit.fit();
        sendResize();
      }
    });
    resizeObserver.observe(host);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputSubscription?.dispose();
      resizeSubscription?.dispose();
      handlerEnter.dispose();
      handlerLeave.dispose();
      setAlternate(false);
      registerSftpControlRef.current?.(null);
      client?.close();
      renderer.dispose();
      terminal.dispose();
      fitRef.current = null;
      searchRef.current = null;
      terminalRef.current = null;
      clientRef.current = null;
      sendToShellRef.current = null;
    };
  }, [request]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !settings.terminalFontLigatures) return;
    let cancelled = false;
    let joinerId: number | null = null;
    void loadLigatureSequences(settings.terminalFontFamily)
      .catch(() => null)
      .then((sequences) => {
        if (cancelled) return;
        const table = sequences && sequences.length > 0 ? sequences : defaultLigatureSequences();
        if (table.length === 0) return;
        joinerId = terminal.registerCharacterJoiner(buildLigatureJoiner(table));
      });
    return () => {
      cancelled = true;
      if (joinerId !== null) {
        const id = joinerId;
        joinerId = null;
        try {
          terminal.deregisterCharacterJoiner(id);
        } catch {
          // the terminal is already disposed when the whole pane unmounts
        }
      }
    };
  }, [request, settings.terminalFontLigatures, settings.terminalFontFamily]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.fontSize = settings.terminalFontSize;
    terminal.options.lineHeight = settings.terminalLineHeight;
    terminal.options.cursorStyle = settings.terminalCursor;
    terminal.options.fontFamily = fontFamilyFor(settings);
    terminal.options.theme = buildXtermTheme(palette);
    fitRef.current?.fit();
  }, [settings, palette]);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      const terminal = terminalRef.current;
      const client = clientRef.current;
      if (terminal && client) {
        client.resize(terminal.cols, terminal.rows);
        terminal.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Electron does not fire the textarea's blur/focus events when the OS window
  // loses and regains focus, so xterm can keep painting the inactive (hollow)
  // cursor even though keystrokes flow again. The window focus event is the
  // reliable signal to resynchronize both focus and the cursor paint.
  useEffect(() => {
    if (!active) return;
    const restoreFocus = (): void => {
      const terminal = terminalRef.current;
      const textarea = terminal?.textarea;
      if (!terminal || !textarea || !activeRef.current) return;
      logInputDiagnostic('window focus', {
        documentHasFocus: document.hasFocus(),
        textareaFocused: document.activeElement === textarea
      });
      if (document.activeElement !== textarea) {
        terminal.focus();
        return;
      }
      // DOM focus never moved: re-firing blur/focus forces xterm to repaint
      // the cursor with the real focus state. Skip while an IME composition
      // holds text in the textarea so the composition is not cancelled.
      if (textarea.value !== '') return;
      terminal.blur();
      terminal.focus();
    };
    window.addEventListener('focus', restoreFocus);
    return () => window.removeEventListener('focus', restoreFocus);
  }, [active]);

  const closeSearch = (): void => {
    setShowSearch(false);
    searchRef.current?.clearDecorations();
    terminalRef.current?.focus();
  };

  const searchOptions = (): { decorations: ISearchDecorationOptions } => ({
    decorations: buildSearchDecorations(paletteRef.current)
  });

  const closeContextMenu = (): void => {
    contextMenuOpenRef.current = false;
    setContextMenu(null);
  };

  const openContextMenu = (event: React.MouseEvent): void => {
    event.preventDefault();
    contextMenuOpenRef.current = true;
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const contextMenuItems = contextMenu
    ? buildTerminalContextMenu({
        hasSelection: terminalRef.current?.hasSelection() ?? false,
        labels: {
          copy: translate(settings.language, 'terminalCopy'),
          paste: translate(settings.language, 'terminalPaste'),
          selectAll: translate(settings.language, 'terminalSelectAll'),
          search: translate(settings.language, 'terminalSearch'),
          clear: translate(settings.language, 'terminalClear'),
          addSelectionToChat: translate(settings.language, 'terminalAddSelectionToChat'),
          addScreenToChat: translate(settings.language, 'terminalAddScreenToChat')
        },
        shortcuts: terminalShortcutsFor(keybindings, platform),
        actions: {
          copy: () => {
            const terminal = terminalRef.current;
            const selection = terminal?.getSelection() ?? '';
            if (selection) void navigator.clipboard.writeText(selection).catch(() => undefined);
            terminal?.focus();
          },
          paste: () => {
            const terminal = terminalRef.current;
            if (!terminal) return;
            void navigator.clipboard
              .readText()
              .then((text) => terminal.paste(toTerminalPasteText(text)))
              .catch(() => undefined)
              .finally(() => terminal.focus());
          },
          selectAll: () => {
            const terminal = terminalRef.current;
            terminal?.selectAll();
            terminal?.focus();
          },
          search: () => {
            setShowSearch((current) => {
              if (!current) requestAnimationFrame(() => searchInputRef.current?.focus());
              return !current;
            });
          },
          clear: () => {
            const terminal = terminalRef.current;
            terminal?.clear();
            terminal?.focus();
          },
          addSelectionToChat: () => {
            const terminal = terminalRef.current;
            const text = terminal ? extractSelectionText(terminal) : null;
            if (text) onAddToChat?.(formatChatInsert(text));
          },
          addScreenToChat: () => {
            const terminal = terminalRef.current;
            const text = terminal ? extractViewportText(terminal) : null;
            if (text) onAddToChat?.(formatChatInsert(text));
          }
        }
      })
    : [];

  return (
    <div className="terminal-wrapper" hidden={!active} data-session-id={request.sessionId}>
      {showSearch ? (
        <div className="terminal-search" role="search">
          <input
            ref={searchInputRef}
            value={searchText}
            placeholder="Search terminal"
            aria-label="Search terminal"
            spellCheck={false}
            onChange={(event) => {
              const value = event.target.value;
              setSearchText(value);
              if (value)
                searchRef.current?.findNext(value, {
                  incremental: true,
                  ...searchOptions()
                });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (event.shiftKey) searchRef.current?.findPrevious(searchText, searchOptions());
                else searchRef.current?.findNext(searchText, searchOptions());
              } else if (event.key === 'Escape') {
                closeSearch();
              }
            }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Previous match"
            onClick={() => searchRef.current?.findPrevious(searchText, searchOptions())}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next match"
            onClick={() => searchRef.current?.findNext(searchText, searchOptions())}
          >
            ↓
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close search"
            onClick={closeSearch}
          >
            ×
          </button>
        </div>
      ) : null}
      <div
        ref={hostRef}
        className={
          settings.terminalFontLigatures ? 'terminal-host terminal-ligatures' : 'terminal-host'
        }
        aria-label={
          isSshRequest(request)
            ? isSavedSshRequest(request)
              ? 'Saved SSH terminal'
              : `SSH terminal ${request.host}`
            : 'Local terminal'
        }
        onContextMenu={openContextMenu}
      />
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}
