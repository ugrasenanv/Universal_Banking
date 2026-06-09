import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/**/src/**/*.ts'],
      exclude: ['packages/**/src/**/*.{test,spec}.ts', 'packages/**/src/**/index.ts'],
    },
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@afg/shared-types': path.resolve(__dirname, 'packages/shared-types/src'),
      '@afg/platform-services': path.resolve(__dirname, 'packages/platform-services/src'),
      '@afg/ai-services': path.resolve(__dirname, 'packages/ai-services/src'),
      '@afg/data-layer': path.resolve(__dirname, 'packages/data-layer/src'),
      '@afg/integration-layer': path.resolve(__dirname, 'packages/integration-layer/src'),
      '@afg/infrastructure': path.resolve(__dirname, 'packages/infrastructure/src'),
    },
  },
});
