import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { posix } from 'node:path';
import type {
  SftpDownloadPathsRequest,
  SftpTransfer,
  SftpTransferEvent,
  SftpUploadPathsRequest
} from '@geared-term/protocol';
import { remoteChildPath, type SftpService } from './sftp-service';

const MAX_TRANSFER_FILES = 2000;
const PROGRESS_INTERVAL_MS = 200;

type ActiveTransfer = {
  transfer: SftpTransfer;
  cancelled: boolean;
  source?: { destroy: () => void };
  target?: { destroy: () => void };
};

function toRemoteRelative(localRoot: string, localFile: string): string {
  return relative(localRoot, localFile).split(sep).join('/');
}

async function walkLocalFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop() as string;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) files.push(path);
      if (files.length > MAX_TRANSFER_FILES) throw new Error('Directory contains too many files');
    }
  }
  return files;
}

async function walkRemoteFiles(
  service: SftpService,
  root: string,
  directories: string[]
): Promise<{ path: string; size: number }[]> {
  const files: { path: string; size: number }[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop() as string;
    for (const entry of await service.list(directory)) {
      if (entry.kind === 'symlink') continue;
      if (entry.kind === 'directory') {
        directories.push(entry.path);
        stack.push(entry.path);
      } else if (entry.kind === 'file') {
        files.push({ path: entry.path, size: entry.size });
      }
      if (files.length > MAX_TRANSFER_FILES) throw new Error('Directory contains too many files');
    }
  }
  return files;
}

/**
 * Tracks byte-progress transfers with stable identifiers. Progress is
 * throttled; cancellation destroys the active streams and removes partial
 * output. Operations run sequentially per session to keep the SSH channel
 * responsive for terminal I/O.
 */
export class TransferManager {
  private readonly active = new Map<string, ActiveTransfer>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly finished: SftpTransfer[] = [];

  public constructor(
    private readonly getService: (sessionId: string) => Promise<SftpService>,
    private readonly emit: (event: SftpTransferEvent) => void
  ) {}

  public transfers(sessionId?: string): SftpTransfer[] {
    const live = [...this.active.values()].map((entry) => entry.transfer);
    const all = [...live, ...this.finished].filter(
      (transfer) => !sessionId || transfer.sessionId === sessionId
    );
    return all.slice(-200);
  }

  public async uploadPaths(request: SftpUploadPathsRequest): Promise<SftpTransfer[]> {
    const service = await this.getService(request.sessionId);
    const jobs: { localPath: string; remotePath: string; size: number }[] = [];
    for (const localPath of request.localPaths) {
      const stats = await fs.stat(localPath);
      if (stats.isDirectory()) {
        const files = await walkLocalFiles(localPath);
        const remoteRoot = remoteChildPath(request.remoteDirectory, basename(localPath));
        const directories = new Set<string>([remoteRoot]);
        for (const file of files) {
          const remotePath = posix.join(remoteRoot, toRemoteRelative(localPath, file));
          directories.add(posix.dirname(remotePath));
          jobs.push({ localPath: file, remotePath, size: (await fs.stat(file)).size });
        }
        for (const directory of directories) await service.ensureDir(directory);
      } else {
        jobs.push({
          localPath,
          remotePath: remoteChildPath(request.remoteDirectory, basename(localPath)),
          size: stats.size
        });
      }
    }
    return jobs.map((job) => this.start(request.sessionId, 'upload', job));
  }

  public async downloadPaths(request: SftpDownloadPathsRequest): Promise<SftpTransfer[]> {
    const service = await this.getService(request.sessionId);
    const jobs: { localPath: string; remotePath: string; size: number }[] = [];
    for (const remotePath of request.remotePaths) {
      const stats = await service.stat(remotePath);
      if (stats.isDirectory) {
        const directories: string[] = [];
        const files = await walkRemoteFiles(service, remotePath, directories);
        const localRoot = join(request.localDirectory, basename(remotePath));
        for (const directory of [
          localRoot,
          ...directories.map((entry) =>
            join(localRoot, relative(remotePath, entry).split(sep).join('/'))
          )
        ]) {
          await fs.mkdir(directory, { recursive: true });
        }
        for (const file of files) {
          jobs.push({
            localPath: join(localRoot, relative(remotePath, file.path).split(sep).join('/')),
            remotePath: file.path,
            size: file.size
          });
        }
      } else {
        jobs.push({
          localPath: join(request.localDirectory, basename(remotePath)),
          remotePath,
          size: stats.size
        });
      }
    }
    return jobs.map((job) => this.start(request.sessionId, 'download', job));
  }

