import { describe, expect, it, vi } from 'vitest';
import { fetchNightlyRelease, parseNightlyRelease } from './update-release';

const sha = '0123456789abcdef0123456789abcdef01234567';

describe('nightly update metadata', () => {
  it('reads the full commit SHA and detects the supported Windows installer', () => {
    expect(
      parseNightlyRelease({
        body: `Automated nightly build for commit ${sha}.`,
        html_url: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
        assets: [{ name: 'geared-term-windows-x64-setup.exe' }]
      })
    ).toEqual({
      commitSha: sha,
      htmlUrl: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
      hasWindowsInstaller: true
    });
  });

  it('rejects a release body without a full commit SHA', () => {
    expect(() =>
      parseNightlyRelease({
        body: 'Automated nightly build without commit metadata.',
        html_url: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
        assets: []
      })
    ).toThrow('Nightly release does not contain a full commit SHA');
  });

  it('rejects failed GitHub responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('rate limited', { status: 403 }));

    await expect(fetchNightlyRelease(fetcher)).rejects.toThrow('GitHub returned HTTP 403');
  });

  it('falls back to manual download when the release has no NSIS asset', () => {
    const release = parseNightlyRelease({
      body: `Automated nightly build for commit ${sha}.`,
      html_url: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
      assets: [{ name: 'geared-term-windows-x64-portable.exe' }]
    });

    expect(release.hasWindowsInstaller).toBe(false);
  });
});
