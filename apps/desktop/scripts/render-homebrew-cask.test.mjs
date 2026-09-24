import { describe, expect, it } from 'vitest';
import { dmgArtifactName, parseDmgArtifactName, renderCask } from './render-homebrew-cask.mjs';

const sha256 = 'a1'.repeat(32);
const repository = 'lihaozhe013/geared-term';

function render(overrides = {}) {
  return renderCask({
    version: '0.1.1-beta.23',
    sha256,
    repository,
    tag: 'nightly',
    arch: 'arm64',
    ...overrides
  });
}

describe('Homebrew cask rendering', () => {
  it('pins the nightly artifact by version and checksum', () => {
    const cask = render();

    expect(cask).toContain('cask "geared-term" do');
    expect(cask).toContain('version "0.1.1-beta.23"');
    expect(cask).toContain(`sha256 "${sha256}"`);
    expect(cask).toContain('# Rendered by the geared-term nightly workflow');
    expect(cask).toContain(
      'url "https://github.com/lihaozhe013/geared-term/releases/download/nightly/geared-term-mac-arm64-#{version}.dmg"'
    );
    expect(cask).toContain('app "Geared Term.app"');
    expect(cask).toContain('depends_on arch: :arm64');
    expect(cask).toContain('depends_on macos: :ventura');
    expect(cask).toContain('zap trash: [');
    expect(cask).toContain('Privacy &');
    expect(cask.trimEnd().endsWith('end')).toBe(true);
  });

  it('maps the Intel artifact to the Intel dependency', () => {
    const cask = render({ arch: 'x64', version: '1.2.3' });

    expect(cask).toContain('depends_on arch: :intel');
    expect(cask).toContain('geared-term-mac-x64-#{version}.dmg');
  });

  it('targets the rolling nightly asset when the release renames it', () => {
    const cask = render({ artifact: 'geared-term-macos-arm64.dmg' });

    expect(cask).toContain('version "0.1.1-beta.23"');
    expect(cask).toContain(
      'url "https://github.com/lihaozhe013/geared-term/releases/download/nightly/geared-term-macos-arm64.dmg"'
    );
  });

  it('rejects versions and checksums that cannot be attributed to an artifact', () => {
    expect(() => render({ version: 'latest' })).toThrow(/version/u);
    expect(() => render({ version: '0.1.1-beta.23; rm -rf /' })).toThrow(/version/u);
    expect(() => render({ sha256: 'deadbeef' })).toThrow(/SHA-256/u);
    expect(() => render({ repository: 'example.com/evil' })).toThrow(/repository/u);
    expect(() => render({ tag: 'nightly/../../x' })).toThrow(/tag/u);
  });

  it('rejects asset names that are not published by the release pipeline', () => {
    expect(() => render({ artifact: 'other.dmg' })).toThrow(/asset name/u);
    expect(() => render({ artifact: 'geared-term.dmg"; system "x' })).toThrow(/asset name/u);
    expect(() => render({ arch: 'x64', artifact: 'geared-term-mac-arm64-#{version}.dmg' })).toThrow(
      /asset name/u
    );
  });

  it('reads architecture and version from the packaged artifact name', () => {
    expect(parseDmgArtifactName('staging/geared-term-mac-arm64-0.1.1-beta.23.dmg')).toEqual({
      arch: 'arm64',
      version: '0.1.1-beta.23'
    });
    expect(dmgArtifactName('arm64', '0.1.1-beta.23')).toBe(
      'geared-term-mac-arm64-0.1.1-beta.23.dmg'
    );
    expect(() => parseDmgArtifactName('geared-term-linux-x64.AppImage')).toThrow(/macOS DMG/u);
  });
});
