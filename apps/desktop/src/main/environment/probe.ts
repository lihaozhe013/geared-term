import { spawn } from 'node:child_process';
import { EnvironmentFactsSchema, type EnvironmentFacts } from '@geared-term/protocol';

const maxOutputBytes = 64 * 1024;
const defaultTimeoutMs = 4_000;
export const probeScript =
  'printf \'os=%s\\ndistribution=%s\\nkernel=%s\\narchitecture=%s\\nshell=%s\\nshellVersion=%s\\nuser=%s\\nhostname=%s\\n\' "$(uname -s 2>/dev/null || printf unknown)" "$(awk -F= \'/^PRETTY_NAME=/{gsub(/\\"/, "", $2); print $2}\' /etc/os-release 2>/dev/null | head -n 1)" "$(uname -r 2>/dev/null || printf unknown)" "$(uname -m 2>/dev/null || printf unknown)" "${SHELL:-unknown}" "$( "${SHELL:-sh}" --version 2>/dev/null | head -n 1 || printf unknown)" "$(id -un 2>/dev/null || printf unknown)" "$(hostname 2>/dev/null || printf unknown)"';

const windowsProbeScript = [
  'Write-Output "os=Windows_NT"',
  'Write-Output "distribution=Windows"',
  'Write-Output "kernel=$([System.Environment]::OSVersion.Version)"',
  'Write-Output "architecture=$([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"',
  'Write-Output "shell=$([Environment]::ProcessPath)"',
  'Write-Output "shellVersion=$($PSVersionTable.PSVersion)"',
  'Write-Output "user=$([Environment]::UserName)"',
  'Write-Output "hostname=$([Environment]::MachineName)"'
].join('; ');

const knownKeys = new Set<keyof EnvironmentFacts>([
  'os',
  'distribution',
  'kernel',
  'architecture',
  'shell',
  'shellVersion',
  'user',
  'hostname'
]);

export type ProbeKind = 'local' | 'wsl';

export type ProbeInvocation = {
  command: string;
  args: string[];
  cwd?: string;
  environment?: Record<string, string>;
};

export function buildProbeInvocation(
  kind: ProbeKind,
  platform: NodeJS.Platform,
  distribution?: string,
  shell?: string
): ProbeInvocation {
  if (kind === 'wsl') {
    if (platform !== 'win32') throw new Error('WSL probes are only supported on Windows');
    if (!distribution?.trim()) throw new Error('WSL distribution is required');
    return {
      command: 'wsl.exe',
      args: ['--distribution', distribution.trim(), '--exec', 'sh', '-c', probeScript]
    };
  }
  if (platform === 'win32') {
    if (shell && /(?:^|[\\/])(pwsh|powershell)(?:\.exe)?$/iu.test(shell)) {
      return {
        command: shell,
        args: ['-NoLogo', '-NoProfile', '-Command', windowsProbeScript]
      };
    }
    const command = shell?.trim() || process.env.ComSpec || 'cmd.exe';
    const script = [
      'echo os=Windows_NT',
      'echo distribution=Windows',
      'echo kernel=%OS%',
      'echo architecture=%PROCESSOR_ARCHITECTURE%',
      'echo shell=%GEARED_TERM_PROBE_SHELL%',
      'for /f "tokens=*" %v in (\'ver\') do @echo shellVersion=%v',
      'echo user=%USERNAME%',
      'echo hostname=%COMPUTERNAME%'
    ].join('&');
    return { command, args: ['/d', '/s', '/c', script] };
  }
  return { command: shell?.trim() || 'sh', args: ['-c', probeScript] };
}

export function parseProbeOutput(rawOutput: string): EnvironmentFacts {
  const facts: Record<string, string> = {};
  for (const line of rawOutput.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]{0,31})=(.*)$/);
    if (!match) continue;
    const key = match[1] as keyof EnvironmentFacts;
    if (!knownKeys.has(key)) continue;
    const value = (match[2] ?? '').replace(/\0/g, '').trim();
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) continue;
    facts[key] = value.slice(0, 512);
  }
  return EnvironmentFactsSchema.parse(facts);
}

function runProbe(
  invocation: ProbeInvocation,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      shell: false,
      windowsHide: true,
      cwd: invocation.cwd,
      env: invocation.environment ? { ...process.env, ...invocation.environment } : process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let outputBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Environment probe timed out'));
    }, timeoutMs);
    const finish = (error: Error | null, value?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value ?? '');
    };
    const abort = (): void => {
      child.kill();
      finish(new Error('Environment probe cancelled'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    const trackBytes = (chunk: Buffer | string): boolean => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        child.kill();
        finish(new Error('Environment probe output exceeded its limit'));
        return false;
      }
      return true;
    };
    const accept = (chunk: Buffer | string): void => {
      const text = chunk.toString();
      if (!trackBytes(chunk)) return;
      output += text;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', accept);
    child.stderr.on('data', (chunk) => {
      trackBytes(chunk);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) finish(null, output);
      else finish(new Error(`Environment probe exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function probeEnvironment(
  kind: ProbeKind,
  distribution?: string,
  platform: NodeJS.Platform = process.platform,
  options?: {
    shell?: string;
    cwd?: string;
    environment?: Record<string, string>;
    signal?: AbortSignal;
  }
): Promise<EnvironmentFacts> {
  const invocation = {
    ...buildProbeInvocation(kind, platform, distribution, options?.shell),
    cwd: options?.cwd,
    environment: {
      ...options?.environment,
      ...(kind !== 'wsl' && options?.shell ? { SHELL: options.shell } : {}),
      ...(kind === 'local' && platform === 'win32'
        ? { GEARED_TERM_PROBE_SHELL: options?.shell ?? process.env.ComSpec ?? 'cmd.exe' }
        : {})
    }
  };
  return parseProbeOutput(await runProbe(invocation, defaultTimeoutMs, options?.signal));
}