  public cancel(transferId: string): boolean {
    const entry = this.active.get(transferId);
    if (!entry) return false;
    entry.cancelled = true;
    entry.source?.destroy();
    entry.target?.destroy();
    return true;
  }

  public cancelForSession(sessionId: string): void {
    for (const entry of [...this.active.values()]) {
      if (entry.transfer.sessionId === sessionId) this.cancel(entry.transfer.id);
    }
  }

  private start(
    sessionId: string,
    direction: 'upload' | 'download',
    job: { localPath: string; remotePath: string; size: number }
  ): SftpTransfer {
    const id = randomUUID();
    const transfer: SftpTransfer = {
      id,
      sessionId,
      direction,
      name: (direction === 'upload' ? basename(job.localPath) : basename(job.remotePath)).slice(
        0,
        4096
      ),
      remotePath: job.remotePath,
      localPath: job.localPath,
      totalBytes: Number.isFinite(job.size) ? job.size : null,
      transferredBytes: 0,
      status: 'queued'
    };
    const entry: ActiveTransfer = { transfer, cancelled: false };
    this.active.set(id, entry);
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const run = previous.then(() => this.run(entry));
    this.queues.set(
      sessionId,
      run.catch(() => undefined)
    );
    void run.finally(() => {
      this.active.delete(id);
      this.finished.push(entry.transfer);
      if (this.finished.length > 200) this.finished.splice(0, this.finished.length - 200);
      this.emit({ kind: 'state', transfer: { ...entry.transfer } });
    });
    return { ...transfer };
  }

  private async run(entry: ActiveTransfer): Promise<void> {
    const { transfer } = entry;
    if (entry.cancelled) {
      transfer.status = 'cancelled';
      return;
    }
    transfer.status = 'active';
    this.emit({ kind: 'state', transfer: { ...transfer } });
    try {
      const service = await this.getService(transfer.sessionId);
      await this.copy(service, entry);
      if (entry.cancelled) throw new Error('__cancelled__');
      transfer.status = 'completed';
    } catch (error) {
      if (entry.cancelled || (error instanceof Error && error.message === '__cancelled__')) {
        transfer.status = 'cancelled';
      } else {
        transfer.status = 'failed';
        transfer.error = error instanceof Error ? error.message : String(error);
      }
      await this.removePartial(transfer, transfer.direction);
    }
  }

  private async removePartial(
    transfer: SftpTransfer,
    direction: 'upload' | 'download'
  ): Promise<void> {
    try {
      if (direction === 'upload') {
        const service = await this.getService(transfer.sessionId).catch(() => undefined);
        await service?.remove(transfer.remotePath);
      } else {
        await fs.rm(transfer.localPath, { force: true });
      }
    } catch {
      // best-effort cleanup of partial output
    }
  }

  private copy(service: SftpService, entry: ActiveTransfer): Promise<void> {
    const { transfer } = entry;
    return new Promise<void>((resolve, reject) => {
      const source =
        transfer.direction === 'upload'
          ? createReadStream(transfer.localPath)
          : service.createRemoteReadStream(transfer.remotePath);
      const target =
        transfer.direction === 'upload'
          ? service.createRemoteWriteStream(transfer.remotePath)
          : createWriteStream(transfer.localPath);
      entry.source = source;
      entry.target = target;
      if (entry.cancelled) {
        source.destroy();
        target.destroy();
        reject(new Error('__cancelled__'));
        return;
      }
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      let lastEmit = 0;
      source.on('data', (chunk: Buffer) => {
        transfer.transferredBytes += chunk.length;
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now;
          this.emit({ kind: 'progress', transfer: { ...transfer } });
        }
      });
      source.on('error', fail);
      target.on('error', fail);
      target.on('close', succeed);
      source.pipe(target as NodeJS.WritableStream);
    });
  }
}
