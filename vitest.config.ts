import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
      'apps/**/scripts/**/*.test.mjs'
    ],
    passWithNoTests: true,
    environment: 'node'
  }
});
