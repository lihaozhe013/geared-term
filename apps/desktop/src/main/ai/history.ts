import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type HistoryMessage = { role: 'user' | 'assistant'; content: string };

export type HistoryEntryInput = {
  id?: string;
  title: string;
  model?: string;
  messages: HistoryMessage[];
};

export type HistorySummary = {
  id: string;
  title: string;
  model?: string;
  updatedAt: string;
  messageCount: number;
};

export type HistoryRecord = HistorySummary & { messages: HistoryMessage[] };

type HistoryMetadata = {
  schemaVersion: 1;
  id: string;
  title: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
};

const metadataPattern = /<!-- geared-term-history\n([\s\S]*?)\n-->/u;
const sectionPattern = /\n## (user|assistant)\n\n/u;

/**
 * Human-readable Markdown conversation history (AI-020): a metadata comment
 * header followed by one "## role" section per message. Loading while the
 * file is being rewritten is safe because writes are atomic replacements.
 */
export class AiHistoryStore {
  private directory: string;

  public constructor(rootDirectory: string, directoryName = 'ai-history') {
    this.directory = join(rootDirectory, directoryName);
  }

  public async save(entry: HistoryEntryInput): Promise<HistorySummary> {
    const id = entry.id && /^[A-Za-z0-9._-]+$/.test(entry.id) ? entry.id : randomUUID();
    mkdirSync(this.directory, { recursive: true });
    const now = new Date().toISOString();
    const existing = await this.load(id).catch(() => undefined);
    const metadata: HistoryMetadata = {
      schemaVersion: 1,
      id,
      title: entry.title.slice(0, 200),
      model: entry.model,
      createdAt: existing?.updatedAt ?? now,
      updatedAt: now
    };
    const document = [
      `<!-- geared-term-history\n${JSON.stringify(metadata, null, 2)}\n-->`,
      '',
      ...entry.messages.map(
        (message) => `## ${message.role}\n\n${message.content.replace(/\n+$/u, '')}\n`
      )
    ].join('\n');
    await writeFile(join(this.directory, `${id}.md`), document, {
      encoding: 'utf8',
      mode: 0o600
    });
    return {
      id,
      title: metadata.title,
      model: metadata.model,
      updatedAt: now,
      messageCount: entry.messages.length
    };
  }

  public async list(): Promise<HistorySummary[]> {
    if (!existsSync(this.directory)) return [];
    const files = await readdir(this.directory);
    const summaries: HistorySummary[] = [];
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const record = await this.parseFile(join(this.directory, file)).catch(() => undefined);
      if (record) {
        summaries.push({
          id: record.id,
          title: record.title,
          model: record.model,
          updatedAt: record.updatedAt,
          messageCount: record.messages.length
        });
      }
    }
    return summaries.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
  }

  public async load(id: string): Promise<HistoryRecord | undefined> {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return undefined;
    const path = join(this.directory, `${id}.md`);
    if (!existsSync(path)) return undefined;
    return this.parseFile(path);
  }

  public async remove(id: string): Promise<void> {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return;
    await unlink(join(this.directory, `${id}.md`)).catch(() => undefined);
  }

  public get path(): string {
    return this.directory;
  }

  private async parseFile(path: string): Promise<HistoryRecord | undefined> {
    const text = await readFile(path, 'utf8');
    const metadataMatch = metadataPattern.exec(text);
    if (!metadataMatch) return undefined;
    let metadata: HistoryMetadata;
    try {
      metadata = JSON.parse(metadataMatch[1] as string) as HistoryMetadata;
    } catch {
      return undefined;
    }
    if (metadata.schemaVersion !== 1 || !metadata.id) return undefined;
    const body = text.slice((metadataMatch.index ?? 0) + metadataMatch[0].length);
    const messages: HistoryMessage[] = [];
    const sections = body.split(sectionPattern);
    // split with a capturing group alternates [before, role, content, role, content…]
    for (let index = 1; index < sections.length; index += 2) {
      const role = sections[index] as 'user' | 'assistant';
      const content = (sections[index + 1] ?? '').replace(/\n+$/u, '');
      messages.push({ role, content });
    }
    if (messages.length === 0) return undefined;
    return {
      id: metadata.id,
      title: metadata.title,
      model: metadata.model,
      updatedAt: metadata.updatedAt,
      messageCount: messages.length,
      messages
    };
  }
}
