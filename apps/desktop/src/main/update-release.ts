import { z } from 'zod';

const repository = 'lihaozhe013/geared-term';
const releaseApiUrl = `https://api.github.com/repos/${repository}/releases/tags/nightly`;

const NightlyReleaseSchema = z.object({
  body: z.string().max(100_000),
  html_url: z.string().url().max(2048),
  assets: z.array(z.object({ name: z.string().max(255) })).max(1000)
});

export interface NightlyRelease {
  commitSha: string;
  htmlUrl: string;
  hasWindowsInstaller: boolean;
}

export function parseNightlyRelease(input: unknown): NightlyRelease {
  const release = NightlyReleaseSchema.parse(input);
  const commit = release.body.match(/commit\s+([a-f0-9]{40})\b/i)?.[1]?.toLowerCase();
  if (!commit) throw new Error('Nightly release does not contain a full commit SHA');
  return {
    commitSha: commit,
    htmlUrl: release.html_url,
    hasWindowsInstaller: release.assets.some(
      (asset) => asset.name === 'geared-term-windows-x64-setup.exe'
    )
  };
}

export async function fetchNightlyRelease(
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<NightlyRelease> {
  const response = await fetcher(releaseApiUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    cache: 'no-store',
    signal
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  return parseNightlyRelease(await response.json());
}
