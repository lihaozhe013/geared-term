import { posix } from 'node:path';
import type { SFTPWrapper, FileEntryWithStats } from 'ssh2';

export type RemoteEntry = {
  name: string;
  path: string;
  longName: string;
  kind: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modifiedAt: number | null;
};

function call<T>(
  operation: (callback: (error: Error | null | undefined, value: T) => void) => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    operation((error, value) => (error ? reject(error) : resolve(value)));
  });
}

function callVoid(
  operation: (callback: (error: Error | null | undefined) => void) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    operation((error) => (error ? reject(error) : resolve()));
  });
}

export function remoteChildPath(directory: string, name: string): string {
  if (name.includes('\0') || name === '.' || name === '..' || name.includes('/')) {
    throw new Error('Remote entry name contains an unsupported path component');
  }
  return posix.join(directory || '.', name);
}

function mapEntry(directory: string, entry: FileEntryWithStats): RemoteEntry {
  const kind = entry.attrs.isDirectory()
    ? 'directory'
    : entry.attrs.isSymbolicLink()
      ? 'symlink'
      : entry.attrs.isFile()
        ? 'file'
        : 'other';
  return {
    name: entry.filename,
    path: remoteChildPath(directory, entry.filename),
    longName: entry.longname,
    kind,
    size: entry.attrs.size,
    modifiedAt: entry.attrs.mtime ? entry.attrs.mtime * 1000 : null
  };
}

export class SftpService {
  public constructor(private readonly sftp: SFTPWrapper) {}

  public async list(directory: string): Promise<RemoteEntry[]> {
    const entries = await call<FileEntryWithStats[]>((callback) =>
      this.sftp.readdir(directory, callback)
    );
    return entries.map((entry) => mapEntry(directory, entry));
  }

  public async mkdir(path: string): Promise<void> {
    await callVoid((callback) => this.sftp.mkdir(path, callback));
  }

  public async rename(source: string, destination: string): Promise<void> {
    await callVoid((callback) => this.sftp.rename(source, destination, callback));
  }

  public async remove(path: string): Promise<void> {
    const stats = await call<{ isDirectory(): boolean; isSymbolicLink(): boolean }>((callback) =>
      this.sftp.stat(path, callback)
    );
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      for (const entry of await this.list(path)) await this.remove(entry.path);
      await callVoid((callback) => this.sftp.rmdir(path, callback));
    } else {
      await callVoid((callback) => this.sftp.unlink(path, callback));
    }
  }

  public async upload(localPath: string, remotePath: string): Promise<void> {
    await callVoid((callback) => this.sftp.fastPut(localPath, remotePath, callback));
  }

  public async download(remotePath: string, localPath: string): Promise<void> {
    await callVoid((callback) => this.sftp.fastGet(remotePath, localPath, callback));
  }
}
