import { expect, test } from '@playwright/test';
import { launchApp, type AppSession } from './fixtures';

let session: AppSession | undefined;

test.afterEach(async () => {
  await session?.close();
});

test('composites each main-window surface exactly once at supported opacity settings', async () => {
  // Pixel sampling needs a visible Electron window; the hidden test windows can stall screenshots.
  session = await launchApp([], { headless: false });
  const { page } = session;
  const expandPanel = page.getByRole('button', { name: 'Expand panel' });
  await expect(expandPanel).toBeVisible();
  await expandPanel.click();
  await expect(page.locator('.right-panel')).toBeVisible();

  const originalSettings = await page.evaluate(async () => {
    document.body.style.backgroundColor = 'rgb(240, 192, 32)';
    return window.geared.getSettings();
  });

  for (const minimalMode of [false, true]) {
    for (const opacity of [60, 75, 100]) {
      await page.evaluate(
        async ({ minimalMode: nextMinimalMode, opacity: nextOpacity, originalSettings }) => {
          await window.geared.saveSettings({
            ...originalSettings,
            language: 'en-US',
            windowEffect: 'frosted',
            windowBackgroundOpacityPercent: nextOpacity,
            minimalMode: nextMinimalMode
          });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        },
        { minimalMode, opacity, originalSettings }
      );

      const selectors = [
        '.sidebar',
        '.terminal-surface',
        '.right-panel',
        minimalMode ? '.minimal-chrome' : '.titlebar'
      ];
      const surfaces = await Promise.all(
        selectors.map(async (selector) => {
          const surface = page.locator(selector).first();
          await expect(surface).toBeVisible();
          return surface.evaluate((element, selector) => {
            const rect = element.getBoundingClientRect();
            return {
              selector,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              color: getComputedStyle(element).backgroundColor
            };
          }, selector);
        })
      );
      const screenshot = await page.screenshot();
      const pixels = await page.evaluate(
        async ({ screenshotBase64, surfaces, expectedOpacity }) => {
          const image = new Image();
          image.src = `data:image/png;base64,${screenshotBase64}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Could not create the screenshot sampling canvas');
          context.drawImage(image, 0, 0);
          const scaleX = canvas.width / window.innerWidth;
          const scaleY = canvas.height / window.innerHeight;

          const parseColor = (color: string): [number, number, number, number] => {
            const parser = document.createElement('canvas').getContext('2d');
            if (!parser) throw new Error('Could not create the color parser');
            parser.fillStyle = color;
            const normalized = parser.fillStyle;
            const match = normalized.match(
              /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/u
            );
            if (match) {
              return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 1)];
            }
            const srgbMatch = normalized.match(
              /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/u
            );
            if (srgbMatch) {
              return [
                Number(srgbMatch[1]) * 255,
                Number(srgbMatch[2]) * 255,
                Number(srgbMatch[3]) * 255,
                Number(srgbMatch[4] ?? 1)
              ];
            }
            throw new Error(`Unsupported computed CSS color: ${normalized}`);
          };

          const rgbaProbe = parseColor('rgba(17, 51, 85, 0.6)');
          if (
            rgbaProbe[0] !== 17 ||
            rgbaProbe[1] !== 51 ||
            rgbaProbe[2] !== 85 ||
            rgbaProbe[3] !== 0.6
          ) {
            throw new Error('RGBA color parsing cross-check failed');
          }

          return surfaces.map((surface) => {
            const [red, green, blue, alpha] = parseColor(surface.color);
            const requestedOpacity = expectedOpacity / 100;
            const expected = [
              Math.round(red * requestedOpacity + 240 * (1 - requestedOpacity)),
              Math.round(green * requestedOpacity + 192 * (1 - requestedOpacity)),
              Math.round(blue * requestedOpacity + 32 * (1 - requestedOpacity))
            ];
            const centerX = Math.round((surface.x + surface.width * 0.74) * scaleX);
            const centerY = Math.round((surface.y + surface.height * 0.72) * scaleY);
            let matchingPixels = 0;
            let totalPixels = 0;

            for (let offsetY = -4; offsetY <= 4; offsetY += 1) {
              for (let offsetX = -4; offsetX <= 4; offsetX += 1) {
                const x = centerX + offsetX;
                const y = centerY + offsetY;
                if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
                const pixel = context.getImageData(x, y, 1, 1).data;
                totalPixels += 1;
                if (pixel[3] !== 255) continue;
                if (
                  Math.max(
                    Math.abs(pixel[0]! - expected[0]!),
                    Math.abs(pixel[1]! - expected[1]!),
                    Math.abs(pixel[2]! - expected[2]!)
                  ) <= 12
                ) {
                  matchingPixels += 1;
                }
              }
            }

            return {
              selector: surface.selector,
              alpha,
              expectedRgb: expected,
              centerPixel: Array.from(context.getImageData(centerX, centerY, 1, 1).data),
              matchingPixels,
              totalPixels
            };
          });
        },
        {
          screenshotBase64: screenshot.toString('base64'),
          surfaces,
          expectedOpacity: opacity
        }
      );

      for (const pixel of pixels) {
        expect(pixel.alpha, `${pixel.selector} alpha at ${opacity}%`).toBeCloseTo(opacity / 100, 2);
        expect(
          pixel.matchingPixels,
          `${pixel.selector} should have one background tint at ${opacity}% in ${minimalMode ? 'minimal' : 'standard'} mode; expected ${pixel.expectedRgb}, sampled ${pixel.centerPixel}`
        ).toBeGreaterThanOrEqual(Math.ceil(pixel.totalPixels * 0.8));
      }
    }
  }
});
