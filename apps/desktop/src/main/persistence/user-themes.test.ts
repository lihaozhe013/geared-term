import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadUserThemes } from './user-themes';

async function tempDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'geared-themes-'));
}

describe('loadUserThemes', () => {
  it('returns empty results for a missing directory', async () => {
    const result = await loadUserThemes(join(await tempDirectory(), 'absent'));
    expect(result).toEqual({ themes: [], invalid: [] });
  });

  it('loads valid themes and ignores non-json files', async () => {
    const root = await tempDirectory();
    await writeFile(
      join(root, 'ocean.json'),
      JSON.stringify({
        name: 'Ocean',
        colors: { background: '#101820', foreground: '#e6edf3', cursor: '#7cd6c8' }
      })
    );
    await writeFile(join(root, 'notes.txt'), 'hello');
    const result = await loadUserThemes(root);
    expect(result.themes.map((theme) => theme.name)).toEqual(['Ocean']);
    expect(result.invalid).toEqual([]);
  });

  it('isolates malformed or schema-invalid files without blocking valid ones', async () => {
    const root = await tempDirectory();
    await writeFile(join(root, 'broken.json'), '{ not json');
    await writeFile(
      join(root, 'bad-color.json'),
      JSON.stringify({
        name: 'Bad',
        colors: { background: 'red', foreground: '#ffffff', cursor: '#ffffff' }
      })
    );
    await writeFile(
      join(root, 'good.json'),
      JSON.stringify({
        name: 'Good',
        colors: { background: '#000000', foreground: '#ffffff', cursor: '#ffffff' }
      })
    );
    const result = await loadUserThemes(root);
    expect(result.themes.map((theme) => theme.name)).toEqual(['Good']);
    expect(result.invalid.map((entry) => entry.file).sort()).toEqual([
      'bad-color.json',
      'broken.json'
    ]);
  });

  it('collapses duplicate theme names keeping the first file', async () => {
    const root = await tempDirectory();
    const colors = { background: '#000000', foreground: '#ffffff', cursor: '#ffffff' };
    await writeFile(join(root, 'a.json'), JSON.stringify({ name: 'Dup', colors }));
    await writeFile(
      join(root, 'b.json'),
      JSON.stringify({ name: 'Dup', colors: { ...colors, cursor: '#00ff00' } })
    );
    const result = await loadUserThemes(root);
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0]?.colors.cursor).toBe('#ffffff');
  });

  it('supports overriding by an explicit user file directory listing', async () => {
    const root = join(await tempDirectory(), 'nested');
    await mkdir(root);
    expect(await loadUserThemes(root)).toEqual({ themes: [], invalid: [] });
  });
});
