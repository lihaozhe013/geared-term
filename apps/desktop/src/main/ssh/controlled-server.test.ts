import { promises as fs, type Stats as FsStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { posix } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ssh2, { type ClientChannel, type ServerChannel, type Session } from 'ssh2';
import type { Client as ClientType, SFTPWrapper } from 'ssh2';
import type { SftpTransfer, SftpTransferEvent } from '@geared-term/protocol';
import { fingerprintSha256 } from './known-hosts';
import { SftpService } from '../sftp/sftp-service';
import { TransferManager } from '../sftp/transfers';

const { Client, Server, utils } = ssh2;
const STATUS = utils.sftp.STATUS_CODE;
const flagsToString = utils.sftp.flagsToString;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const hostKeys = [utils.generateKeyPairSync('rsa', { bits: 2048 }).private];

type SessionTrace = {
  pty: { cols: number; rows: number; term: string } | null;
  windowChanges: Array<{ cols: number; rows: number }>;
  shellInput: string;
  authAttempts: string[];
  sftpOps: string[];
};

const trace: SessionTrace = {
  pty: null,
  windowChanges: [],
  shellInput: '',
  authAttempts: [],
  sftpOps: []
};

let server: InstanceType<typeof Server>;
let port = 0;
let hostKeyFingerprint = '';
type ServerConnection = { end: () => void };
const connections = new Set<ServerConnection>();

const REMOTE_CWD = '/home/tester';
let sftpRoot = '';

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

function remoteFsPath(path: string): string {
  return join(sftpRoot, resolveRemote(path).slice(1));
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
 * against real on-disk state. Paths outside this test are POSIX-style and map
 * onto `sftpRoot`; transfers touching a "slow-" path are artificially
 * delayed per chunk so cancellation can be timed deterministically.
 */
function attachSftpSubsystem(session: Session): void {
  session.on('sftp', (accept) => {
    const sftp = accept() as unknown as ServerSftpStream;
    const handles = new Map<string, SftpHandle>();
    let nextHandleId = 0;
    const ops = trace.sftpOps;

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
    const throttledRead = async (entry: { remotePath: string }): Promise<void> => {
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
        await throttledRead(entry);
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
        await throttledRead(entry);
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
          .map((e) => e.name)
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

beforeAll(async () => {
  server = new Server({ hostKeys }, (connection) => {
    connections.add(connection);
    connection.on('close', () => connections.delete(connection));
    connection.on('error', () => connections.delete(connection));
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
      let shellChannel: ServerChannel | undefined;
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
        channel.on('data', (data: Buffer) => {
          trace.shellInput += data.toString();
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
      attachSftpSubsystem(session);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
  sftpRoot = await fs.mkdtemp(join(tmpdir(), 'geared-sftp-'));
  await fs.mkdir(join(sftpRoot, 'home', 'tester'), { recursive: true });
  hostKeyFingerprint = await new Promise<string>((resolve, reject) => {
    const probe = new Client();
    probe.on('error', reject);
    probe.on('ready', () => {
      probe.end();
      resolve(fingerprintSha256(capturedKey));
    });
    let capturedKey = Buffer.alloc(0);
    probe.connect({
      host: '127.0.0.1',
      port,
      username: 'tester',
      password: 'geared-secret',
      hostVerifier: (key: Buffer) => {
        capturedKey = Buffer.from(key);
        return true;
      }
    });
  });
});

afterAll(async () => {
  for (const connection of [...connections]) connection.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (sftpRoot) await fs.rm(sftpRoot, { recursive: true, force: true });
});

function connect(password = 'geared-secret'): ClientType {
  const client = new Client();
  client.connect({
    host: '127.0.0.1',
    port,
    username: 'tester',
    password,
    readyTimeout: 8000,
    hostVerifier: (key: Buffer) => fingerprintSha256(key) === hostKeyFingerprint
  });
  return client;
}

function connectSftp(): Promise<{ client: ClientType; service: SftpService }> {
  return new Promise((resolve, reject) => {
    const client = connect();
    client.on('error', reject);
    client.on('ready', () => {
      client.sftp((error: Error | undefined, sftp: SFTPWrapper) => {
        if (error) return reject(error);
        resolve({ client, service: new SftpService(sftp) });
      });
    });
  });
}

describe('controlled SSH server', () => {
  it('accepts deterministic password auth and reports exec output', async () => {
    const client = connect();
    const output = await new Promise<string>((resolve, reject) => {
      client.on('error', reject);
      client.on('ready', () => {
        client.exec('pwd', (error: Error | undefined, stream: ClientChannel) => {
          if (error) return reject(error);
          let data = '';
          stream.on('data', (chunk: Buffer) => (data += chunk.toString()));
          stream.on('close', (code: number | null) => {
            expect(code).toBe(0);
            resolve(data);
          });
        });
      });
    });
    expect(output.trim()).toBe('/home/tester');
    client.end();
  });

  it('rejects wrong passwords and a changed host key', async () => {
    await expect(
      new Promise((_resolve, reject) => {
        const client = connect('wrong');
        client.on('error', reject);
        client.on('ready', () => {
          client.end();
          reject(new Error('authentication should have failed'));
        });
      })
    ).rejects.toThrow(/All configured authentication methods failed/iu);

    await expect(
      new Promise((_resolve, reject) => {
        const client = new Client();
        client.on('error', reject);
        client.on('ready', () => {
          client.end();
          reject(new Error('host key should not have verified'));
        });
        client.connect({
          host: '127.0.0.1',
          port,
          username: 'tester',
          password: 'geared-secret',
          hostVerifier: () => false
        });
      })
    ).rejects.toThrow(/host key|verification|Handshake/iu);
  });

  it('carries the PTY geometry, echoes shell input, applies resizes, and reports exit', async () => {
    const client = connect();
    const collected = await new Promise<string>((resolve, reject) => {
      client.on('error', reject);
      client.on('ready', () => {
        client.shell(
          { term: 'xterm-256color', cols: 90, rows: 28 },
          (error: Error | undefined, channel: ClientChannel) => {
            if (error) return reject(error);
            let data = '';
            channel.on('data', (chunk: Buffer) => {
              data += chunk.toString();
              if (data.includes('120x36')) {
                channel.write('exit\r');
                channel.end();
                resolve(data);
              }
            });
            channel.on('exit', (code) => expect(code).toBeUndefined());
            setTimeout(() => channel.setWindow(36, 120, 0, 0), 150);
          }
        );
      });
    });
    expect(collected).toContain('ready');
    expect(collected).toContain('120x36');
    expect(trace.pty).toEqual({ cols: 90, rows: 28, term: 'xterm-256color' });
    expect(trace.windowChanges).toContainEqual({ cols: 120, rows: 36 });
    await vi.waitFor(() => expect(trace.shellInput).toContain('exit'), { timeout: 3000 });
    client.end();
  });

  it('surfaces disconnect as an explicit end state', async () => {
    const client = connect();
    const closed = await new Promise<string>((resolve, reject) => {
      client.on('error', reject);
      client.on('ready', () => client.end());
      client.on('close', () => resolve('closed'));
    });
    expect(closed).toBe('closed');
  });
});

describe('controlled SFTP subsystem', () => {
  it('serves the sftp subsystem after authentication', async () => {
    const { client, service } = await connectSftp();
    const root = await service.canonicalize('.');
    expect(root).toBe(REMOTE_CWD);
    expect(trace.sftpOps).toContain('REALPATH');
    client.end();
  });

  it('lists directories with kinds, sizes, and canonical paths', async () => {
    const { client, service } = await connectSftp();
    await fs.mkdir(remoteFsPath('/home/tester/browse/archive'), { recursive: true });
    await fs.writeFile(remoteFsPath('/home/tester/browse/notes.txt'), 'hello');
    const entries = await service.list('/home/tester/browse');
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    expect([...byName.keys()].sort()).toEqual(['archive', 'notes.txt']);
    const file = byName.get('notes.txt');
    expect(file?.kind).toBe('file');
    expect(file?.size).toBe(5);
    expect(file?.path).toBe('/home/tester/browse/notes.txt');
    const directory = byName.get('archive');
    expect(directory?.kind).toBe('directory');
    client.end();
  });

  it('creates nested directories and tolerates existing segments', async () => {
    const { client, service } = await connectSftp();
    await service.mkdir('/home/tester/projects');
    await expect(service.ensureDir('/home/tester/projects/geared/src')).resolves.toBeUndefined();
    await expect(service.ensureDir('/home/tester/projects/geared/src')).resolves.toBeUndefined();
    const created = await fs.stat(remoteFsPath('/home/tester/projects/geared/src'));
    expect(created.isDirectory()).toBe(true);
    client.end();
  });

  it('renames entries and removes directory trees recursively', async () => {
    const { client, service } = await connectSftp();
    await fs.mkdir(remoteFsPath('/home/tester/tree/inner'), { recursive: true });
    await fs.writeFile(remoteFsPath('/home/tester/tree/inner/leaf.txt'), 'leaf');
    await service.rename('/home/tester/tree/inner/leaf.txt', '/home/tester/tree/inner/renamed.txt');
    await expect(fs.access(remoteFsPath('/home/tester/tree/inner/leaf.txt'))).rejects.toThrow();
    const renamed = await service.stat('/home/tester/tree/inner/renamed.txt');
    expect(renamed.size).toBe(4);
    await service.rename('/home/tester/tree', '/home/tester/tree-moved');
    await service.remove('/home/tester/tree-moved');
    await expect(fs.access(remoteFsPath('/home/tester/tree-moved'))).rejects.toThrow();
    client.end();
  });

  it('uploads and downloads files byte-for-byte over the SFTP channel', async () => {
    const { client, service } = await connectSftp();
    const work = await fs.mkdtemp(join(tmpdir(), 'geared-sftp-client-'));
    const payload = Buffer.alloc(256 * 1024, 42);
    for (let index = 0; index < payload.length; index += 4096) {
      payload[index] = index % 251;
    }
    const localFile = join(work, 'payload.bin');
    await fs.writeFile(localFile, payload);
    const remoteFile = '/home/tester/payload.bin';
    await service.upload(localFile, remoteFile);
    expect((await fs.readFile(remoteFsPath(remoteFile))).equals(payload)).toBe(true);
    const downloadedFile = join(work, 'downloaded.bin');
    await service.download(remoteFile, downloadedFile);
    expect((await fs.readFile(downloadedFile)).equals(payload)).toBe(true);
    await fs.rm(work, { recursive: true, force: true });
    await service.remove(remoteFile);
    client.end();
  });

  it('cancels an in-flight upload and removes the partial remote file', async () => {
    const { client, service } = await connectSftp();
    const work = await fs.mkdtemp(join(tmpdir(), 'geared-sftp-client-'));
    const states = new Map<string, SftpTransfer>();
    const manager = new TransferManager(
      async () => service,
      (event: SftpTransferEvent) => states.set(event.transfer.id, { ...event.transfer })
    );
    const localFile = join(work, 'slow-upload.bin');
    await fs.writeFile(localFile, Buffer.alloc(4 * 1024 * 1024, 7));
    const remoteDirectory = '/home/tester/incoming';
    await service.mkdir(remoteDirectory);
    const [transfer] = await manager.uploadPaths({
      sessionId: 'upload-session',
      localPaths: [localFile],
      remoteDirectory
    });
    if (!transfer) throw new Error('upload transfer was not created');
    const remoteFile = `${remoteDirectory}/slow-upload.bin`;
    await vi.waitFor(
      () => {
        const current = states.get(transfer.id);
        expect(current?.status === 'active' && current.transferredBytes > 0).toBe(true);
      },
      { timeout: 5000 }
    );
    expect(manager.cancel(transfer.id)).toBe(true);
    await vi.waitFor(
      () => expect(['cancelled', 'failed']).toContain(states.get(transfer.id)?.status),
      { timeout: 5000 }
    );
    expect(states.get(transfer.id)?.status).toBe('cancelled');
    await expect(service.stat(remoteFile)).rejects.toThrow();
    await fs.rm(work, { recursive: true, force: true });
    client.end();
  });

  it('cancels an in-flight download and removes the partial local file', async () => {
    const { client, service } = await connectSftp();
    const work = await fs.mkdtemp(join(tmpdir(), 'geared-sftp-client-'));
    const states = new Map<string, SftpTransfer>();
    const manager = new TransferManager(
      async () => service,
      (event: SftpTransferEvent) => states.set(event.transfer.id, { ...event.transfer })
    );
    const remoteFile = '/home/tester/slow-download.bin';
    await fs.writeFile(remoteFsPath(remoteFile), Buffer.alloc(4 * 1024 * 1024, 9));
    const [transfer] = await manager.downloadPaths({
      sessionId: 'download-session',
      remotePaths: [remoteFile],
      localDirectory: work
    });
    if (!transfer) throw new Error('download transfer was not created');
    await vi.waitFor(
      () => {
        const current = states.get(transfer.id);
        expect(current?.status === 'active' && current.transferredBytes > 0).toBe(true);
      },
      { timeout: 5000 }
    );
    expect(manager.cancel(transfer.id)).toBe(true);
    await vi.waitFor(
      () => expect(['cancelled', 'failed']).toContain(states.get(transfer.id)?.status),
      { timeout: 5000 }
    );
    expect(states.get(transfer.id)?.status).toBe('cancelled');
    await expect(fs.access(join(work, 'slow-download.bin'))).rejects.toThrow();
    await fs.rm(work, { recursive: true, force: true });
    await service.remove(remoteFile);
    client.end();
  });
});
