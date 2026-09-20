import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AiHistoryMessageSchema } from '@geared-term/protocol';
import type {
  AiContinuationMetadata,
  AiSourceReference,
  AiSnapshotAttachment
} from '@geared-term/protocol';

export type HistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
  };
  snapshot?: AiSnapshotAttachment;
  sources?: AiSourceReference[];
  continuation?: AiContinuationMetadata;
};

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
  schemaVersion: 1 | 2;
  id: string;
  title: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
};

const metadataPattern = /<!-- geared-term-history\n([\s\S]*?)\n-->/u;
const sectionPattern = /\n## (user|assistant)\n\n/u;
const messageMetadataPattern =
  /^<!-- geared-term-message-base64\n([A-Za-z0-9+/=\r\n]+)\n-->\n*/u;

/**
 * Human-readable Markdown conversation history (AI-020): a metadata comment
 * header followed by one "## role" section per message. Loading while the
 * file is being rewritten is safe because writes are atomic replacements.
 */
export class AiHistoryStore {
  private directory: string;
  private lastUpdatedAt = 0;

  public constructor(rootDirectory: string, directoryName = 'ai-history') {
    this.directory = join(rootDirectory, directoryName);
  }

  public async save(entry: HistoryEntryInput): Promise<HistorySummary> {
    const id = entry.id && /^[A-Za-z0-9._-]+$/.test(entry.id) ? entry.id : randomUUID();
    mkdirSync(this.directory, { recursive: true });
    const existing = await this.load(id).catch(() => undefined);
    const clock = Date.now();
    const previousTime = existing ? Date.parse(existing.updatedAt) : Number.NaN;
    const timestamp = Math.max(
      clock,
      this.lastUpdatedAt + 1,
      Number.isFinite(previousTime) ? previousTime + 1 : 0
    );
    this.lastUpdatedAt = timestamp;
    const now = new Date(timestamp).toISOString();
    const metadata: HistoryMetadata = {
      schemaVersion: 2,
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
        (message) => {
          const messageMetadata = {
            ...(message.reasoning !== undefined ? { reasoning: message.reasoning } : {}),
            ...(message.usage ? { usage: message.usage } : {}),
            ...(message.snapshot ? { snapshot: message.snapshot } : {}),
            ...(message.sources ? { sources: message.sources } : {}),
            ...(message.continuation ? { continuation: message.continuation } : {})
          };
          const metadataComment =
            Object.keys(messageMetadata).length === 0
              ? ''
              : `<!-- geared-term-message-base64\n${Buffer.from(
                  JSON.stringify(messageMetadata),
                  'utf8'
                ).toString('base64')}\n-->\n\n`;
          return `## ${message.role}\n\n${metadataComment}${message.content.replace(/\n+$/u, '')}\n`;
        }
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

  public async clear(): Promise<number> {
    if (!existsSync(this.directory)) return 0;
    const files = await readdir(this.directory);
    let removed = 0;
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      await unlink(join(this.directory, file)).catch(() => undefined);
      removed += 1;
    }
    return removed;
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
    if (![1, 2].includes(metadata.schemaVersion) || !metadata.id) return undefined;
    const body = text.slice((metadataMatch.index ?? 0) + metadataMatch[0].length);
    const messages: HistoryMessage[] = [];
    const sections = body.split(sectionPattern);
    // split with a capturing group alternates [before, role, content, role, content…]
    for (let index = 1; index < sections.length; index += 2) {
      const role = sections[index] as 'user' | 'assistant';
      let content = sections[index + 1] ?? '';
      let messageMetadata: Partial<Omit<HistoryMessage, 'role' | 'content'>> = {};
      const metadataMatch = messageMetadataPattern.exec(content);
      if (metadataMatch) {
        try {
          const decoded = Buffer.from(metadataMatch[1] as string, 'base64').toString('utf8');
          const parsed = JSON.parse(decoded) as unknown;
          const candidateContent = content.slice(metadataMatch[0].length);
          const candidate =
            parsed && typeof parsed === 'object'
              ? AiHistoryMessageSchema.safeParse({
                  role,
                  content: candidateContent.replace(/\n+$/u, ''),
                  ...(parsed as Record<string, unknown>)
                })
              : undefined;
          if (candidate?.success) {
            const { role: _role, content: _content, ...metadata } = candidate.data;
            messageMetadata = metadata;
            content = candidateContent;
          }
        } catch {
          // Keep the message content readable if optional metadata is corrupt.
        }
      }
      messages.push({
        role,
        content: content.replace(/\n+$/u, ''),
        ...messageMetadata
      });
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
