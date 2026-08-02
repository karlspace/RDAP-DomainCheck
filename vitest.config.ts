import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Core logic is environment-agnostic; the few DOM-touching modules opt in
    // per file via `// @vitest-environment happy-dom`.
    environment: 'node',
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test-support/**',
        // Three lines of bootstrapping plus the CSS import; exercised by the
        // real page, not by anything a unit test can meaningfully assert.
        'src/main.ts',
        // Data-only translation catalogues; validated by src/i18n/i18n.test.ts.
        'src/i18n/locales/**',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
