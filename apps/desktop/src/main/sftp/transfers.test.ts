import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { SftpTransfer, SftpTransferEvent } from '@geared-term/protocol';
import { TransferManager } from './transfers';
import type { SftpService } from './sftp-service';

type FakeFile = { path: string; content: Buffer; isDirectory: boolean };

function createFakeSftp(files: FakeFile[], removed: string[]) {
  const writeBuffers = new Map<string, { chunks: Buffer[] }>();
  const directories = new Set<string>(['/']);
  const service = {
    async stat(path: string) {
      const file = files.find((entry) => entry.path === path);
      if (!file) throw new Error(`missing ${path}`);
      return { size: file.content.length, isDirectory: file.isDirectory };
    },
    async list() {
      return [];
    },
    async ensureDir(path: string) {
      directories.add(path);
    },
    createRemoteReadStream(path: string) {
      const file = files.find((entry) => entry.path === path);
      const stream = new PassThrough();
      if (!file) {
        setImmediate(() => stream.destroy(new Error(`missing ${path}`)));
        return stream;
      }
      setImmediate(() => {
        stream.end(file.content);
      });
      return stream;
    },
    createRemoteWriteStream(path: string) {
      const chunks: Buffer[] = [];
      writeBuffers.set(path, { chunks });
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          setTimeout(callback, 5);
        }
      });
      return stream;
    },
    async remove(path: string) {
      removed.push(path);
    }
  };
  return { service: service as unknown as SftpService, writeBuffers, directories };
}

async function tempDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'geared-transfers-'));
}

describe('TransferManager', () => {
  it('uploads a file with byte progress and completion state', async () => {
    const root = await tempDirectory();
    const localPath = join(root, 'notes.txt');
    await writeFile(localPath, 'x'.repeat(5000));
    const events: SftpTransferEvent[] = [];
    const { service, writeBuffers } = createFakeSftp([], []);
    const manager = new TransferManager(
      async () => service,
      (event) => events.push(event)
    );

    const transfer = (
      await manager.uploadPaths({
        sessionId: 'session-1',
        localPaths: [localPath],
        remoteDirectory: '/srv'
      })
    )[0] as SftpTransfer;
    expect(transfer.totalBytes).toBe(5000);

    await vi.waitFor(() => {
      expect(manager.transfers('session-1')[0]?.status).toBe('completed');
    });
    const completed = manager.transfers('session-1')[0];
    expect(completed?.transferredBytes).toBe(5000);
    expect(writeBuffers.get('/srv/notes.txt')?.chunks.reduce((sum, c) => sum + c.length, 0)).toBe(
      5000
    );
    expect(events.some((event) => event.kind === 'progress')).toBe(true);
  });

  it('cancels an active transfer and removes the partial file', async () => {
    const root = await tempDirectory();
    const localPath = join(root, 'big.bin');
    await writeFile(localPath, Buffer.alloc(2 * 1024 * 1024, 7));
    const removed: string[] = [];
    const { service } = createFakeSftp([], removed);
    const manager = new TransferManager(
      async () => service,
      () => undefined
    );

    const transfer = (
      await manager.uploadPaths({
        sessionId: 'session-1',
        localPaths: [localPath],
        remoteDirectory: '/srv'
      })
    )[0] as SftpTransfer;
    await vi.waitFor(() => {
      expect(manager.transfers('session-1')[0]?.status).toBe('active');
    });
    expect(manager.cancel(transfer.id)).toBe(true);
    await vi.waitFor(() => {
      expect(manager.transfers('session-1')[0]?.status).toBe('cancelled');
    });
    expect(removed).toContain('/srv/big.bin');
    expect(manager.transfers('session-1')[0]?.transferredBytes).toBeLessThan(2 * 1024 * 1024);
  });

  it('downloads a remote file into the local directory', async () => {
    const root = await tempDirectory();
    const files: FakeFile[] = [
      { path: '/remote/report.txt', content: Buffer.from('hello'), isDirectory: false }
    ];
    const { service } = createFakeSftp(files, []);
    const manager = new TransferManager(
      async () => service,
      () => undefined
    );

    const transfer = (
      await manager.downloadPaths({
        sessionId: 'session-1',
        remotePaths: ['/remote/report.txt'],
        localDirectory: root
      })
    )[0] as SftpTransfer;
    await vi.waitFor(() => {
      expect(manager.transfers('session-1')[0]?.status).toBe('completed');
    });
    const localPath = join(root, transfer.name);
    expect(await readFile(localPath, 'utf8')).toBe('hello');
  });

  it('aggregates a directory tree into one grouped transfer', async () => {
    const root = await tempDirectory();
    const source = join(root, 'bundle');
    await mkdir(join(source, 'nested'), { recursive: true });
    await writeFile(join(source, 'a.txt'), 'a'.repeat(300));
    await writeFile(join(source, 'nested', 'b.txt'), 'b'.repeat(700));
    const events: SftpTransferEvent[] = [];
    const { service, writeBuffers, directories } = createFakeSftp([], []);
    const manager = new TransferManager(
      async () => service,
      (event) => events.push(event)
    );

    const transfers = await manager.uploadPaths({
      sessionId: 'session-1',
      localPaths: [source],
      remoteDirectory: '/srv'
    });
    expect(transfers).toHaveLength(1);
    const group = transfers[0] as SftpTransfer;
    expect(group.name).toBe('bundle');
    expect(group.fileCount).toBe(2);
    expect(group.totalBytes).toBe(1000);

    await vi.waitFor(() => {
      expect(manager.transfers('session-1')[0]?.status).toBe('completed');
    });
    expect(group.remotePath).toBe('/srv/bundle');
    expect(directories.has('/srv/bundle/nested')).toBe(true);
    const writtenBytes =
      (writeBuffers.get('/srv/bundle/a.txt')?.chunks.reduce((sum, c) => sum + c.length, 0) ?? 0) +
      (writeBuffers.get('/srv/bundle/nested/b.txt')?.chunks.reduce((sum, c) => sum + c.length, 0) ??
        0);
    expect(writtenBytes).toBe(1000);
    const finalEvents = events.filter(
      (event) => event.kind === 'state' && event.transfer.status === 'completed'
    );
    expect(finalEvents).toHaveLength(1);
    expect(manager.transfers('session-1')[0]?.transferredBytes).toBe(1000);
  });
});
