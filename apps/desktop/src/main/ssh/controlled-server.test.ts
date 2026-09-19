import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ssh2, { type ClientChannel } from 'ssh2';
import type { Client as ClientType, SFTPWrapper } from 'ssh2';
import type { SftpTransfer, SftpTransferEvent } from '@geared-term/protocol';
import { fingerprintSha256 } from './known-hosts';
import { startControlledServer, type ControlledServer } from './controlled-server';
import { SftpService } from '../sftp/sftp-service';
import { TransferManager } from '../sftp/transfers';

const { Client } = ssh2;

let server: ControlledServer;
let port = 0;
let hostKeyFingerprint = '';

beforeAll(async () => {
  server = await startControlledServer();
  port = server.port;
  hostKeyFingerprint = server.hostKeyFingerprint;
});

afterAll(async () => {
  await server.close();
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
    expect(server.trace.pty).toEqual({ cols: 90, rows: 28, term: 'xterm-256color' });
    expect(server.trace.windowChanges).toContainEqual({ cols: 120, rows: 36 });
    await vi.waitFor(() => expect(server.trace.shellInput).toContain('exit'), { timeout: 3000 });
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
    expect(root).toBe('/home/tester');
    expect(server.trace.sftpOps).toContain('REALPATH');
    client.end();
  });

  it('lists directories with kinds, sizes, and canonical paths', async () => {
    const { client, service } = await connectSftp();
    await fs.mkdir(server.remoteFsPath('/home/tester/browse/archive'), { recursive: true });
    await fs.writeFile(server.remoteFsPath('/home/tester/browse/notes.txt'), 'hello');
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
    const created = await fs.stat(server.remoteFsPath('/home/tester/projects/geared/src'));
    expect(created.isDirectory()).toBe(true);
    client.end();
  });

  it('renames entries and removes directory trees recursively', async () => {
    const { client, service } = await connectSftp();
    await fs.mkdir(server.remoteFsPath('/home/tester/tree/inner'), { recursive: true });
    await fs.writeFile(server.remoteFsPath('/home/tester/tree/inner/leaf.txt'), 'leaf');
    await service.rename('/home/tester/tree/inner/leaf.txt', '/home/tester/tree/inner/renamed.txt');
    await expect(
      fs.access(server.remoteFsPath('/home/tester/tree/inner/leaf.txt'))
    ).rejects.toThrow();
    const renamed = await service.stat('/home/tester/tree/inner/renamed.txt');
    expect(renamed.size).toBe(4);
    await service.rename('/home/tester/tree', '/home/tester/tree-moved');
    await service.remove('/home/tester/tree-moved');
    await expect(fs.access(server.remoteFsPath('/home/tester/tree-moved'))).rejects.toThrow();
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
    expect((await fs.readFile(server.remoteFsPath(remoteFile))).equals(payload)).toBe(true);
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
    await fs.writeFile(server.remoteFsPath(remoteFile), Buffer.alloc(4 * 1024 * 1024, 9));
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
