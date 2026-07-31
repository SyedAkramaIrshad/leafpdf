import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { LoadedPdf } from './types'

/**
 * Largest file the export path has actually been exercised with. See README; raise
 * this only alongside a fixture that opens and exports at the new size.
 */
export const MAX_PDF_BYTES = 100 * 1024 * 1024

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export async function loadPdf(file: File): Promise<LoadedPdf> {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    throw new Error('Choose a PDF file to continue.')
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(`LeafPDF has been tested with PDF files up to ${formatFileSize(MAX_PDF_BYTES)}.`)
  }
  const { GlobalWorkerOptions, getDocument } = await import('pdfjs-dist')
  const { analyzeInWorker } = await import('./exportClient')
  GlobalWorkerOptions.workerSrc = workerUrl

  // Structural analysis runs on a worker, which reads the file itself. Parsing the
  // full object graph with pdf-lib would otherwise freeze the UI on a large file,
  // and the main thread never has to hold the bytes at all.
  const featuresPromise = analyzeInWorker(file)

  // This does hold one copy of the whole file on the main thread: `arrayBuffer()`
  // allocates `file.size` bytes before PDF.js sees them, and PDF.js then transfers
  // that buffer to its own worker. Handing PDF.js a blob URL instead would let it
  // stream the file and avoid this allocation, but that could not be shown to help:
  // ArrayBuffer bytes are external memory and barely register in `usedJSHeapSize`,
  // so the available instrumentation cannot tell the two apart. The simpler path is
  // kept rather than shipping an unverifiable change to document loading.
  const document = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  const pdfJsFingerprint = document.fingerprints.find((value): value is string => Boolean(value))
  let documentFingerprint = pdfJsFingerprint
  if (!documentFingerprint) {
    // PDF.js normally derives this from the trailer. A malformed/minimal PDF can
    // lack that identity, so use a cryptographic content hash only for that rare
    // fallback instead of weakening recovery back to filename metadata.
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    documentFingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
  return {
    document,
    sourceFile: file,
    fileName: file.name,
    pageCount: document.numPages,
    documentFingerprint,
    features: await featuresPromise,
  }
}
