import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scanSystemFonts } = vi.hoisted(() => ({
  scanSystemFonts: vi.fn()
}));

vi.mock('font-finder', () => ({ list: scanSystemFonts }));

let listSystemFonts: typeof import('./system-fonts').listSystemFonts;

describe('listSystemFonts', () => {
  beforeEach(async () => {
    vi.resetModules();
    scanSystemFonts.mockReset();
    ({ listSystemFonts } = await import('./system-fonts'));
  });

  it('returns sorted family names without exposing font metadata', async () => {
    scanSystemFonts.mockResolvedValue({
      Zebra: [{ path: '/private/font/z.ttf', weight: 400 }],
      Arial: [{ path: '/private/font/a.otf', weight: 400 }]
    });

    await expect(listSystemFonts()).resolves.toEqual(['Arial', 'Zebra']);
    expect(scanSystemFonts).toHaveBeenCalledWith({ onFontError: expect.any(Function) });
  });

  it('caches successful discovery but retries after a failure', async () => {
    scanSystemFonts.mockRejectedValueOnce(new Error('font scan failed')).mockResolvedValueOnce({
      Cascadia: []
    });

    await expect(listSystemFonts()).rejects.toThrow('font scan failed');
    await expect(listSystemFonts()).resolves.toEqual(['Cascadia']);
    await expect(listSystemFonts()).resolves.toEqual(['Cascadia']);
    expect(scanSystemFonts).toHaveBeenCalledTimes(2);
  });
});
