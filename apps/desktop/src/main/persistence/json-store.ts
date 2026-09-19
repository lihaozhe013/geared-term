import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { z } from 'zod';

export type StoreLoadResult<T> = {
  value: T;
  recovered: boolean;
  source: 'primary' | 'backup' | 'default';
};

export class VersionedJsonStore<T> {
  public constructor(
    private readonly path: string,
    private readonly schema: z.ZodType<T>,
    private readonly fallback: T
  ) {}

  public async load(): Promise<StoreLoadResult<T>> {
    const primary = await this.readAndValidate(this.path);
    if (primary) {
      return { value: primary, recovered: false, source: 'primary' };
    }

    const backup = await this.readAndValidate(`${this.path}.previous.json`);
    if (backup) {
      return { value: backup, recovered: true, source: 'backup' };
    }

    return { value: this.fallback, recovered: true, source: 'default' };
  }

  public async save(value: T): Promise<void> {
    const validated = this.schema.parse(value);
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    try {
      if (await this.exists(this.path)) {
        await this.replaceBackup();
      }
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async readAndValidate(path: string): Promise<T | undefined> {
    try {
      const text = await readFile(path, 'utf8');
      const parsed: unknown = JSON.parse(text);
      const result = this.schema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      await this.quarantine(path);
      return undefined;
    } catch {
      await this.quarantine(path);
      return undefined;
    }
  }

  private async quarantine(path: string): Promise<void> {
    if (!(await this.exists(path))) {
      return;
    }
    await rename(path, `${path}.corrupt-${Date.now()}.json`).catch(() => undefined);
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private async replaceBackup(): Promise<void> {
    const backup = `${this.path}.previous.json`;
    await unlink(backup).catch(() => undefined);
    await rename(this.path, backup);
  }
}
