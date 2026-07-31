import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
