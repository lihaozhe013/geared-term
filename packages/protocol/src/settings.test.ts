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
    expect(parsed.defaultAiConnectionId).toBeNull();
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

  it('keeps the default AI connection ID', () => {
    const parsed = SettingsRecordSchema.parse({
      ...baseSettings,
      defaultAiConnectionId: 'connection-primary'
    });
    expect(parsed.defaultAiConnectionId).toBe('connection-primary');
  });
});

describe('SettingsRecordSchema terminal padding', () => {
  it('defaults to the shell inset for records saved before the field existed', () => {
    expect(SettingsRecordSchema.parse(baseSettings).terminalPadding).toBe(8);
  });

  it('accepts integers in range and rejects invalid values', () => {
    expect(
      SettingsRecordSchema.parse({ ...baseSettings, terminalPadding: 12 }).terminalPadding
    ).toBe(12);
    expect(SettingsRecordSchema.safeParse({ ...baseSettings, terminalPadding: 32 }).success).toBe(
      true
    );
    expect(SettingsRecordSchema.safeParse({ ...baseSettings, terminalPadding: 33 }).success).toBe(
      false
    );
    expect(SettingsRecordSchema.safeParse({ ...baseSettings, terminalPadding: -1 }).success).toBe(
      false
    );
    expect(SettingsRecordSchema.safeParse({ ...baseSettings, terminalPadding: 1.5 }).success).toBe(
      false
    );
  });
});
