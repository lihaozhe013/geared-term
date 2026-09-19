import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SettingsSchema, defaultSettings } from './schema';
import { VersionedJsonStore } from './json-store';

describe('versioned JSON store', () => {
  it('writes validated data atomically and recovers the previous version', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-term-store-'));
    const path = join(directory, 'config.json');
    const store = new VersionedJsonStore(path, SettingsSchema, defaultSettings);
    await store.save(defaultSettings);
    await store.save({ ...defaultSettings, terminalFontSize: 16 });
    const primary = JSON.parse(await readFile(path, 'utf8')) as { terminalFontSize: number };
    expect(primary.terminalFontSize).toBe(16);
    const backup = JSON.parse(await readFile(`${path}.previous.json`, 'utf8')) as {
      terminalFontSize: number;
    };
    expect(backup.terminalFontSize).toBe(14);
  });
});
