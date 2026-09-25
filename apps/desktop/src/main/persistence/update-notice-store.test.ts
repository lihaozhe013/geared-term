import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UpdateNoticeStore } from './update-notice-store';

const commitSha = 'abcdef0123456789abcdef0123456789abcdef01';

describe('UpdateNoticeStore', () => {
  it('persists the dismissed nightly commit across loads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-update-notice-'));
    const store = new UpdateNoticeStore(directory);
    await store.load();

    expect(store.dismissedCommitSha()).toBeUndefined();
    await store.dismiss(commitSha);

    const reloaded = new UpdateNoticeStore(directory);
    await reloaded.load();
    expect(reloaded.dismissedCommitSha()).toBe(commitSha);
    expect(JSON.parse(await readFile(join(directory, 'update-notice.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      dismissedCommitSha: commitSha
    });
  });

  it('rejects malformed commit SHA values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-update-notice-invalid-'));
    const store = new UpdateNoticeStore(directory);
    await store.load();

    await expect(store.dismiss('not-a-sha')).rejects.toThrow();
  });
});
