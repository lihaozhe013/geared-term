import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LogCategory = 'app' | 'ssh' | 'terminal' | 'assistant' | 'system';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const maxBytes = 2 * 1024 * 1024;

const SECRET_JSON_PAIR =
  /("(?:authorization|api[_-]?key|password|passphrase|private[_-]?key|token)"\s*:\s*)("[^"]*"|[^,}\s]+)/gi;
const SECRET_KV_PAIR =
  /((?:authorization|api[_-]?key|password|passphrase|private[_-]?key|token)\s*[:=]\s*)([^,}\r\n]+)/gi;

function redact(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  // JSON-shaped details need quote-aware matching; plain key=value strings fall
  // through to the loose pattern.
  return text.replace(SECRET_JSON_PAIR, '$1[REDACTED]').replace(SECRET_KV_PAIR, '$1[REDACTED]');
}

function rotate(path: string): void {
  if (!existsSync(path) || statSync(path).size < maxBytes) {
    return;
  }

  const previous = `${path}.previous.log`;
  try {
    renameSync(path, previous);
  } catch {
    appendFileSync(path, `${new Date().toISOString()} [warn] log rotation failed\n`, 'utf8');
  }
}

export class Logger {
  private readonly logDirectory: string;

  public constructor(directory: string) {
    this.logDirectory = directory;
    mkdirSync(directory, { recursive: true });
  }

  public write(
    category: LogCategory,
    level: LogLevel,
    message: string,
    details?: Record<string, unknown>
  ): void {
    const timestamp = new Date().toISOString();
    const suffix = details ? ` ${redact(details)}` : '';
    const line = `${timestamp} [${level}] ${message}${suffix}\n`;
    const detailPath = join(this.logDirectory, `debug-${category}.log`);
    rotate(detailPath);
    appendFileSync(detailPath, line, 'utf8');

    if (level === 'warn' || level === 'error') {
      const summaryPath = join(this.logDirectory, 'debug.log');
      rotate(summaryPath);
      appendFileSync(summaryPath, `[${category}] ${line}`, 'utf8');
    }
  }

  public debug(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.write(category, 'debug', message, details);
  }

  public info(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.write(category, 'info', message, details);
  }

  public warn(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.write(category, 'warn', message, details);
  }

  public error(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.write(category, 'error', message, details);
  }
}

export function createLogger(directory: string): Logger {
  return new Logger(dirname(join(directory, 'debug.log')));
}
