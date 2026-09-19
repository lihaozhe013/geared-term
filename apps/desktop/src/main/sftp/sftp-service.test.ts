import type { SFTPWrapper } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import { remoteChildPath, SftpService } from './sftp-service';

describe('SFTP path handling', () => {
  it('joins remote entries without allowing nested names', () => {
    expect(remoteChildPath('/home/alice', 'notes.txt')).toBe('/home/alice/notes.txt');
    expect(() => remoteChildPath('/home/alice', '../escape')).toThrow('unsupported path');
    expect(() => remoteChildPath('/home/alice', 'a/b')).toThrow('unsupported path');
  });

  it('normalizes listing paths and does not follow symbolic links during removal', async () => {
    const readdir = vi.fn(
      (_path: string, callback: (error: Error | null, entries: never[]) => void) =>
        callback(null, [])
    );
    const lstat = vi.fn(
      (
        _path: string,
        callback: (
          error: Error | null,
          stats: { isDirectory: () => boolean; isSymbolicLink: () => boolean }
        ) => void
      ) =>
        callback(null, {
          isDirectory: () => true,
          isSymbolicLink: () => true
        })
    );
    const unlink = vi.fn((path: string, callback: (error?: Error | null) => void) =>
      callback(null)
    );
    const service = new SftpService({
      readdir,
      lstat,
      unlink,
      rmdir: vi.fn()
    } as unknown as SFTPWrapper);

    await service.list('/home/alice/../bob');
    expect(unlink).not.toHaveBeenCalled();
    await service.remove('/home/alice/link');
    expect(unlink).toHaveBeenCalledWith('/home/alice/link', expect.any(Function));
  });

  it('delegates bounded file transfers to the SFTP channel', async () => {
    const fastPut = vi.fn(
      (local: string, remote: string, callback: (error?: Error | null) => void) => callback(null)
    );
    const fastGet = vi.fn(
      (remote: string, local: string, callback: (error?: Error | null) => void) => callback(null)
    );
    const service = new SftpService({ fastPut, fastGet } as unknown as SFTPWrapper);

    await service.upload('C:\\tmp\\notes.txt', '/home/alice/notes.txt');
    await service.download('/home/alice/notes.txt', 'C:\\tmp\\copy.txt');
    expect(fastPut).toHaveBeenCalledWith(
      'C:\\tmp\\notes.txt',
      '/home/alice/notes.txt',
      expect.any(Function)
    );
    expect(fastGet).toHaveBeenCalledWith(
      '/home/alice/notes.txt',
      'C:\\tmp\\copy.txt',
      expect.any(Function)
    );
  });
});
