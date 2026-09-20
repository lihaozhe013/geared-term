import { describe, expect, it } from 'vitest';
import { applyCdSubmission, noteListed, parseCdCommand } from './cd-tracking';

const anchored = {
  home: '/home/dev',
  directory: '/home/dev/projects',
  previous: '/home/dev'
};

describe('parseCdCommand', () => {
  it('detects plain cd with no argument', () => {
    expect(parseCdCommand('cd')).toEqual({ kind: 'home', suffix: null });
  });

  it('detects relative, parent, and absolute forms', () => {
    expect(parseCdCommand('cd src')).toEqual({ kind: 'path', path: 'src' });
    expect(parseCdCommand('cd ..')).toEqual({ kind: 'path', path: '..' });
    expect(parseCdCommand('cd /var/log')).toEqual({ kind: 'path', path: '/var/log' });
  });

  it('decodes quoted arguments with spaces', () => {
    expect(parseCdCommand("cd 'my dir'")).toEqual({ kind: 'path', path: 'my dir' });
    expect(parseCdCommand('cd "my dir"')).toEqual({ kind: 'path', path: 'my dir' });
    expect(parseCdCommand('cd my\\ dir')).toEqual({ kind: 'path', path: 'my dir' });
  });

  it('handles home-relative paths', () => {
    expect(parseCdCommand('cd ~/code')).toEqual({ kind: 'home', suffix: 'code' });
    expect(parseCdCommand('cd ~')).toEqual({ kind: 'home', suffix: null });
  });

  it('marks expansion-based targets unresolvable', () => {
    expect(parseCdCommand('cd $HOME')).toEqual({ kind: 'unresolvable' });
    expect(parseCdCommand('cd "$(pwd)"')).toEqual({ kind: 'unresolvable' });
    expect(parseCdCommand('cd a b')).toEqual({ kind: 'unresolvable' });
  });

  it('ignores commands that are not cd or run inside pipelines', () => {
    expect(parseCdCommand('ls -la')).toBeUndefined();
    expect(parseCdCommand('echo cd')).toBeUndefined();
    expect(parseCdCommand('cd /tmp | cat')).toBeUndefined();
    expect(parseCdCommand('cat x | cd /tmp')).toBeUndefined();
    expect(parseCdCommand('cd /tmp &')).toBeUndefined();
  });

  it('follows the last cd in chained commands', () => {
    expect(parseCdCommand('cd /tmp && cd /var')).toEqual({ kind: 'path', path: '/var' });
    expect(parseCdCommand('cd /tmp; echo done')).toEqual({ kind: 'path', path: '/tmp' });
  });
});

describe('applyCdSubmission', () => {
  it('resolves relative paths from the tracked directory', () => {
    const { effect } = applyCdSubmission(anchored, 'cd api');
    expect(effect).toEqual({ kind: 'move', directory: '/home/dev/projects/api' });
  });

  it('resolves parent changes', () => {
    const { effect } = applyCdSubmission(anchored, 'cd ..');
    expect(effect).toEqual({ kind: 'move', directory: '/home/dev' });
  });

  it('resolves home and previous', () => {
    expect(applyCdSubmission(anchored, 'cd').effect).toEqual({
      kind: 'move',
      directory: '/home/dev'
    });
    expect(applyCdSubmission(anchored, 'cd -').effect).toEqual({
      kind: 'move',
      directory: '/home/dev'
    });
  });

  it('replaces absolute targets', () => {
    const { effect } = applyCdSubmission(anchored, 'cd /etc');
    expect(effect).toEqual({ kind: 'move', directory: '/etc' });
  });

  it('reports unresolvable changes as sync loss', () => {
    const { state, effect } = applyCdSubmission(anchored, 'cd $HOME');
    expect(effect).toEqual({ kind: 'unsynced' });
    expect(state.previous).toBe('/home/dev/projects');
  });

  it('keeps the previous directory for cd - after a move', () => {
    const moved = applyCdSubmission(anchored, 'cd api');
    expect(moved.state.previous).toBe('/home/dev/projects');
    const back = applyCdSubmission(moved.state, 'cd -');
    expect(back.effect).toEqual({ kind: 'move', directory: '/home/dev/projects' });
  });

  it('leaves state untouched for non-cd input', () => {
    const result = applyCdSubmission(anchored, 'git status');
    expect(result).toEqual({ state: anchored, effect: { kind: 'unchanged' } });
  });
});

describe('noteListed', () => {
  it('captures the home from the first authoritative listing', () => {
    const next = noteListed({ home: null, directory: '.', previous: null }, '/home/dev');
    expect(next.home).toBe('/home/dev');
    expect(next.directory).toBe('/home/dev');
  });

  it('re-anchors later listings without touching home', () => {
    const next = noteListed(anchored, '/srv/data');
    expect(next).toEqual({ ...anchored, directory: '/srv/data' });
  });
});
