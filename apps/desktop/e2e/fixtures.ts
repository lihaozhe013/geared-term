import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

export const E2E_MASTER_PASSWORD = 'e2e-master-password';

/**
 * Electron ignores --disable-webgl, so forcing xterm's DOM-renderer fallback
 * requires removing both hardware and software GL. Specs that read terminal
 * text off `.xterm-rows` (which only the DOM renderer creates) launch with
 * this; the WebGL path is covered by webgl-renderer.spec.ts.
 */
export const DOM_RENDERER_ARGS = ['--disable-gpu', '--disable-software-rasterizer'] as const;

export type AppSession = {
  app: ElectronApplication;
  page: Page;
  userDataDirectory: string;
  close: () => Promise<void>;
};

/**
 * Fresh profiles start gated behind the first-run vault setup. Create the
 * master password through the gate so specs exercise the unlocked workspace.
 */
async function passVaultGate(page: Page): Promise<void> {
  const gate = page.locator('.vault-gate');
  await gate.waitFor({ state: 'visible', timeout: 10_000 });
  await gate.locator('.vault-gate-password').fill(E2E_MASTER_PASSWORD);
  await gate.locator('.vault-gate-confirm').fill(E2E_MASTER_PASSWORD);
  await gate.locator('.vault-gate-submit').click();
  await gate.waitFor({ state: 'detached', timeout: 10_000 });
}

/**
 * The workspace now starts with zero terminals, so specs that need a shell
 * must open one explicitly through the same menu command the UI exposes.
 */
export async function openLocalTab(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()?.getMenuItemById('new-local')?.click();
  });
}

export async function launchApp(chromiumArgs: readonly string[] = []): Promise<AppSession> {
  const mainEntry = join(appDirectory, 'out', 'main', 'index.js');
  if (!existsSync(mainEntry)) {
    throw new Error('Built output is missing; run "pnpm build" before the E2E suite');
  }
  const electronBinary = require('electron') as unknown as string;
  const userDataDirectory = await fs.mkdtemp(join(tmpdir(), 'geared-e2e-'));
  const app = await electron.launch({
    // On a real (non-Xvfb) display a test window can be occluded by other
    // windows; Chromium then stops presenting frames for it, and click
    // actionability checks that wait for a stable box hang forever. Disable
    // occlusion detection and raise the window so desktop runs behave like CI.
    args: [
      appDirectory,
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      // GPU-less CI runners only get WebGL through SwiftShader, which
      // Chromium 139+ refuses to use for WebGL unless explicitly opted in.
      // Without it the WebGL renderer test silently falls back to the DOM
      // renderer. DOM_RENDERER_ARGS still wins because it also disables the
      // software rasterizer.
      '--enable-unsafe-swiftshader',
      ...chromiumArgs
    ],
    executablePath: electronBinary,
    cwd: userDataDirectory,
    env: {
      ...process.env,
      GEARED_USER_DATA: join(userDataDirectory, 'user-data')
    }
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.moveTop();
      window.focus();
    }
  });
  await page.waitForLoadState('domcontentloaded');
  await passVaultGate(page);
  return {
    app,
    page,
    userDataDirectory,
    close: async () => {
      await app.close();
      await fs.rm(userDataDirectory, { recursive: true, force: true });
    }
  };
}
