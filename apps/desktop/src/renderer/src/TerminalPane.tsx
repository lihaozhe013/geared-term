import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { normalizeTerminalFontFallbacks } from '@geared-term/protocol';
import {
  TerminalPortMessageSchema,
  type LocalTerminalRequest,
  type SshProfileTerminalRequest,
  type SshTerminalRequest,
  type SettingsRecord,
  type TerminalPortMessage
} from '@geared-term/protocol';
import { buildXtermTheme, type Palette } from './themes';
import { extractSnapshot, type SnapshotTerminal, type TerminalSnapshot } from './terminal/snapshot';

type TerminalRequest = LocalTerminalRequest | SshTerminalRequest | SshProfileTerminalRequest;
type TerminalClient =
  | ReturnType<Window['geared']['createLocalTerminal']>
  | ReturnType<Window['geared']['createSshTerminal']>
  | ReturnType<Window['geared']['createSavedSshTerminal']>;
export type SnapshotExtractor = () => TerminalSnapshot | null;

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
  registerSnapshot?: (extractor: SnapshotExtractor | null) => void;
  onAlternateScreen?: (active: boolean) => void;
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
  registerSnapshot,
  onAlternateScreen
}: TerminalPaneProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const terminalRef = useRef<Terminal | null>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  const activeRef = useRef(active);
  const onStateRef = useRef(onState);
  const onHostKeyPromptRef = useRef(onHostKeyPrompt);
  const registerSnapshotRef = useRef(registerSnapshot);
  const precedingLinesRef = useRef(settings.terminalContextPrecedingLines);
  const onAlternateScreenRef = useRef(onAlternateScreen);
  const paletteRef = useRef(palette);
  activeRef.current = active;
  onStateRef.current = onState;
  onHostKeyPromptRef.current = onHostKeyPrompt;
  registerSnapshotRef.current = registerSnapshot;
  precedingLinesRef.current = settings.terminalContextPrecedingLines;
  onAlternateScreenRef.current = onAlternateScreen;
  paletteRef.current = palette;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: fontFamilyFor(settings),
      fontSize: settings.terminalFontSize,
      lineHeight: settings.terminalLineHeight,
      cursorStyle: settings.terminalCursor,
      scrollback: 10_000,
      theme: buildXtermTheme(paletteRef.current)
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const search = new SearchAddon();
    searchRef.current = search;
    terminal.loadAddon(search);
    terminal.open(host);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || (!event.ctrlKey && !event.metaKey)) return true;
      const isMacCopyPaste = event.metaKey && !event.shiftKey && process.platform === 'darwin';
      const key = event.key.toLowerCase();
      if (key === 'c' && ((event.ctrlKey && event.shiftKey) || isMacCopyPaste)) {
        if (terminal.getSelection()) void navigator.clipboard.writeText(terminal.getSelection());
        return false;
      }
      if (key === 'v' && ((event.ctrlKey && event.shiftKey) || isMacCopyPaste)) {
        void navigator.clipboard
          .readText()
          .then((text) => terminal.paste(text))
          .catch(() => undefined);
        return false;
      }
      if (key === 'a' && ((event.ctrlKey && event.shiftKey) || isMacCopyPaste)) {
        terminal.selectAll();
        return false;
      }
      if (key === 'f' && (event.ctrlKey || (event.metaKey && process.platform === 'darwin'))) {
        setShowSearch((current) => {
          if (!current) requestAnimationFrame(() => searchInputRef.current?.focus());
          return !current;
        });
        return false;
      }
      return true;
    });
    fit.fit();
    fitRef.current = fit;
    terminalRef.current = terminal;
    registerSnapshotRef.current?.(() => {
      const current = terminalRef.current;
      if (!current) return null;
      return extractSnapshot(current as unknown as SnapshotTerminal, {
        precedingLines: precedingLinesRef.current
      });
    });

    let disposed = false;
    let client: TerminalClient | undefined;
    let inputSubscription: { dispose: () => void } | undefined;
    let resizeSubscription: { dispose: () => void } | undefined;

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
        inputSubscription = terminal.onData((data) => client?.sendInput(data));
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
    const setAlternate = (value: boolean): void => onAlternateScreenRef.current?.(value);
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
      registerSnapshotRef.current?.(null);
      client?.close();
      terminal.dispose();
      fitRef.current = null;
      searchRef.current = null;
      terminalRef.current = null;
      clientRef.current = null;
    };
  }, [request]);

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

  const closeSearch = (): void => {
    setShowSearch(false);
    searchRef.current?.clearDecorations();
    terminalRef.current?.focus();
  };

  return (
    <div className="terminal-wrapper" hidden={!active}>
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
              if (value) searchRef.current?.findNext(value, { incremental: true });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                if (event.shiftKey) searchRef.current?.findPrevious(searchText, {});
                else searchRef.current?.findNext(searchText, {});
              } else if (event.key === 'Escape') {
                closeSearch();
              }
            }}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Previous match"
            onClick={() => searchRef.current?.findPrevious(searchText, {})}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Next match"
            onClick={() => searchRef.current?.findNext(searchText, {})}
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
        className="terminal-host"
        aria-label={
          isSshRequest(request)
            ? isSavedSshRequest(request)
              ? 'Saved SSH terminal'
              : `SSH terminal ${request.host}`
            : 'Local terminal'
        }
      />
    </div>
  );
}
