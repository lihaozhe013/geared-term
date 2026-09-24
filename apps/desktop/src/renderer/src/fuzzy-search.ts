export function rankFuzzyItems<T>(
  items: readonly T[],
  query: string,
  labelOf: (item: T) => string
): T[] {
  if (!query.trim()) return [...items];
  const normalizedQuery = normalize(query);
  const lowerQuery = query.trim().toLowerCase();

  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreLabel(labelOf(item), lowerQuery, normalizedQuery)
    }))
    .filter((result): result is { item: T; index: number; score: number } => result.score !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ item }) => item);
}

function scoreLabel(label: string, lowerQuery: string, normalizedQuery: string): number | null {
  const lowerLabel = label.toLowerCase();
  if (!normalizedQuery) {
    return lowerLabel.includes(lowerQuery) ? 0 : null;
  }
  if (lowerLabel === lowerQuery) return 0;
  if (lowerLabel.startsWith(lowerQuery)) return 100;
  if (lowerLabel.includes(lowerQuery)) return 200 + lowerLabel.indexOf(lowerQuery);

  const normalizedLabel = normalize(label);
  if (normalizedLabel === normalizedQuery) return 300;
  if (normalizedLabel.startsWith(normalizedQuery)) return 400;
  const contiguousIndex = normalizedLabel.indexOf(normalizedQuery);
  if (contiguousIndex >= 0) return 500 + contiguousIndex;

  let queryIndex = 0;
  let gapCost = 0;
  let previousMatchIndex = -1;
  for (let labelIndex = 0; labelIndex < normalizedLabel.length; labelIndex += 1) {
    if (normalizedLabel[labelIndex] !== normalizedQuery[queryIndex]) continue;
    if (previousMatchIndex >= 0) gapCost += labelIndex - previousMatchIndex - 1;
    previousMatchIndex = labelIndex;
    queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return 1000 + gapCost;
  }
  return null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
