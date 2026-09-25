import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listPackage } from '@electron/asar';
import { _electron as electron, expect } from '@playwright/test';

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

function verifyPackagedConpty() {
  const manifestPath = join(appDirectory, 'resources', 'conpty', 'win32-x64', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const unpackedRoot = join(dirname(packagedExecutable()), 'resources', 'app.asar.unpacked');
  if (!existsSync(unpackedRoot)) throw new Error(`Packaged native module directory not found: ${unpackedRoot}`);
  const bindings = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        entry.isFile() &&
        entry.name === 'conpty.node' &&
        /(?:build[\\/](?:Release|Debug)|prebuilds[\\/]win32-x64)[\\/]conpty\.node$/i.test(path)
      ) bindings.push(path);
    }
  };
  walk(unpackedRoot);
  if (bindings.length === 0) throw new Error('Packaged node-pty x64 native binding was not found');

  for (const binding of bindings) {
    const runtimeDirectory = join(dirname(binding), 'conpty');
    for (const [name, expectedHash] of Object.entries(manifest.files)) {
      const path = join(runtimeDirectory, name);
      if (!existsSync(path)) throw new Error(`Bundled ConPTY file is missing beside ${binding}: ${name}`);
      const actualHash = createHash('sha256').update(readFileSync(path)).digest('hex');
      if (actualHash !== expectedHash) throw new Error(`Bundled ConPTY file failed hash verification: ${path}`);
    }
  }
  console.log(`Bundled ConPTY verified (${bindings.length} x64 native binding location(s)).`);
}

async function runTerminalSmoke(page, shell, args, marker, timeoutMs = 15000) {
  return page.evaluate(
    ({ shell, args, marker, timeoutMs }) =>
      new Promise((resolve, reject) => {
        let client;
        let output = '';
        let markerDelayMs;
        let settled = false;
        const startedAt = performance.now();
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (error) {
            try {
              client?.close();
            } catch {
              // The terminal port may already be closed after a failed start.
            }
            reject(error);
          } else {
            try {
              client?.close();
            } catch {
              // Natural process exit can race with renderer port disposal.
            }
            resolve(result);
          }
        };
        const timeout = setTimeout(
          () => finish(new Error(`Terminal smoke timed out for ${shell}; output=${JSON.stringify(output.slice(-1000))}`)),
          timeoutMs
        );
        client = window.geared.createLocalTerminal(
          {
            sessionId: `packaged-smoke-${crypto.randomUUID()}`,
            shell,
            args,
            cols: 80,
            rows: 24,
            term: 'xterm'
          },
          (message) => {
            if (message.kind === 'output') {
              output += message.chunk;
              client.acknowledge(new TextEncoder().encode(message.chunk).byteLength);
              if (markerDelayMs === undefined && output.includes(marker)) {
                markerDelayMs = performance.now() - startedAt;
              }
              return;
            }
            if (message.kind !== 'state') return;
            if (message.state === 'failed') {
              finish(new Error(`Terminal smoke failed for ${shell}: ${message.detail ?? 'unknown error'}`));
            } else if (message.state === 'exited') {
              if (message.detail && !message.detail.startsWith('exitCode=0;')) {
                finish(new Error(`Terminal smoke returned a nonzero status for ${shell}: ${message.detail}`));
              } else if (markerDelayMs === undefined) {
                finish(new Error(`Terminal smoke output marker was missing for ${shell}`));
              } else {
                finish(undefined, { markerDelayMs, output });
              }
            }
          }
        );
      }),
    { shell, args, marker, timeoutMs }
  );
}

