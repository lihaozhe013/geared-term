import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const aliases = {
  '@geared-term/domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
  '@geared-term/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts'),
  '@geared-term/command-parser': resolve(__dirname, '../../packages/command-parser/src/index.ts')
};

function resolveCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return 'unknown';
  }
}

const commitHash = resolveCommitHash();

export default defineConfig({
  main: {
    resolve: { alias: aliases },
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@geared-term/protocol',
          '@geared-term/domain',
          '@geared-term/command-parser',
          'zod'
        ]
      })
    ]
  },
  preload: {
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'index.js' }
      }
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@geared-term/protocol',
          '@geared-term/domain',
          '@geared-term/command-parser',
          'zod'
        ]
      })
    ]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: aliases },
    define: { __APP_COMMIT__: JSON.stringify(commitHash) },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/renderer/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
          history: resolve(__dirname, 'src/renderer/history.html')
        }
      }
    }
  }
});
