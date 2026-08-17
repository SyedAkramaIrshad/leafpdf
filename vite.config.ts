import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Test-only: serve `.ttf?url` imports as data URIs. In the browser, `?url` yields
 * a same-origin asset URL that `fetch` downloads; under Vitest there is no server,
 * and Node's fetch rejects bare paths — but it does accept `data:` URIs, so the
 * font tests can exercise the real fetch-and-parse path against real bytes.
 * Never active outside Vitest: in a real build this hook would re-inline the fonts.
 */
function inlineFontUrlsForVitest(): Plugin {
  return {
    name: 'leafpdf:inline-font-urls-for-vitest',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.ttf?url')) return
      const bytes = readFileSync(id.slice(0, -'?url'.length))
      return `export default "data:font/ttf;base64,${bytes.toString('base64')}"`
    },
  }
}

/**
 * The privacy promise, enforced by the browser rather than merely kept by the
 * code: no directive allows any other host, so a dependency that tried to phone
 * home would be blocked and reported, not silently allowed. `data:`/`blob:`
 * appear only where the editor itself uses them (placed images and thumbnails).
 * Inline style attributes are how React sets per-annotation geometry, hence
 * 'unsafe-inline' on style-src. Build-only: the dev server needs HMR websockets.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'leafpdf:content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
            injectTo: 'head-prepend',
          },
        ],
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy(), ...(process.env.VITEST ? [inlineFontUrlsForVitest()] : [])],
  // These libraries sit behind user actions (open/edit/export), so Vite cannot
  // discover all of them during its initial static scan. Pre-bundling them up front
  // prevents a first open/export from triggering a dev-server reload that discards
  // the document currently being edited.
  optimizeDeps: {
    include: [
      'pdfjs-dist',
      'pdf-lib',
      '@pdf-lib/fontkit',
      '@pdf-lib/standard-fonts',
      'regenerator-runtime',
    ],
  },
  // ES workers can be code-split. Without this the export worker is bundled into a
  // single file, which would pull every bundled font into it eagerly and make any
  // export download all of them.
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    css: true,
  },
})
