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
});
