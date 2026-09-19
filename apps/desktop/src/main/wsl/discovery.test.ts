import { describe, expect, it } from 'vitest';
import { buildWslLaunchArgs, parseWslList } from './discovery';

describe('WSL discovery parsing', () => {
  it('parses UTF-8 output with spaces in distribution names', () => {
    const result = parseWslList(
      '  NAME                   STATE           VERSION\n* Ubuntu Dev             Running         2\n  Debian                 Stopped         1\n'
    );
    expect(result).toEqual([
      { name: 'Ubuntu Dev', isDefault: true, state: 'running', version: 2 },
      { name: 'Debian', isDefault: false, state: 'stopped', version: 1 }
    ]);
  });

  it('decodes UTF-16LE output and ignores localized noise', () => {
    const value = Buffer.from(
      '\ufeff  NAME  STATE  VERSION\r\n* Ubuntu  Running  2\r\nnoise\r\n',
      'utf16le'
    );
    const result = parseWslList(Buffer.concat([Buffer.from([0xff, 0xfe]), value.subarray(2)]));
    expect(result[0]?.name).toBe('Ubuntu');
  });

  it('keeps launch arguments explicit', () => {
    expect(buildWslLaunchArgs({ distribution: 'Ubuntu Dev', user: 'alice', cwd: '/work' })).toEqual(
      ['--distribution', 'Ubuntu Dev', '--user', 'alice', '--cd', '/work']
    );
  });
});
