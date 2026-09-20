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

type FileJob = {
  localPath: string;
  remotePath: string;
  size: number;
};

type GroupEntry = {
  transfer: SftpTransfer;
  jobs: FileJob[];
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

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === '__cancelled__';
}

/**
 * Tracks byte-progress transfers with stable identifiers, one visible entry
 * per selected top-level item (directory trees are aggregated). Progress is
 * throttled; cancellation destroys the active streams and removes partial
 * output without touching files that already completed. Operations run
 * sequentially per session to keep the SSH channel responsive for terminal
 * I/O.
 */
export class TransferManager {
  private readonly active = new Map<string, GroupEntry>();
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
    const groups: { name: string; localPath: string; remotePath: string; jobs: FileJob[] }[] = [];
    for (const localPath of request.localPaths) {
      const stats = await fs.stat(localPath);
      if (stats.isDirectory()) {
        const files = await walkLocalFiles(localPath);
        const remoteRoot = remoteChildPath(request.remoteDirectory, basename(localPath));
        const directories = new Set<string>([remoteRoot]);
        const jobs: FileJob[] = [];
        for (const file of files) {
          const remotePath = posix.join(remoteRoot, toRemoteRelative(localPath, file));
          directories.add(posix.dirname(remotePath));
          jobs.push({ localPath: file, remotePath, size: (await fs.stat(file)).size });
        }
        for (const directory of directories) await service.ensureDir(directory);
        groups.push({
          name: basename(localPath),
          localPath,
          remotePath: remoteRoot,
          jobs
        });
      } else {
        const remotePath = remoteChildPath(request.remoteDirectory, basename(localPath));
        groups.push({
          name: basename(localPath),
          localPath,
          remotePath,
          jobs: [{ localPath, remotePath, size: stats.size }]
        });
      }
    }
    return groups.map((group) => this.start(request.sessionId, 'upload', group));
  }

  public async downloadPaths(request: SftpDownloadPathsRequest): Promise<SftpTransfer[]> {
    const service = await this.getService(request.sessionId);
    const groups: { name: string; localPath: string; remotePath: string; jobs: FileJob[] }[] = [];
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
        groups.push({
          name: basename(remotePath),
          localPath: localRoot,
          remotePath,
          jobs: files.map((file) => ({
            localPath: join(localRoot, relative(remotePath, file.path).split(sep).join('/')),
            remotePath: file.path,
            size: file.size
          }))
        });
      } else {
        const localPath = join(request.localDirectory, basename(remotePath));
        groups.push({
          name: basename(remotePath),
          localPath,
          remotePath,
          jobs: [{ localPath, remotePath, size: stats.size }]
        });
      }
    }
    return groups.map((group) => this.start(request.sessionId, 'download', group));
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
    group: { name: string; localPath: string; remotePath: string; jobs: FileJob[] }
  ): SftpTransfer {
    const jobs = group.jobs;
    const sizesKnown = jobs.every((job) => Number.isFinite(job.size));
    const id = randomUUID();
    const transfer: SftpTransfer = {
      id,
      sessionId,
      direction,
      name: group.name.slice(0, 4096),
      remotePath: group.remotePath,
      localPath: group.localPath,
      totalBytes: sizesKnown ? jobs.reduce((sum, job) => sum + job.size, 0) : null,
      transferredBytes: 0,
      status: 'queued'
    };
    if (jobs.length > 1) transfer.fileCount = jobs.length;
    const entry: GroupEntry = { transfer, jobs, cancelled: false };
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

  private async run(entry: GroupEntry): Promise<void> {
    const { transfer } = entry;
    if (entry.cancelled) {
      transfer.status = 'cancelled';
      return;
    }
    transfer.status = 'active';
    this.emit({ kind: 'state', transfer: { ...transfer } });
    let completedBytes = 0;
    for (const job of entry.jobs) {
      if (entry.cancelled) break;
      try {
        const service = await this.getService(transfer.sessionId);
        const bytes = await this.copy(service, entry, job, completedBytes);
        // Destroyed streams emit 'close' without an error, so a cancel that
        // races the final flush resolves instead of rejecting: treat the
        // current file as partial output and remove it.
        if (entry.cancelled) {
          await this.removePartial(transfer, job);
          transfer.status = 'cancelled';
          return;
        }
        completedBytes += bytes;
      } catch (error) {
        await this.removePartial(transfer, job);
        if (entry.cancelled || isCancelledError(error)) {
          transfer.status = 'cancelled';
          return;
        }
        transfer.status = 'failed';
        transfer.error = error instanceof Error ? error.message : String(error);
        return;
      }
    }
    if (entry.cancelled) {
      transfer.status = 'cancelled';
      return;
    }
    transfer.transferredBytes = completedBytes;
    transfer.status = 'completed';
  }

  private async removePartial(transfer: SftpTransfer, job: FileJob): Promise<void> {
    try {
      if (transfer.direction === 'upload') {
        const service = await this.getService(transfer.sessionId).catch(() => undefined);
        await service?.remove(job.remotePath);
      } else {
        await fs.rm(job.localPath, { force: true });
      }
    } catch {
      // best-effort cleanup of partial output
    }
  }

  private copy(
    service: SftpService,
    entry: GroupEntry,
    job: FileJob,
    baseBytes: number
  ): Promise<number> {
    const { transfer } = entry;
    return new Promise<number>((resolve, reject) => {
      const source =
        transfer.direction === 'upload'
          ? createReadStream(job.localPath)
          : service.createRemoteReadStream(job.remotePath);
      const target =
        transfer.direction === 'upload'
          ? service.createRemoteWriteStream(job.remotePath)
          : createWriteStream(job.localPath);
      entry.source = source;
      entry.target = target;
      if (entry.cancelled) {
        source.destroy();
        target.destroy();
        reject(new Error('__cancelled__'));
        return;
      }
      let settled = false;
      let childBytes = 0;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const succeed = (): void => {
        if (settled) return;
        settled = true;
        resolve(childBytes);
      };
      let lastEmit = 0;
      source.on('data', (chunk: Buffer) => {
        childBytes += chunk.length;
        transfer.transferredBytes = baseBytes + childBytes;
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
