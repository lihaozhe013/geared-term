import { describe, expect, it } from 'vitest';
import { SettingsRecordSchema } from './index';

const baseSettings = {
  schemaVersion: 1,
  language: 'en-US',
  theme: 'Catppuccin Mocha',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalCursor: 'bar',
  defaultTerm: 'xterm-256color',
  splitCommandPresentation: true,
  terminalContextPrecedingLines: 100
};

describe('SettingsRecordSchema keybindings', () => {
  it('defaults keybindings for records persisted before the field existed', () => {
    const parsed = SettingsRecordSchema.parse(baseSettings);
    expect(parsed.keybindings).toEqual({});
  });

  it('keeps persisted overrides and rejects malformed values', () => {
    const parsed = SettingsRecordSchema.parse({
      ...baseSettings,
      keybindings: { 'terminal.copy': 'ctrl+alt+c' }
    });
    expect(parsed.keybindings).toEqual({ 'terminal.copy': 'ctrl+alt+c' });

    expect(
      SettingsRecordSchema.safeParse({ ...baseSettings, keybindings: { 'terminal.copy': 42 } })
        .success
    ).toBe(false);
    expect(
      SettingsRecordSchema.safeParse({ ...baseSettings, keybindings: { '': 'ctrl+c' } }).success
    ).toBe(false);
  });
});
