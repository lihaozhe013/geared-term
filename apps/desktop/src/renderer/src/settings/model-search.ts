import { rankFuzzyItems } from '../fuzzy-search';

export function searchModelIds(models: string[], query: string): string[] {
  if (!query.trim()) return models;
  return rankFuzzyItems(models, query, (model) => model);
}
