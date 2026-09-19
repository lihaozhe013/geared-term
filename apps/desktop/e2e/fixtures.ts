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

export async function launchApp(): Promise<AppSession> {
  const mainEntry = join(appDirectory, 'out', 'main', 'index.js');
  if (!existsSync(mainEntry)) {
    throw new Error('Built output is missing; run "pnpm build" before the E2E suite');
  }
  const electronBinary = require('electron') as unknown as string;
  const userDataDirectory = await fs.mkdtemp(join(tmpdir(), 'geared-e2e-'));
  const app = await electron.launch({
    args: [appDirectory],
    executablePath: electronBinary,
    cwd: userDataDirectory,
    env: {
      ...process.env,
      GEARED_USER_DATA: join(userDataDirectory, 'user-data')
    }
  });
  const page = await app.firstWindow();
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
