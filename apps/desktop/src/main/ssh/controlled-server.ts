import { promises as fs, type Stats as FsStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { posix } from 'node:path';
import ssh2, { type ServerChannel, type Session } from 'ssh2';
import { fingerprintSha256 } from './known-hosts';

const { Server, utils } = ssh2;
const STATUS = utils.sftp.STATUS_CODE;
const flagsToString = utils.sftp.flagsToString;

export const REMOTE_CWD = '/home/tester';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export type ControlledServerTrace = {
  pty: { cols: number; rows: number; term: string } | null;
  windowChanges: Array<{ cols: number; rows: number }>;
  shellInput: string;
  authAttempts: string[];
  sftpOps: string[];
};

export type ControlledServer = {
  port: number;
  hostKeyFingerprint: string;
  trace: ControlledServerTrace;
  remoteFsPath: (path: string) => string;
  dropConnections: (mode: 'graceful' | 'abrupt') => void;
  close: () => Promise<void>;
};

type SftpAttrs = Record<string, number>;
type SftpNameEntry = { filename: string; longname: string; attrs?: SftpAttrs };

type ServerSftpStream = {
  handle(reqid: number, handle: Buffer): void;
  status(reqid: number, code: number, message?: string): void;
  data(reqid: number, data: Buffer): void;
  name(reqid: number, entries: SftpNameEntry[]): void;
  attrs(reqid: number, attrs: SftpAttrs): void;
  on(event: 'OPEN', listener: (reqid: number, path: string, flags: number) => void): void;
  on(
    event: 'READ',
    listener: (reqid: number, handle: Buffer, offset: number, length: number) => void
  ): void;
  on(
    event: 'WRITE',
    listener: (reqid: number, handle: Buffer, offset: number, data: Buffer) => void
  ): void;
  on(event: 'CLOSE' | 'FSTAT' | 'READDIR', listener: (reqid: number, handle: Buffer) => void): void;
  on(
    event: 'OPENDIR' | 'REALPATH' | 'MKDIR' | 'RMDIR' | 'REMOVE',
    listener: (reqid: number, path: string) => void
  ): void;
  on(event: 'STAT' | 'LSTAT', listener: (reqid: number, path: string) => void): void;
  on(event: 'SETSTAT', listener: (reqid: number, path: string, attrs: SftpAttrs) => void): void;
  on(event: 'FSETSTAT', listener: (reqid: number, handle: Buffer, attrs: SftpAttrs) => void): void;
  on(event: 'RENAME', listener: (reqid: number, source: string, destination: string) => void): void;
  on(event: 'close', listener: () => void): void;
};

type SftpHandle =
  | { kind: 'file'; fd: FileHandle; remotePath: string }
  | { kind: 'directory'; entries: Array<{ name: string; stats: FsStats }> };

function resolveRemote(path: string): string {
  const normalized = posix.normalize(path.replace(/\\/g, '/'));
  return posix.isAbsolute(normalized)
    ? posix.join('/', normalized)
    : posix.join(REMOTE_CWD, normalized);
}

function attrsOf(stats: FsStats): SftpAttrs {
  return {
    mode: stats.mode,
    uid: 1000,
    gid: 1000,
    size: stats.size,
    atime: Math.floor(stats.atimeMs / 1000),
    mtime: Math.floor(stats.mtimeMs / 1000)
  };
}

function longNameOf(name: string, stats: FsStats): string {
  const permissions = stats.isDirectory() ? 'drwxr-xr-x' : '-rw-r--r--';
  return `${permissions} 1 tester tester ${stats.size} ${name}`;
}

function isThrottledPath(remotePath: string): boolean {
  return remotePath.includes('slow-');
}

/**
 * Serves the SFTP subsystem from a local directory so file operations run
 * against real on-disk state. Paths are POSIX-style and map onto `sftpRoot`;
 * transfers touching a "slow-" path are artificially delayed per chunk so
 * cancellation can be timed deterministically.
 */
function attachSftpSubsystem(
  session: Session,
  sftpRoot: string,
  ops: string[],
  remoteFsPath: (path: string) => string
): void {
  session.on('sftp', (accept) => {
    const sftp = accept() as unknown as ServerSftpStream;
    const handles = new Map<string, SftpHandle>();
    let nextHandleId = 0;

    const fail = (reqid: number, error: unknown): void => {
      const code =
        (error as { code?: string }).code === 'ENOENT' ? STATUS.NO_SUCH_FILE : STATUS.FAILURE;
      sftp.status(reqid, code);
    };
    const guarded = (reqid: number, run: () => Promise<void>): void => {
      run().catch((error: unknown) => fail(reqid, error));
    };
    const openHandle = (handle: SftpHandle): Buffer => {
      const id = Buffer.from(String(nextHandleId));
      nextHandleId += 1;
      handles.set(id.toString(), handle);
      return id;
    };
    const fileHandle = (handle: Buffer): { fd: FileHandle; remotePath: string } | undefined => {
      const entry = handles.get(handle.toString());
      return entry && entry.kind === 'file' ? entry : undefined;
    };
    const directoryHandle = (handle: Buffer): (SftpHandle & { kind: 'directory' }) | undefined => {
      const entry = handles.get(handle.toString());
      return entry && entry.kind === 'directory' ? entry : undefined;
    };
    const throttled = async (entry: { remotePath: string }): Promise<void> => {
      if (isThrottledPath(entry.remotePath)) await delay(25);
    };

    sftp.on('REALPATH', (reqid, path) => {
      ops.push('REALPATH');
      const resolved = resolveRemote(path);
      sftp.name(reqid, [{ filename: resolved, longname: resolved }]);
    });
    sftp.on('STAT', (reqid, path) => {
      ops.push('STAT');
      guarded(reqid, async () => {
        sftp.attrs(reqid, attrsOf(await fs.stat(remoteFsPath(path))));
      });
    });
    sftp.on('LSTAT', (reqid, path) => {
      ops.push('LSTAT');
      guarded(reqid, async () => {
        sftp.attrs(reqid, attrsOf(await fs.lstat(remoteFsPath(path))));
      });
    });
    sftp.on('FSTAT', (reqid, handle) => {
      ops.push('FSTAT');
      guarded(reqid, async () => {
        const entry = fileHandle(handle);
        if (!entry) return sftp.status(reqid, STATUS.FAILURE);
        sftp.attrs(reqid, attrsOf(await entry.fd.stat()));
      });
    });
    sftp.on('OPEN', (reqid, path, flags) => {
      ops.push('OPEN');
      guarded(reqid, async () => {
        const fd = await fs.open(remoteFsPath(path), flagsToString(flags) ?? 'r', 0o666);
        sftp.handle(reqid, openHandle({ kind: 'file', fd, remotePath: resolveRemote(path) }));
      });
    });
    sftp.on('READ', (reqid, handle, offset, length) => {
      ops.push('READ');
      guarded(reqid, async () => {
        const entry = fileHandle(handle);
        if (!entry) return sftp.status(reqid, STATUS.FAILURE);
        await throttled(entry);
        const buffer = Buffer.alloc(Math.min(Math.max(length, 1), 1024 * 1024));
        const { bytesRead } = await entry.fd.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) return sftp.status(reqid, STATUS.EOF);
        sftp.data(reqid, buffer.subarray(0, bytesRead));
      });
    });
    sftp.on('WRITE', (reqid, handle, offset, data) => {
      ops.push('WRITE');
      guarded(reqid, async () => {
        const entry = fileHandle(handle);
        if (!entry) return sftp.status(reqid, STATUS.FAILURE);
        await throttled(entry);
        await entry.fd.write(data, 0, data.length, offset);
        sftp.status(reqid, STATUS.OK);
      });
    });
    sftp.on('CLOSE', (reqid, handle) => {
      ops.push('CLOSE');
      guarded(reqid, async () => {
        const entry = handles.get(handle.toString());
        if (!entry) return sftp.status(reqid, STATUS.FAILURE);
        handles.delete(handle.toString());
        if (entry.kind === 'file') await entry.fd.close();
        sftp.status(reqid, STATUS.OK);
      });
    });
    sftp.on('OPENDIR', (reqid, path) => {
      ops.push('OPENDIR');
      guarded(reqid, async () => {
        const directory = remoteFsPath(path);
        const names = (await fs.readdir(directory, { withFileTypes: true }))
          .map((entry) => entry.name)
          .sort();
        const entries: Array<{ name: string; stats: FsStats }> = [];
        for (const name of names)
          entries.push({ name, stats: await fs.stat(join(directory, name)) });
        sftp.handle(reqid, openHandle({ kind: 'directory', entries }));
      });
    });
    sftp.on('READDIR', (reqid, handle) => {
      ops.push('READDIR');
      guarded(reqid, async () => {
        const entry = directoryHandle(handle);
        if (!entry) return sftp.status(reqid, STATUS.FAILURE);
        if (entry.entries.length === 0) return sftp.status(reqid, STATUS.EOF);
        sftp.name(
          reqid,
          entry.entries.map(({ name, stats }) => ({
            filename: name,
            longname: longNameOf(name, stats),
            attrs: attrsOf(stats)
          }))
        );
        entry.entries = [];
      });
    });
    sftp.on('MKDIR', (reqid, path) => {
      ops.push('MKDIR');
      guarded(reqid, async () => {
        await fs.mkdir(remoteFsPath(path));
        sftp.status(reqid, STATUS.OK);
      });
    });
    sftp.on('RMDIR', (reqid, path) => {
      ops.push('RMDIR');
      guarded(reqid, async () => {
        await fs.rmdir(remoteFsPath(path));
        sftp.status(reqid, STATUS.OK);
      });
    });
    sftp.on('REMOVE', (reqid, path) => {
      ops.push('REMOVE');
      guarded(reqid, async () => {
        await fs.unlink(remoteFsPath(path));
        sftp.status(reqid, STATUS.OK);
      });
    });
    sftp.on('RENAME', (reqid, source, destination) => {
      ops.push('RENAME');
      guarded(reqid, async () => {
        await fs.rename(remoteFsPath(source), remoteFsPath(destination));
        sftp.status(reqid, STATUS.OK);
      });
    });
    sftp.on('SETSTAT', (reqid, path, attrs) => {
      ops.push('SETSTAT');
      guarded(reqid, async () => {
        if (typeof attrs.size === 'number') await fs.truncate(remoteFsPath(path), attrs.size);
        sftp.status(reqid, STATUS.OK);
      });
    });
    sftp.on('FSETSTAT', (reqid, handle, attrs) => {
      ops.push('FSETSTAT');
      guarded(reqid, async () => {
        const entry = fileHandle(handle);
        if (!entry) return sftp.status(reqid, STATUS.FAILURE);
        if (typeof attrs.size === 'number') await entry.fd.truncate(attrs.size);
        sftp.status(reqid, STATUS.OK);
      });
    });
    sftp.on('close', () => {
      for (const entry of handles.values()) {
        if (entry.kind === 'file') entry.fd.close().catch(() => undefined);
      }
      handles.clear();
    });
  });
}

