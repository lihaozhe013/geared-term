import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const defaultRepository = 'lihaozhe013/geared-term';
const defaultTag = 'nightly';
const defaultArch = 'arm64';
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-beta\.[0-9]+)?$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const artifactPattern = /^geared-term-mac-(arm64|x64)-(.+)\.dmg$/u;

export function dmgArtifactName(arch, version) {
  return `geared-term-mac-${arch}-${version}.dmg`;
}

export function parseDmgArtifactName(name) {
  const match = artifactPattern.exec(basename(name));
  if (!match) throw new Error(`Not a Geared Term macOS DMG artifact: ${name}`);
  return { arch: match[1], version: match[2] };
}

export function renderCask({ version, sha256, repository, tag, arch, artifact }) {
  if (!versionPattern.test(version)) throw new Error(`Unsupported cask version: ${version}`);
  if (!sha256Pattern.test(sha256))
    throw new Error('Cask checksum must be a lowercase SHA-256 digest');
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u.test(repository)) {
    throw new Error(`Unsupported repository: ${repository}`);
  }
  if (!/^[\w.-]+$/u.test(tag)) throw new Error(`Unsupported release tag: ${tag}`);
  if (arch !== 'arm64' && arch !== 'x64')
    throw new Error(`Unsupported macOS architecture: ${arch}`);
  const interpolatedName = `geared-term-mac-${arch}-#{version}.dmg`;
  const assetName = artifact ?? interpolatedName;
  // The asset name is interpolated into Ruby that Homebrew evaluates, so only the two shapes the
  // release pipeline publishes are accepted.
  if (assetName !== interpolatedName && !/^geared-term-[a-z0-9-]+\.dmg$/u.test(assetName)) {
    throw new Error(`Unsupported release asset name: ${assetName}`);
  }
  return `cask "geared-term" do
  version "${version}"
  # Rendered by the geared-term nightly workflow; the URL pins the immutable versioned DMG so the
  # checksum cannot drift while the rolling release is replaced.
  sha256 "${sha256}"

  url "https://github.com/${repository}/releases/download/${tag}/${assetName}"
  name "Geared Term"
  desc "Secure terminal workspace with local PTY, SSH, SFTP, and an AI assistant"
  homepage "https://github.com/${repository}"

  depends_on arch: :${arch === 'arm64' ? 'arm64' : 'intel'}
  depends_on macos: :ventura

  app "Geared Term.app"

  zap trash: [
    "~/Library/Application Support/Geared Term",
    "~/Library/Caches/dev.gearedterm.desktop",
    "~/Library/HTTPStorages/dev.gearedterm.desktop",
    "~/Library/Preferences/dev.gearedterm.desktop.plist",
    "~/Library/Saved Application State/dev.gearedterm.desktop.savedState",
  ]

  caveats <<~EOS
    Nightly builds are unsigned development artifacts. On first launch macOS reports that Apple
    cannot check the app for malicious software; allow it once in System Settings -> Privacy &
    Security -> Open Anyway. The ad-hoc signature changes with every build, so macOS may ask
    again after each upgrade.
  EOS
end
`;
}

export async function renderCaskFromDmg(dmgPath, options = {}) {
  const { arch, version } = parseDmgArtifactName(dmgPath);
  const digest = createHash('sha256')
    .update(await readFile(dmgPath))
    .digest('hex');
  return renderCask({
    version,
    sha256: digest,
    repository: options.repository ?? defaultRepository,
    tag: options.tag ?? defaultTag,
    arch: options.arch ?? arch,
    artifact: options.artifact
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      dmg: { type: 'string' },
      version: { type: 'string' },
      sha256: { type: 'string' },
      repository: { type: 'string', default: defaultRepository },
      tag: { type: 'string', default: defaultTag },
      arch: { type: 'string', default: defaultArch },
      artifact: { type: 'string' },
      out: { type: 'string' }
    }
  });

  const cask = values.dmg
    ? await renderCaskFromDmg(values.dmg, values)
    : renderCask({
        version: values.version,
        sha256: values.sha256,
        repository: values.repository,
        tag: values.tag,
        arch: values.arch,
        artifact: values.artifact
      });

  if (values.out) {
    await writeFile(values.out, cask, 'utf8');
    process.stdout.write(`Rendered Homebrew cask: ${values.out}\n`);
    return;
  }
  process.stdout.write(cask);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
