/**
 * xterm.js transmits every printable key from its keydown handler except
 * space: its keyboard mapping requires `keyCode >= 48`, so plain space is
 * delivered only through the hidden textarea's keypress/default-insertion
 * path. That path silently dies when an IME composition gets stuck in the
 * keyCode 229 state or the keydown default action is suppressed, while
 * keydown-driven keys keep working — producing "space is dead, every other
 * character types". Bare space is detected here so the pane can send it
 * through the same keydown path as every other character.
 */
export function isBareSpaceKeydown(event: KeyboardEvent): boolean {
  return (
    event.type === 'keydown' &&
    event.key === ' ' &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}
