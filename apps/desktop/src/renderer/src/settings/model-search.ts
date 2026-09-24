export function searchModelIds(models: string[], query: string): string[] {
  if (!query.trim()) return models;
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    const lowerQuery = query.trim().toLowerCase();
    return models.filter((model) => model.toLowerCase().includes(lowerQuery));
  }

  return models
    .map((model, index) => ({ model, index, score: scoreModel(model, query, normalizedQuery) }))
    .filter(
      (result): result is { model: string; index: number; score: number } => result.score !== null
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ model }) => model);
}

function scoreModel(model: string, query: string, normalizedQuery: string): number | null {
  const lowerModel = model.toLowerCase();
  const lowerQuery = query.trim().toLowerCase();
  if (lowerModel === lowerQuery) return 0;
  if (lowerModel.startsWith(lowerQuery)) return 100;
  if (lowerModel.includes(lowerQuery)) return 200 + lowerModel.indexOf(lowerQuery);

  const normalizedModel = normalize(model);
  if (normalizedModel === normalizedQuery) return 300;
  if (normalizedModel.startsWith(normalizedQuery)) return 400;
  const contiguousIndex = normalizedModel.indexOf(normalizedQuery);
  if (contiguousIndex >= 0) return 500 + contiguousIndex;

  let queryIndex = 0;
  let gapCost = 0;
  let previousMatchIndex = -1;
  for (let modelIndex = 0; modelIndex < normalizedModel.length; modelIndex += 1) {
    if (normalizedModel[modelIndex] !== normalizedQuery[queryIndex]) continue;
    if (previousMatchIndex >= 0) gapCost += modelIndex - previousMatchIndex - 1;
    previousMatchIndex = modelIndex;
    queryIndex += 1;
    if (queryIndex === normalizedQuery.length) return 1000 + gapCost;
  }
  return null;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
