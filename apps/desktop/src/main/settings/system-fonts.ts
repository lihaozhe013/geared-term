import { list as scanSystemFonts } from 'font-finder';

let cachedFontNames: Promise<string[]> | undefined;

export function listSystemFonts(): Promise<string[]> {
  if (!cachedFontNames) {
    cachedFontNames = scanSystemFonts({ onFontError: () => undefined })
      .then((fonts) =>
        Object.keys(fonts)
          .map((name) => name.trim())
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }))
      )
      .catch((reason: unknown) => {
        cachedFontNames = undefined;
        throw reason;
      });
  }
  return cachedFontNames.then((fonts) => [...fonts]);
}
