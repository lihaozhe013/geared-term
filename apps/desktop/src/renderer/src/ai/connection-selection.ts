import type { AiConnectionRecord } from '@geared-term/protocol';

export function resolveDefaultAiConnectionId(
  connections: AiConnectionRecord[],
  configuredId: string | null | undefined
): string | null {
  if (configuredId && connections.some((connection) => connection.id === configuredId)) {
    return configuredId;
  }
  return connections[0]?.id ?? null;
}

export function resolveActiveAiConnectionId(
  connections: AiConnectionRecord[],
  selectedId: string | null,
  configuredDefaultId: string | null | undefined
): string | null {
  if (selectedId && connections.some((connection) => connection.id === selectedId)) {
    return selectedId;
  }
  return resolveDefaultAiConnectionId(connections, configuredDefaultId);
}

export function moveArrayItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;

  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item === undefined) return items;
  next.splice(target, 0, item);
  return next;
}
