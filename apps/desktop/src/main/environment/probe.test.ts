import { describe, expect, it } from 'vitest';
import { buildProbeInvocation, parseProbeOutput } from './probe';

describe('environment probes', () => {
  it('parses only bounded known fact fields and ignores banner noise', () => {
    expect(
      parseProbeOutput(
        'Welcome to the host\n' +
          'os=Linux\n' +
          'distribution=Ubuntu\n' +
          'kernel=6.8.0\n' +
          'unknown=ignored\n' +
          'hostname=devbox\n'
      )
    ).toEqual({
      os: 'Linux',
      distribution: 'Ubuntu',
      kernel: '6.8.0',
      hostname: 'devbox'
    });
  });

  it('builds direct, non-shell WSL invocations with an explicit distribution', () => {
    expect(buildProbeInvocation('wsl', 'win32', 'Ubuntu-24.04')).toMatchObject({
      command: 'wsl.exe',
      args: expect.arrayContaining(['--distribution', 'Ubuntu-24.04', '--exec', 'sh', '-c'])
    });
    expect(() => buildProbeInvocation('wsl', 'linux', 'Ubuntu')).toThrow('Windows');
  });

  it('uses a non-interactive POSIX shell for local probes', () => {
    expect(buildProbeInvocation('local', 'linux')).toEqual({
      command: 'sh',
      args: ['-c', expect.any(String)]
    });
    expect(buildProbeInvocation('local', 'linux', undefined, '/bin/zsh')).toEqual({
      command: '/bin/zsh',
      args: ['-c', expect.any(String)]
    });
  });

  it('uses the requested PowerShell executable for Windows local probes', () => {
    expect(buildProbeInvocation('local', 'win32', undefined, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toEqual({
      command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', expect.any(String)]
    });
  });
});
