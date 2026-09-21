import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listPackage } from '@electron/asar';
import { _electron as electron } from '@playwright/test';

const appDirectory = process.cwd();
const releaseDirectory = join(appDirectory, 'out', 'releases');

function packagedExecutable() {
  const override = process.env.GEARED_PACKAGED_EXECUTABLE?.trim();
  if (override) return override;
  if (process.platform === 'darwin') {
    return join(
      releaseDirectory,
      `mac-${process.arch}`,
      'Geared Term.app',
      'Contents',
      'MacOS',
      'Geared Term'
    );
  }
  if (process.platform === 'win32') {
    return join(releaseDirectory, 'win-unpacked', 'geared-term.exe');
  }
  return join(releaseDirectory, 'linux-unpacked', 'geared-term');
}

function packagedAsar() {
  if (process.platform === 'darwin') {
    return join(
      releaseDirectory,
      `mac-${process.arch}`,
      'Geared Term.app',
      'Contents',
      'Resources',
      'app.asar'
    );
  }
  return join(dirname(packagedExecutable()), 'resources', 'app.asar');
}

const executablePath = packagedExecutable();
if (!existsSync(executablePath)) {
  throw new Error(`Packaged executable not found: ${executablePath}`);
}
const workspaceEntries = listPackage(packagedAsar(), { isPack: false }).filter((entry) =>
  entry.startsWith('/node_modules/@geared-term/')
);
if (workspaceEntries.length > 0) {
  throw new Error(`Packaged app contains workspace packages: ${workspaceEntries.join(', ')}`);
}

const userDataDirectory = await mkdtemp(join(tmpdir(), 'geared-packaged-startup-'));
let application;
try {
  application = await electron.launch({
    executablePath,
    args: [
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--enable-unsafe-swiftshader'
    ],
    cwd: userDataDirectory,
    env: {
      ...process.env,
      GEARED_USER_DATA: join(userDataDirectory, 'user-data')
    }
  });
  const page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const title = await page.title();
  const appInfo = await page.evaluate(() => window.geared.getAppInfo());
  if (title !== 'Geared Term' || appInfo.name !== 'Geared Term' || !appInfo.isPackaged) {
    throw new Error(
      `Packaged startup returned unexpected app state: ${JSON.stringify({ title, appInfo })}`
    );
  }
  console.log(`Packaged startup verified: ${dirname(executablePath)}`);
} finally {
  await application?.close().catch(() => undefined);
  await rm(userDataDirectory, { recursive: true, force: true });
}
