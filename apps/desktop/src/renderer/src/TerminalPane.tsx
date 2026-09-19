import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { TerminalPortMessageSchema } from '@geared-term/protocol';

export function TerminalPane(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

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

    const sessionId = crypto.randomUUID();
    let disposed = false;
    let client: ReturnType<Window['geared']['createLocalTerminal']> | undefined;
    let inputSubscription: { dispose: () => void } | undefined;
    let resizeSubscription: { dispose: () => void } | undefined;

    const sendResize = (): void => {
      if (client) {
        client.resize(terminal.cols, terminal.rows);
      }
    };

    terminal.writeln('Starting local terminal...');
    try {
      client = window.geared.createLocalTerminal(
        { sessionId, args: [], cols: terminal.cols, rows: terminal.rows, term: 'xterm-256color' },
        (message) => {
          const result = TerminalPortMessageSchema.safeParse(message);
          if (!result.success) return;
          const event = result.data;
          if (event.kind === 'output') {
            terminal.write(event.chunk);
            client?.acknowledge(new TextEncoder().encode(event.chunk).byteLength);
          } else if (event.kind === 'state' && event.state === 'failed') {
            terminal.writeln(`\r\n[terminal error] ${event.detail ?? 'unknown error'}`);
          } else if (event.kind === 'state' && event.state === 'exited') {
            terminal.writeln(`\r\n[process exited] ${event.detail ?? ''}`);
          }
        }
      );
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
      fit.fit();
      sendResize();
    });
    resizeObserver.observe(host);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      inputSubscription?.dispose();
      resizeSubscription?.dispose();
      client?.close();
      terminal.dispose();
    };
  }, []);

  return <div ref={hostRef} className="terminal-host" aria-label="Local terminal" />;
}
