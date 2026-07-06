import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Quiet the pino file/pretty transports during tests
    env: { LOG_LEVEL: 'silent' },
    testTimeout: 15000
  }
});
