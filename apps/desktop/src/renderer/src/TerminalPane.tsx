import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import {
  TerminalPortMessageSchema,
  type LocalTerminalRequest,
  type SshTerminalRequest,
  type TerminalPortMessage
} from '@geared-term/protocol';

type TerminalRequest = LocalTerminalRequest | SshTerminalRequest;
type TerminalClient =
  | ReturnType<Window['geared']['createLocalTerminal']>
  | ReturnType<Window['geared']['createSshTerminal']>;

type TerminalPaneProps = {
  request: TerminalRequest;
  active: boolean;
  onState: (state: TerminalPortMessage & { kind: 'state' }) => void;
  onHostKeyPrompt: (
    message: TerminalPortMessage & { kind: 'prompt' },
    client: TerminalClient
  ) => void;
};

function isSshRequest(request: TerminalRequest): request is SshTerminalRequest {
  return 'host' in request;
}

export function TerminalPane({
  request,
  active,
  onState,
  onHostKeyPrompt
}: TerminalPaneProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const clientRef = useRef<TerminalClient | null>(null);
  const activeRef = useRef(active);
  const onStateRef = useRef(onState);
  const onHostKeyPromptRef = useRef(onHostKeyPrompt);
  activeRef.current = active;
  onStateRef.current = onState;
  onHostKeyPromptRef.current = onHostKeyPrompt;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
      fontSize: 14,
      scrollback: 10_000,
      theme: { background: '#0d1117', foreground: '#d7deea', cursor: '#9fe6d5' }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new SearchAddon());
    terminal.open(host);
    fit.fit();
    fitRef.current = fit;
    terminalRef.current = terminal;

    let disposed = false;
    let client: TerminalClient | undefined;
    let inputSubscription: { dispose: () => void } | undefined;
    let resizeSubscription: { dispose: () => void } | undefined;

    const sendResize = (): void => {
      if (client && activeRef.current) client.resize(terminal.cols, terminal.rows);
    };

    terminal.writeln(
      isSshRequest(request)
        ? `Connecting to ${request.username}@${request.host}...`
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
      client = isSshRequest(request)
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
      client?.close();
      terminal.dispose();
      fitRef.current = null;
      terminalRef.current = null;
      clientRef.current = null;
    };
  }, [request]);

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
      aria-label={isSshRequest(request) ? `SSH terminal ${request.host}` : 'Local terminal'}
      hidden={!active}
    />
  );
}
