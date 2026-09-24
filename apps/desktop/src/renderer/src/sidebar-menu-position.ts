export type SidebarMenuPosition = {
  left: number;
  top: number;
  maxHeight: number;
  side: 'above' | 'below';
};

type AnchorRect = Pick<DOMRect, 'top' | 'bottom' | 'right'>;

export function positionSidebarMenu(
  anchor: AnchorRect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  options: { padding?: number; gap?: number } = {}
): SidebarMenuPosition {
  const padding = options.padding ?? 8;
  const gap = options.gap ?? 4;
  const availableWidth = Math.max(0, viewport.width - padding * 2);
  const menuWidth = Math.min(menu.width, availableWidth);
  const left = Math.max(
    padding,
    Math.min(anchor.right - menuWidth, viewport.width - padding - menuWidth)
  );

  const belowTop = anchor.bottom + gap;
  const aboveBottom = anchor.top - gap;
  const availableBelow = Math.max(0, viewport.height - padding - belowTop);
  const availableAbove = Math.max(0, aboveBottom - padding);
  const canFitBelow = menu.height <= availableBelow;
  const canFitAbove = menu.height <= availableAbove;

  if (canFitBelow) {
    return {
      left,
      top: belowTop,
      maxHeight: availableBelow,
      side: 'below'
    };
  }
  if (canFitAbove) {
    return {
      left,
      top: aboveBottom - menu.height,
      maxHeight: availableAbove,
      side: 'above'
    };
  }

  if (availableBelow >= availableAbove) {
    return {
      left,
      top: belowTop,
      maxHeight: availableBelow,
      side: 'below'
    };
  }
  return {
    left,
    top: aboveBottom - availableAbove,
    maxHeight: availableAbove,
    side: 'above'
  };
}