async function runPowerShellPromptSmoke(page, timeoutMs = 20000) {
  const startedAt = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'New local terminal' }).click();
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: timeoutMs
  });
  await expect(page.locator('.terminal-wrapper:not([hidden]) .xterm-rows')).toContainText(/PS .+>/, {
    timeout: timeoutMs
  });
  const promptDelayMs = await page.evaluate((startTime) => performance.now() - startTime, startedAt);
  const promptRow = await page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll('.terminal-wrapper:not([hidden]) .xterm-rows > div')
    ];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]?.textContent?.trim()) return index;
    }
    return -1;
  });
  expect(promptRow).toBeGreaterThanOrEqual(0);
  const marker = `GEARED_PACKAGED_CURSOR_${randomUUID().replaceAll('-', '')}`;
  await page.locator('.terminal-wrapper:not([hidden]) .terminal-host').click();
  await page.keyboard.type(`echo ${marker}`);
  await expect
    .poll(
      () =>
        page.evaluate((value) => {
          const rows = [
            ...document.querySelectorAll('.terminal-wrapper:not([hidden]) .xterm-rows > div')
          ];
          return rows.findIndex((row) => row.textContent?.includes(value));
        }, marker),
      { timeout: timeoutMs }
    )
    .toBe(promptRow);
  await page.keyboard.press('Enter');
  await expect
    .poll(
      () =>
        page.evaluate(
          (value) =>
            [
              ...document.querySelectorAll('.terminal-wrapper:not([hidden]) .xterm-rows > div')
            ].filter((row) => row.textContent?.includes(value)).length,
          marker
        ),
      { timeout: timeoutMs }
    )
    .toBeGreaterThanOrEqual(2);
  await page.locator('.terminal-tab.active .tab-close').click();
  await expect(page.locator('.terminal-empty')).toBeVisible({ timeout: timeoutMs });
  return { promptDelayMs };
}

