import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

function normalizeBasePath(rawValue = '/') {
  const value = rawValue.trim()
  if (!value || value === '/') return '/'
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//') || /[?#\\]/.test(value)) {
    throw new Error('LEAFPDF_BASE_PATH must be a URL path such as /leafpdf/, not a URL, query, or fragment.')
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    throw new Error('LEAFPDF_BASE_PATH contains invalid percent encoding.')
  }
  const segments = decoded.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('LEAFPDF_BASE_PATH cannot contain . or .. traversal segments.')
  }
  return `/${segments.join('/')}/`
}

function emittedFiles(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return emittedFiles(root, path)
    return [relative(root, path).split(sep).join('/')]
  })
}

function finalizeServiceWorker(): Plugin {
  let outDir = ''
  return {
    name: 'leafpdf:finalize-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const workerPath = join(outDir, 'sw.js')
      const template = readFileSync(workerPath, 'utf8')
      const versionPlaceholder = '__LEAFPDF_CACHE_VERSION__'
      const precachePlaceholder = "['__LEAFPDF_PRECACHE__']"
      if (!template.includes(versionPlaceholder) || !template.includes(precachePlaceholder)) {
        throw new Error('The copied service worker is missing its LeafPDF build placeholders.')
      }

      const files = emittedFiles(outDir)
        .filter((path) => path !== 'sw.js' && !path.endsWith('.map'))
        .sort((left, right) => left.localeCompare(right))
      const hash = createHash('sha256').update(template)
      for (const path of files) {
        hash.update('\0').update(path).update('\0').update(readFileSync(join(outDir, path)))
      }
      const version = hash.digest('hex').slice(0, 16)
      const finalized = template
        .replace(versionPlaceholder, version)
        .replace(precachePlaceholder, JSON.stringify(files, null, 2))
      if (finalized.includes('__LEAFPDF_')) {
        throw new Error('The finalized service worker still contains a LeafPDF build placeholder.')
      }
      writeFileSync(workerPath, finalized, 'utf8')
    },
  }
}

const basePath = normalizeBasePath(process.env.LEAFPDF_BASE_PATH)

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
  base: basePath,
  plugins: [
    react(),
    contentSecurityPolicy(),
    finalizeServiceWorker(),
    ...(process.env.VITEST ? [inlineFontUrlsForVitest()] : []),
  ],
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
