import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const aliases = {
  '@geared-term/domain': resolve(__dirname, '../../packages/domain/src/index.ts'),
  '@geared-term/protocol': resolve(__dirname, '../../packages/protocol/src/index.ts')
};

export default defineConfig({
  main: {
    resolve: { alias: aliases },
    plugins: [
      externalizeDepsPlugin({ exclude: ['@geared-term/protocol', '@geared-term/domain', 'zod'] })
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
      externalizeDepsPlugin({ exclude: ['@geared-term/protocol', '@geared-term/domain', 'zod'] })
    ]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: aliases },
    plugins: [react()]
  }
});
