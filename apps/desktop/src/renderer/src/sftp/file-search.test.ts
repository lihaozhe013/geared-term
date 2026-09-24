import { describe, expect, it } from 'vitest';
import type { LocalEntry, SftpRemoteEntry } from '@geared-term/protocol';
import { searchFileEntries, visibleSelectedPaths } from './file-search';

const local = (name: string, path = `/local/${name}`): LocalEntry => ({
  name,
  path,
  kind: 'file',
  size: 1,
  modifiedAt: null,
  permissions: 'rw-r--r--',
  guarded: false
});

const remote = (name: string, path = `/remote/${name}`): SftpRemoteEntry => ({
  name,
  path,
  longName: name,
  kind: 'file',
  size: 1,
  modifiedAt: null
});

describe('file search', () => {
  it('matches only names and preserves distinct entries with duplicate names', () => {
    const entries = [local('readme'), local('README', '/other/README'), local('notes')];
    expect(searchFileEntries(entries, 'readme')).toEqual([entries[0], entries[1]]);
  });

  it('works with remote entries and returns visible selected paths in display order', () => {
    const entries = [remote('report-old'), remote('report'), remote('notes')];
    const matches = searchFileEntries(entries, 'report');
    expect(matches).toEqual([entries[1], entries[0]]);
    expect(visibleSelectedPaths(matches, new Set(['/remote/notes', '/remote/report-old']))).toEqual(
      ['/remote/report-old']
    );
  });
});
