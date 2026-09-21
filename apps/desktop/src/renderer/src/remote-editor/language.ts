import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';

export type RemoteEditorLanguage = 'json' | 'yaml' | 'shell' | 'properties' | 'toml' | 'plain';

const extensions: Record<Exclude<RemoteEditorLanguage, 'plain'>, Extension> = {
  json: json(),
  yaml: yaml(),
  shell: StreamLanguage.define(shell),
  properties: StreamLanguage.define(properties),
  toml: StreamLanguage.define(toml)
};

export function remoteEditorLanguage(name: string): RemoteEditorLanguage {
  const normalized = name.toLowerCase();
  const filename = normalized.replace(/^.*[\\/]/u, '');
  if (filename.endsWith('.json') || filename.endsWith('.jsonc')) return 'json';
  if (filename.endsWith('.yaml') || filename.endsWith('.yml')) return 'yaml';
  if (
    filename.endsWith('.sh') ||
    filename.endsWith('.bash') ||
    filename.endsWith('.zsh') ||
    filename.endsWith('.ksh') ||
    filename === '.bashrc' ||
    filename === '.zshrc' ||
    filename === '.profile' ||
    filename === '.envrc'
  ) {
    return 'shell';
  }
  if (filename.endsWith('.toml')) return 'toml';
  if (
    filename.endsWith('.ini') ||
    filename.endsWith('.cfg') ||
    filename.endsWith('.conf') ||
    filename.endsWith('.properties') ||
    filename === '.env' ||
    filename.startsWith('.env.')
  ) {
    return 'properties';
  }
  return 'plain';
}

export function remoteEditorLanguageExtension(name: string): Extension {
  const language = remoteEditorLanguage(name);
  return language === 'plain' ? [] : extensions[language];
}
