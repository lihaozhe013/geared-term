import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type WslDistribution = {
  name: string;
  isDefault: boolean;
  state: 'running' | 'stopped' | 'transitional' | 'unknown';
  version: 1 | 2 | null;
};

function decodeWslOutput(value: string | Buffer): string {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  const nulBytes = [...buffer].filter((byte) => byte === 0).length;
  if (nulBytes > buffer.length / 8) {
    return buffer.toString('utf16le');
  }
  return buffer.toString('utf8');
}

function normalizeState(value: string): WslDistribution['state'] {
  const state = value.toLowerCase();
  if (state === 'running') return 'running';
  if (state === 'stopped') return 'stopped';
  if (state.includes('install') || state.includes('uninstall') || state.includes('transition'))
    return 'transitional';
  return 'unknown';
}

export function parseWslList(value: string | Buffer): WslDistribution[] {
  const lines = decodeWslOutput(value)
    .replace(/\u0000/g, '')
    .split(/\r?\n/u);
  const distributions: WslDistribution[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || /^(name|\u540d\u79f0)\s+/iu.test(line)) continue;
    const match = line.match(
      /^(\*)?\s*(.+?)\s+(Running|Stopped|Installing|Uninstalling|Transitioning)\s+([12])\s*$/iu
    );
    if (!match) continue;
    const name = match[2]?.trim();
    if (!name) continue;
    distributions.push({
      name,
      isDefault: Boolean(match[1]),
      state: normalizeState(match[3] ?? ''),
      version: match[4] === '1' ? 1 : 2
    });
  }
  return distributions;
}

export async function discoverWsl(timeoutMs = 10_000): Promise<WslDistribution[]> {
  if (process.platform !== 'win32') return [];
  const result = await execFileAsync('wsl.exe', ['--list', '--verbose'], {
    encoding: 'buffer',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return parseWslList(result.stdout);
}

export function buildWslLaunchArgs(options: {
  distribution: string;
  user?: string;
  cwd?: string;
}): string[] {
  const args = ['--distribution', options.distribution];
  if (options.user?.trim()) args.push('--user', options.user.trim());
  args.push('--cd', options.cwd?.trim() || '~');
  return args;
}
