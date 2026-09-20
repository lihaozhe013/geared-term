import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logging';

describe('log redaction', () => {
  it('redacts secrets in structured details and plain key=value strings', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'geared-logging-'));
    const logger = createLogger(directory);
    logger.warn('ssh', 'authentication failed', { password: 'hunter2', apiKey: 'abc123' });
    logger.warn('assistant', 'upstream rejected', { header: 'authorization=Bearer tok-12345' });
    logger.info('system', 'plain message', { host: 'example.com', port: 22 });

    const summary = await fs.readFile(join(directory, 'debug.log'), 'utf8');
    expect(summary).not.toContain('hunter2');
    expect(summary).not.toContain('abc123');
    expect(summary).not.toContain('tok-12345');
    expect(summary).toContain('[REDACTED]');

    const sshLog = await fs.readFile(join(directory, 'debug-ssh.log'), 'utf8');
    expect(sshLog).toContain('[REDACTED]');

    const systemLog = await fs.readFile(join(directory, 'debug-system.log'), 'utf8');
    expect(systemLog).toContain('plain message');
    expect(systemLog).toContain('example.com');
  });

  it('keeps assistant lifecycle metadata while excluding request content', async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), 'geared-assistant-logging-'));
    const logger = createLogger(directory);
    logger.info('assistant', 'AI request prepared', {
      connectionId: 'connection-1',
      model: 'model',
      protocol: 'responses',
      messageCount: 4,
      categories: ['system-prompt', 'terminal-snapshot'],
      inputBytes: 512,
      snapshotAttached: true
    });
    logger.info('assistant', 'AI request completed', {
      durationMs: 120,
      httpStatus: 200,
      inputTokens: 12,
      outputTokens: 8,
      reasoningTokens: 3,
      sourceCount: 2
    });
    const assistantLog = await fs.readFile(join(directory, 'debug-assistant.log'), 'utf8');
    expect(assistantLog).toContain('messageCount');
    expect(assistantLog).toContain('httpStatus');
    expect(assistantLog).toContain('sourceCount');
    expect(assistantLog).not.toContain('secret terminal output');
    expect(assistantLog).not.toContain('user prompt');
  });
});
