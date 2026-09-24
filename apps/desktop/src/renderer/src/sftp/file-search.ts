import type { LocalEntry, SftpRemoteEntry } from '@geared-term/protocol';
import { rankFuzzyItems } from '../fuzzy-search';

type FileEntry = LocalEntry | SftpRemoteEntry;

export function searchFileEntries<T extends FileEntry>(entries: readonly T[], query: string): T[] {
  return rankFuzzyItems(entries, query, (entry) => entry.name);
}

export function visibleSelectedPaths<T extends FileEntry>(
  entries: readonly T[],
  selected: ReadonlySet<string>
): string[] {
  return entries.filter((entry) => selected.has(entry.path)).map((entry) => entry.path);
}
