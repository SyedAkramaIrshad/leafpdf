/**
 * Kept apart from `exportPdf` so the main thread can name a download without
 * pulling pdf-lib into its bundle; all real export work happens on the worker.
 */
export function exportedFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim() || 'document'
  return `${base}-edited.pdf`
}
