import { describe, expect, it } from 'vitest';
import { positionSidebarMenu } from './sidebar-menu-position';

describe('positionSidebarMenu', () => {
  it('prefers opening below the trigger when the menu fits', () => {
    expect(
      positionSidebarMenu(
        { top: 20, bottom: 46, right: 220 },
        { width: 180, height: 120 },
        { width: 800, height: 600 }
      )
    ).toEqual({ left: 40, top: 50, maxHeight: 542, side: 'below' });
  });

  it('flips above when there is not enough room below', () => {
    expect(
      positionSidebarMenu(
        { top: 540, bottom: 566, right: 220 },
        { width: 180, height: 160 },
        { width: 800, height: 600 }
      )
    ).toEqual({ left: 40, top: 376, maxHeight: 528, side: 'above' });
  });

  it('uses the roomier side and limits height when the menu fits on neither side', () => {
    expect(
      positionSidebarMenu(
        { top: 250, bottom: 276, right: 220 },
        { width: 180, height: 400 },
        { width: 800, height: 600 }
      )
    ).toEqual({ left: 40, top: 280, maxHeight: 312, side: 'below' });
  });

  it('clamps the menu inside the horizontal viewport edges', () => {
    const atLeftEdge = positionSidebarMenu(
      { top: 20, bottom: 46, right: 40 },
      { width: 180, height: 60 },
      { width: 800, height: 600 }
    );
    const atRightEdge = positionSidebarMenu(
      { top: 20, bottom: 46, right: 795 },
      { width: 180, height: 60 },
      { width: 800, height: 600 }
    );

    expect(atLeftEdge.left).toBe(8);
    expect(atRightEdge.left + 180).toBe(792);
  });

  it('reduces menu width when the viewport is narrower than the menu', () => {
    expect(
      positionSidebarMenu(
        { top: 20, bottom: 46, right: 40 },
        { width: 180, height: 60 },
        { width: 120, height: 600 }
      ).left
    ).toBe(8);
  });
});