async function runWslInputAlignmentSmoke(page, distribution, timeoutMs = 30000) {
  const profileName = `WSL cursor check ${distribution}`;
  await page.getByRole('button', { name: /New session profile|新建会话配置/u }).click();
  await page.getByRole('menuitem', { name: /New WSL session|新建 WSL 会话/u }).click();
  const editor = page.getByRole('dialog', { name: 'Session profile editor' });
  await editor.getByLabel(/Name|名称/u).fill(profileName);
  await editor.getByLabel(/Distribution|发行版/u).fill(distribution);
  await editor.getByRole('button', { name: /Save profile|保存配置/u }).click();
  await expect(editor).toHaveCount(0, { timeout: timeoutMs });
  await page.locator('.profile-button').filter({ hasText: profileName }).click();
  await expect(page.locator('.terminal-surface')).toHaveAttribute('data-active-status', 'running', {
    timeout: timeoutMs
  });

  const rows = page.locator('.terminal-wrapper:not([hidden]) .xterm-rows > div');
  const promptText = async () =>
    (await rows.allTextContents()).reverse().find((value) => value.trim().length > 0) ?? '';
  await expect.poll(promptText, { timeout: timeoutMs }).toMatch(/[$#%>❯]|➜/u);
  const promptRow = await page.evaluate(() => {
    const visibleRows = [
      ...document.querySelectorAll('.terminal-wrapper:not([hidden]) .xterm-rows > div')
    ];
    for (let index = visibleRows.length - 1; index >= 0; index -= 1) {
      if (visibleRows[index]?.textContent?.trim()) return index;
    }
    return -1;
  });
  expect(promptRow).toBeGreaterThanOrEqual(0);

  const marker = `GEARED_PACKAGED_WSL_CURSOR_${randomUUID().replaceAll('-', '')}`;
  await page.locator('.terminal-wrapper:not([hidden]) .terminal-host').click();
  await page.keyboard.type(`echo ${marker}`);
  await expect
    .poll(
      () =>
        page.evaluate((value) => {
          const visibleRows = [
            ...document.querySelectorAll('.terminal-wrapper:not([hidden]) .xterm-rows > div')
          ];
          return visibleRows.findIndex((row) => row.textContent?.includes(value));
        }, marker),
      { timeout: timeoutMs }
    )
    .toBe(promptRow);
  await page.keyboard.press('Enter');
  await expect
    .poll(
      () =>
        page.evaluate(
          (value) =>
            [...document.querySelectorAll('.terminal-wrapper:not([hidden]) .xterm-rows > div')]
              .filter((row) => row.textContent?.includes(value)).length,
          marker
        ),
      { timeout: timeoutMs }
    )
    .toBeGreaterThanOrEqual(2);
  await page.locator('.terminal-tab.active .tab-close').click();
  await expect(page.locator('.terminal-empty')).toBeVisible({ timeout: timeoutMs });
}

function availablePowerShell() {
  const pwsh = requirePowerShell('pwsh.exe');
  return pwsh ?? requirePowerShell('powershell.exe');
}

function requirePowerShell(command) {
  const result = spawnSync('where.exe', [command], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? command : undefined;
}

function availableWslDistribution() {
  const result = spawnSync('wsl.exe', ['--list', '--quiet'], {
    encoding: 'utf16le',
    windowsHide: true
  });
  if (result.status !== 0 || result.error) return undefined;
  return result.stdout
    .replace(/\0/gu, '')
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find(Boolean);
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
if (process.platform === 'win32' && process.arch === 'x64') verifyPackagedConpty();

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
      '--disable-gpu',
      '--disable-software-rasterizer'
    ],
    cwd: userDataDirectory,
    env: {
      ...process.env,
      GEARED_USER_DATA: join(userDataDirectory, 'user-data')
    }
  });
  const page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const vaultGate = page.locator('.vault-gate');
  await vaultGate.waitFor({ state: 'visible', timeout: 10000 });
  const smokePassword = 'packaged-smoke-master-password';
  await vaultGate.locator('.vault-gate-password').fill(smokePassword);
  await vaultGate.locator('.vault-gate-confirm').fill(smokePassword);
  await vaultGate.locator('.vault-gate-submit').click();
  await vaultGate.waitFor({ state: 'detached', timeout: 10000 });
  const title = await page.title();
  const appInfo = await page.evaluate(() => window.geared.getAppInfo());
  if (title !== 'Geared Term' || appInfo.name !== 'Geared Term' || !appInfo.isPackaged) {
    throw new Error(
      `Packaged startup returned unexpected app state: ${JSON.stringify({ title, appInfo })}`
    );
  }

  if (process.platform === 'win32' && process.arch === 'x64') {
    const cmdMarker = `GEARED_CMD_${Date.now()}`;
    await runTerminalSmoke(page, 'cmd.exe', ['/d', '/c', `echo ${cmdMarker}`], cmdMarker);

    const powershell = availablePowerShell();
    const powerShellRuns = [];
    if (powershell) {
      for (let index = 0; index < 3; index += 1) {
        const result = await runPowerShellPromptSmoke(page);
        powerShellRuns.push(result.promptDelayMs);
      }
    } else {
      console.log('PowerShell prompt smoke skipped because PowerShell is not installed.');
    }
    const sortedPowerShellRuns = [...powerShellRuns].sort((left, right) => left - right);
    const medianPowerShellStartupMs = sortedPowerShellRuns.length
      ? sortedPowerShellRuns[Math.floor(sortedPowerShellRuns.length / 2)]
      : undefined;
    const powerShellStartupExceededLimit =
      medianPowerShellStartupMs !== undefined &&
      (medianPowerShellStartupMs > 3000 || sortedPowerShellRuns.at(-1) > 8000);
    if (powerShellRuns.length > 0) {
      console.log(`PowerShell prompt times: ${powerShellRuns.map((value) => Math.round(value)).join(', ')} ms.`);
      if (powerShellStartupExceededLimit) {
        console.error(`PowerShell prompt time exceeded the smoke limits: ${powerShellRuns.join(', ')} ms.`);
      }
    }

    const wslDistribution = availableWslDistribution();
    if (wslDistribution) {
      await runWslInputAlignmentSmoke(page, wslDistribution);
      console.log(`Packaged WSL input alignment verified: ${wslDistribution}.`);
    } else {
      console.log('WSL input alignment smoke skipped because no WSL distribution is installed.');
    }

    const terminalLogPath = join(userDataDirectory, 'user-data', 'logs', 'debug-terminal.log');
    const terminalLog = await readFile(terminalLogPath, 'utf8');
    if (!terminalLog.includes('ptyBackend":"bundled-conpty')) {
      throw new Error('Packaged terminal did not report use of the bundled ConPTY backend');
    }
    if (powerShellStartupExceededLimit) {
      throw new Error('Packaged PowerShell prompt time exceeded the 3-second median smoke limit');
    }
  }
  console.log(`Packaged startup and local terminal smoke verified: ${dirname(executablePath)}`);
} finally {
  await application?.close().catch(() => undefined);
  await rm(userDataDirectory, { recursive: true, force: true });
}
