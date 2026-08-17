import { defineConfig } from '@playwright/test'

/**
 * `LEAFPDF_E2E_SERVER=preview` runs the whole suite against the production
 * build served by `vite preview` — the artifact users actually get, with the
 * Content-Security-Policy meta tag active. The default dev server keeps local
 * iteration fast; CI runs both.
 */
const preview = process.env.LEAFPDF_E2E_SERVER === 'preview'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // These tests share one dev server and write their exports into the same
  // `output/pdf` directory, which `verify_export.py` then checks. Playwright picks a
  // worker count from machine load, so the suite silently alternated between one and
  // two workers between runs and was not reproducible. The whole suite takes about
  // 16 s, so serialising costs nothing and buys determinism.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 980 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: preview
      ? 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort'
      : 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    // Never reuse in preview mode: a leftover dev server on the same port would
    // silently test the wrong artifact, without the CSP.
    reuseExistingServer: !preview,
  },
})
