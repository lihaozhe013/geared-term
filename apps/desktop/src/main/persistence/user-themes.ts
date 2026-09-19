import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { UserThemeSchema, type InvalidThemeFile, type UserTheme } from '@geared-term/protocol';

export type UserThemeList = {
  themes: UserTheme[];
  invalid: InvalidThemeFile[];
};

/**
 * Loads user theme JSON files from the documented themes directory. A missing
 * directory is an empty result; an invalid file is isolated and reported so a
 * single bad theme can never block startup or hide the valid ones.
 */
export async function loadUserThemes(directory: string): Promise<UserThemeList> {
  let names: string[];
  try {
    names = (await fs.readdir(directory)).filter((name) => name.toLowerCase().endsWith('.json'));
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return { themes: [], invalid: [] };
    throw error;
  }
  const themes: UserTheme[] = [];
  const invalid: InvalidThemeFile[] = [];
  for (const name of names.sort()) {
    const path = join(directory, name);
    try {
      const raw = JSON.parse(await fs.readFile(path, 'utf8')) as unknown;
      const parsed = UserThemeSchema.safeParse(raw);
      if (parsed.success) {
        if (!themes.some((theme) => theme.name === parsed.data.name)) themes.push(parsed.data);
      } else {
        invalid.push({
          file: name,
          error: parsed.error.issues[0]?.message ?? 'Invalid theme file'
        });
      }
    } catch (error) {
      invalid.push({
        file: name,
        error: error instanceof Error ? `Malformed JSON: ${error.message}` : 'Malformed JSON'
      });
    }
  }
  return { themes, invalid };
}
