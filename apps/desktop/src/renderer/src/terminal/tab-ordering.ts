export type TitleBearingTab = {
  name: string;
  manualTitle?: boolean;
  dynamicTitle?: string;
};

/** A manually renamed tab keeps its name; otherwise the shell-set (OSC)
 *  title wins over the name the tab was opened with. */
export function tabDisplayLabel(tab: TitleBearingTab): string {
  if (tab.manualTitle) return tab.name;
  const dynamic = tab.dynamicTitle?.trim();
  return dynamic || tab.name;
}

export function moveTabById<T extends { id: string }>(
  tabs: T[],
  draggedId: string,
  targetId: string,
  placeAfter: boolean
): T[] {
  if (draggedId === targetId) return tabs;
  const from = tabs.findIndex((tab) => tab.id === draggedId);
  if (from === -1) return tabs;
  const next = tabs.slice();
  const [moved] = next.splice(from, 1);
  if (!moved) return tabs;
  const target = next.findIndex((tab) => tab.id === targetId);
  if (target === -1) return tabs;
  next.splice(placeAfter ? target + 1 : target, 0, moved);
  return next;
}

export function insertTabAfter<T extends { id: string }>(tabs: T[], tab: T, afterId: string): T[] {
  const index = tabs.findIndex((tab) => tab.id === afterId);
  if (index === -1) return [...tabs, tab];
  const next = tabs.slice();
  next.splice(index + 1, 0, tab);
  return next;
}

export function nextCopyName(takenLabels: string[], base: string): string {
  let name = `${base} (copy)`;
  let counter = 2;
  while (takenLabels.includes(name)) {
    name = `${base} (copy ${counter})`;
    counter += 1;
  }
  return name;
}
