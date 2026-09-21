import { describe, expect, it } from 'vitest';
import { remoteEditorLanguage } from './language';

describe('remote editor language detection', () => {
  it.each([
    ['settings.json', 'json'],
    ['settings.jsonc', 'json'],
    ['compose.yaml', 'yaml'],
    ['compose.yml', 'yaml'],
    ['deploy.sh', 'shell'],
    ['.zshrc', 'shell'],
    ['/etc/.bashrc', 'shell'],
    ['service.conf', 'properties'],
    ['.env.production', 'properties'],
    ['Cargo.toml', 'toml'],
    ['README.txt', 'plain']
  ] as const)('maps %s to %s', (name, expected) => {
    expect(remoteEditorLanguage(name)).toBe(expected);
  });
});
