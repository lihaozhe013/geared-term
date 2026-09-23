import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packagePath = join(scriptDirectory, '..', 'package.json');
const runNumber = process.env.GITHUB_RUN_NUMBER;
if (!runNumber || !/^\d+$/u.test(runNumber) || Number(runNumber) < 1) {
  throw new Error('GITHUB_RUN_NUMBER must be a positive integer');
}

const appPackage = JSON.parse(await readFile(packagePath, 'utf8'));
const baseVersion = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/u.exec(appPackage.version);
if (!baseVersion)
  throw new Error(`Expected a stable semantic version, received ${appPackage.version}`);

const nightlyVersion = `${baseVersion[1]}.${baseVersion[2]}.${Number(baseVersion[3]) + 1}-beta.${runNumber}`;
appPackage.version = nightlyVersion;
await writeFile(packagePath, `${JSON.stringify(appPackage, null, 2)}\n`);
process.stdout.write(`Nightly package version: ${nightlyVersion}\n`);