type ServerChannelLike = { write: (chunk: string | Buffer) => void };

function handleShellCommand(command: string, channel: ServerChannelLike): void {
  const flood = /^flood (\d+)x(\d+)$/u.exec(command);
  if (!flood) return;
  const count = Math.min(Number(flood[1]), 2000);
  const size = Math.min(Number(flood[2]), 65536);
  channel.write('FLOOD-START\r\n');
  for (let index = 0; index < count; index += 1) {
    channel.write(Buffer.alloc(size, 0x41 + (index % 26)));
  }
  channel.write('FLOOD-END\r\n');
}

/**
 * In-memory SSH/SFTP server used by the integration and stress suites. It
 * accepts deterministic password auth, records a session trace, serves the
 * SFTP subsystem from a temporary directory, and supports `flood NxM` shell
 * commands that stream N chunks of M printable bytes between explicit markers.
 */
export async function startControlledServer(): Promise<ControlledServer> {
  const hostKeys = [utils.generateKeyPairSync('rsa', { bits: 2048 }).private];
  const trace: ControlledServerTrace = {
    pty: null,
    windowChanges: [],
    shellInput: '',
    authAttempts: [],
    sftpOps: []
  };
  const connections = new Set<{ end: () => void; abrupt: () => void }>();
  let sftpRoot = '';
  const server = new Server({ hostKeys }, (connection) => {
    const rawSocket = (connection as unknown as { _sock?: { destroy: () => void } })._sock;
    const record = {
      end: () => connection.end(),
      abrupt: () => rawSocket?.destroy()
    };
    connections.add(record);
    connection.on('close', () => connections.delete(record));
    connection.on('error', () => connections.delete(record));
    connection.on('authentication', (context) => {
      trace.authAttempts.push(`${context.method}:${context.username ?? ''}`);
      if (context.method === 'none') return context.reject(['password']);
      if (
        context.method === 'password' &&
        context.username === 'tester' &&
        context.password === 'geared-secret'
      ) {
        return context.accept();
      }
      return context.reject(['password']);
    });
    connection.on('session', (accept) => {
      const session = accept();
      let shellChannel: ServerChannelLike | undefined;
      session.on('pty', (ptyAccept, _reject, info) => {
        trace.pty = { cols: info.cols, rows: info.rows, term: info.term };
        ptyAccept();
      });
      session.on('window-change', (_changeAccept, _reject, info) => {
        // ssh2 server sessions reject window-change requests that are accepted;
        // handling the notification without accepting keeps the channel usable.
        trace.windowChanges.push({ cols: info.cols, rows: info.rows });
        shellChannel?.write(`${info.cols}x${info.rows}\r\n`);
      });
      session.on('shell', (shellAccept) => {
        const channel = shellAccept() as ServerChannel;
        shellChannel = channel;
        channel.write('ready\r\n');
        let lineBuffer = '';
        channel.on('data', (data: string | Buffer) => {
          const text = typeof data === 'string' ? data : data.toString();
          trace.shellInput += text;
          lineBuffer += text;
          const lines = lineBuffer.split(/\r\n|\r|\n/);
          lineBuffer = lines.pop() ?? '';
          for (const line of lines) {
            const command = line.trim();
            if (command) handleShellCommand(command, channel);
          }
        });
        channel.on('close', () => channel.end());
      });
      session.on('exec', (execAccept, reject, info) => {
        if (info.command === 'pwd') {
          const channel = execAccept();
          channel.write('/home/tester\n');
          channel.exit(0);
          channel.end();
        } else {
          reject();
        }
      });
      attachSftpSubsystem(session, sftpRoot, trace.sftpOps, (path) =>
        join(sftpRoot, resolveRemote(path).slice(1))
      );
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

  const hostKeyFingerprint = await new Promise<string>((resolve, reject) => {
    const { Client } = ssh2;
    const probe = new Client();
    let capturedKey = '';
    probe.on('error', reject);
    probe.on('ready', () => {
      probe.end();
      resolve(capturedKey);
    });
    probe.connect({
      host: '127.0.0.1',
      port,
      username: 'tester',
      password: 'geared-secret',
      hostVerifier: (key: Buffer) => {
        capturedKey = fingerprintSha256(key);
        return true;
      }
    });
  });

  sftpRoot = await fs.mkdtemp(join(tmpdir(), 'geared-sftp-'));
  await fs.mkdir(join(sftpRoot, 'home', 'tester'), { recursive: true });

  return {
    port,
    hostKeyFingerprint,
    trace,
    remoteFsPath: (path: string) => join(sftpRoot, resolveRemote(path).slice(1)),
    dropConnections: (mode) => {
      for (const connection of [...connections]) {
        if (mode === 'abrupt') connection.abrupt();
        else connection.end();
      }
    },
    close: async () => {
      for (const connection of [...connections]) connection.end();
      await fs.rm(sftpRoot, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}
