import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const appDirectory = join(dirname(fileURLToPath(import.meta.url)), '..');

export type AppSession = {
  app: ElectronApplication;
  page: Page;
  userDataDirectory: string;
  close: () => Promise<void>;
};

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
