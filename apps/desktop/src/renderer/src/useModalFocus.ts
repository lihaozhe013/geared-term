import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Contains keyboard focus inside a modal while it is open and returns focus to
 * the previously focused element on close, so keystrokes cannot leak into the
 * terminal behind the dialog.
 */
export function useModalFocus<HTMLElementType extends HTMLElement>(): {
  containerRef: React.RefObject<HTMLElementType | null>;
} {
  const containerRef = useRef<HTMLElementType | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = (): HTMLElement[] =>
      [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );
    const first = focusables()[0];
    (first ?? container).focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        const cancel = container.querySelector<HTMLElement>('[data-modal-cancel]');
        cancel?.click();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const active = document.activeElement;
      const index = items.indexOf(active as HTMLElement);
      if (event.shiftKey && (index <= 0 || active === container)) {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (!event.shiftKey && index === items.length - 1) {
        event.preventDefault();
        items[0]?.focus();
      }
    };
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, []);

  return { containerRef };
}
