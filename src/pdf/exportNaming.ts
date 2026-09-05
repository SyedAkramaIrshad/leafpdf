/**
 * Kept apart from `exportPdf` so the main thread can name a download without
 * pulling pdf-lib into its bundle; all real export work happens on the worker.
 */
import type { PdfFormOutput } from './exportWorkerProtocol'

export function exportedFileName(fileName: string, formOutput: PdfFormOutput = 'fillable'): string {
  const base = fileName.replace(/\.pdf$/i, '').trim() || 'document'
  return `${base}-${formOutput === 'flattened' ? 'flattened' : 'edited'}.pdf`
}
