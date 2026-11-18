import { defineConfig } from 'vitest/config';

// Pruebas contra la CLI real de Claude Code (consumen uso del plan): npm run test:real
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/real/**/*.test.ts'],
    testTimeout: 300_000,
  },
});
