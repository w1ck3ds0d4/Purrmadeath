import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  test: {
    include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
    globals: true,
  },
});
