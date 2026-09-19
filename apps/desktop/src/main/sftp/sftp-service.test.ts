import { describe, expect, it } from 'vitest';
import { remoteChildPath } from './sftp-service';

describe('SFTP path handling', () => {
  it('joins remote entries without allowing nested names', () => {
    expect(remoteChildPath('/home/alice', 'notes.txt')).toBe('/home/alice/notes.txt');
    expect(() => remoteChildPath('/home/alice', '../escape')).toThrow('unsupported path');
    expect(() => remoteChildPath('/home/alice', 'a/b')).toThrow('unsupported path');
  });
});
