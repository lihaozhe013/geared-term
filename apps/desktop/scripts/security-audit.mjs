import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? `: ${detail}` : ''}`);
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function readIfExists(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

const mainBundle = await readIfExists(join(desktopRoot, 'out', 'main', 'index.js'));
const preloadBundle = await readIfExists(join(desktopRoot, 'out', 'preload', 'index.js'));
if (!mainBundle || !preloadBundle) {
  console.error('Built bundles are missing; run "pnpm build" first.');
  process.exit(1);
}

const rendererAssets = await readdir(join(desktopRoot, 'out', 'renderer', 'assets'));
const rendererBundles = [];
for (const asset of rendererAssets.filter((name) => name.endsWith('.js'))) {
  rendererBundles.push({
    name: asset,
    content: await readFile(join(desktopRoot, 'out', 'renderer', 'assets', asset), 'utf8')
  });
}
if (rendererBundles.length === 0) {
  failures.push('renderer bundle not found in out/renderer/assets');
}

const NODE_IMPORT_PATTERN = /(from|import|require)\s*\(?\s*["']node:/u;

for (const bundle of rendererBundles) {
  check(
    `[renderer/${bundle.name}] has no node: imports`,
    !NODE_IMPORT_PATTERN.test(bundle.content),
    'found a node: module specifier'
  );
  check(
    `[renderer/${bundle.name}] has no require( calls`,
    !/\brequire\s*\(/u.test(bundle.content),
    'found a CommonJS require call'
  );
  check(
    `[renderer/${bundle.name}] has no direct electron access`,
    !/require\(["']electron["']\)|__electron/u.test(bundle.content),
    'renderer must not reach the electron module'
  );
  check(
    `[renderer/${bundle.name}] has no __dirname/__filename`,
    !/__dirname|__filename/u.test(bundle.content)
  );
}

check('[preload] exposes the geared bridge', preloadBundle.includes('exposeInMainWorld'));
check('[preload] bridge name is geared', preloadBundle.includes('geared'));
check(
  '[preload] does not embed node integration flags',
  !preloadBundle.includes('nodeIntegration'),
  'preload should not tamper with webPreferences'
);

const preloadWebBundle = await readIfExists(join(desktopRoot, 'out', 'preload', 'web.js'));
if (!preloadWebBundle) {
  failures.push('built web-preload bundle not found in out/preload/web.js');
} else {
  // The embedded-site preload runs in an isolated world and must keep the
  // page's main world free of any application bridge.
  check(
    '[preload-web] exposes nothing to the page world',
    !preloadWebBundle.includes('exposeInMainWorld')
  );
  check(
    '[preload-web] has no node: imports',
    !NODE_IMPORT_PATTERN.test(preloadWebBundle),
    'found a node: module specifier'
  );
  check(
    '[preload-web] does not embed node integration flags',
    !preloadWebBundle.includes('nodeIntegration'),
    'web preload should not tamper with webPreferences'
  );
}

check('[main] enforces context isolation', /contextIsolation:\s*(true|!0)/u.test(mainBundle));
check('[main] enforces the renderer sandbox', /sandbox:\s*(true|!0)/u.test(mainBundle));
check('[main] denies window.open', mainBundle.includes('setWindowOpenHandler'));
check('[main] blocks will-navigate', mainBundle.includes('will-navigate'));
check(
  '[main] ships the production CSP',
  mainBundle.includes("default-src 'self'; script-src 'self'"),
  'expected the production Content-Security-Policy literal'
);
check(
  '[main] registers the permission blocker',
  mainBundle.includes('setPermissionRequestHandler')
);

if (failures.length > 0) {
  console.error(`\n${failures.length} security audit check(s) failed.`);
  process.exit(1);
}
console.log('\nSecurity audit passed.');
