import { describe, expect, it } from 'vitest';
import { isBareSpaceKeydown } from './space-guard';

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    type: 'keydown',
    key: ' ',
    keyCode: 32,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    ...overrides
  } as unknown as KeyboardEvent;
}

describe('isBareSpaceKeydown', () => {
  it('matches a plain space keydown', () => {
    expect(isBareSpaceKeydown(keyEvent())).toBe(true);
  });

  it('matches space with shift held (no remap needed)', () => {
    expect(isBareSpaceKeydown(keyEvent({ shiftKey: true }))).toBe(true);
  });

  it('ignores keyup and keypress deliveries', () => {
    expect(isBareSpaceKeydown(keyEvent({ type: 'keyup' }))).toBe(false);
    expect(isBareSpaceKeydown(keyEvent({ type: 'keypress' }))).toBe(false);
  });

  it('ignores modified space so shortcut composition is untouched', () => {
    expect(isBareSpaceKeydown(keyEvent({ ctrlKey: true }))).toBe(false);
    expect(isBareSpaceKeydown(keyEvent({ altKey: true }))).toBe(false);
    expect(isBareSpaceKeydown(keyEvent({ metaKey: true }))).toBe(false);
  });

  it('ignores keys other than space', () => {
    expect(isBareSpaceKeydown(keyEvent({ key: 'a', keyCode: 65 }))).toBe(false);
  });

  it('defers to the IME while a composition is active or keyCode is 229', () => {
    expect(isBareSpaceKeydown(keyEvent({ isComposing: true }))).toBe(false);
    expect(isBareSpaceKeydown(keyEvent({ keyCode: 229 }))).toBe(false);
  });
});
