import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import {
  TerminalPortMessageSchema,
  type LocalTerminalRequest,
  type SshProfileTerminalRequest,
  type SshTerminalRequest,
  type SettingsRecord,
  type TerminalPortMessage
} from '@geared-term/protocol';
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
  active: boolean;
  onState: (state: TerminalPortMessage & { kind: 'state' }) => void;
  onHostKeyPrompt: (
    message: TerminalPortMessage & { kind: 'prompt' },
    client: TerminalClient
  ) => void;
  registerSnapshot?: (extractor: SnapshotExtractor | null) => void;
};

function isSshRequest(request: TerminalRequest): request is SshTerminalRequest {
  return 'host' in request || 'profileId' in request;
}

function isSavedSshRequest(request: TerminalRequest): request is SshProfileTerminalRequest {
  return 'profileId' in request;
}

function terminalTheme(theme: string): { background: string; foreground: string; cursor: string } {
  if (theme === 'Light') {
    return { background: '#f6f8fb', foreground: '#1d2633', cursor: '#245c69' };
  }
  if (theme === 'Midnight') {
    return { background: '#070b12', foreground: '#dce7f7', cursor: '#9fe6d5' };
  }
  return { background: '#0d1117', foreground: '#d7deea', cursor: '#9fe6d5' };
}

export function TerminalPane({
  request,
  settings,
  active,
  onState,
  onHostKeyPrompt,
  registerSnapshot
}: TerminalPaneProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  const activeRef = useRef(active);
  const onStateRef = useRef(onState);
  const onHostKeyPromptRef = useRef(onHostKeyPrompt);
  const registerSnapshotRef = useRef(registerSnapshot);
  const precedingLinesRef = useRef(settings.terminalContextPrecedingLines);
  activeRef.current = active;
  onStateRef.current = onState;
  onHostKeyPromptRef.current = onHostKeyPrompt;
  registerSnapshotRef.current = registerSnapshot;
  precedingLinesRef.current = settings.terminalContextPrecedingLines;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize: settings.terminalFontSize,
      lineHeight: settings.terminalLineHeight,
      cursorStyle: settings.terminalCursor,
      scrollback: 10_000,
      theme: terminalTheme(settings.theme)
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new SearchAddon());
    terminal.open(host);
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
      registerSnapshotRef.current?.(null);
      client?.close();
      terminal.dispose();
      fitRef.current = null;
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
    terminal.options.theme = terminalTheme(settings.theme);
    fitRef.current?.fit();
  }, [settings]);

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

  return (
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
      hidden={!active}
    />
  );
}
