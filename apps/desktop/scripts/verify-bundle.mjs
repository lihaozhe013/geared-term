import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const outputRoot = join(process.cwd(), 'out');
const javascriptFiles = [];

async function collect(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(path);
    } else if (entry.isFile() && path.endsWith('.js')) {
      javascriptFiles.push(path);
    }
  }
}

await collect(outputRoot);

const bareWorkspaceImport = /(?:from\s+|import\s*\(|require\s*\()(['"])(@geared-term\/[^'"`]+)\1/g;
const packagedTypeScriptPath = /node_modules[\\/]@geared-term[\\/][^\s'"`]+\.ts(?:['"`]|$)/g;
const violations = [];

for (const path of javascriptFiles) {
  const source = await readFile(path, 'utf8');
  for (const match of source.matchAll(bareWorkspaceImport)) {
    violations.push(`${path}: unresolved workspace import ${match[2]}`);
  }
  if (packagedTypeScriptPath.test(source)) {
    violations.push(`${path}: references TypeScript under node_modules`);
  }
  packagedTypeScriptPath.lastIndex = 0;
}

if (violations.length > 0) {
  console.error('Electron bundle verification failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Electron bundle verified (${javascriptFiles.length} JavaScript files).`);
}
