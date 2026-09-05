import type { EditorPage } from './editorCore'

/**
 * Return one exact page order for direct manipulation. Invalid and unchanged
 * requests preserve the original array reference so reducers can remain no-op
 * aware and avoid inventing history entries.
 */
export function movePageToIndex(
  pages: EditorPage[],
  pageId: string,
  targetIndex: number,
): EditorPage[] {
  if (!Number.isFinite(targetIndex)) return pages
  const from = pages.findIndex((page) => page.id === pageId)
  if (from < 0) return pages
  const to = Math.max(0, Math.min(pages.length - 1, Math.trunc(targetIndex)))
  if (from === to) return pages
  const reordered = [...pages]
  const [page] = reordered.splice(from, 1)
  reordered.splice(to, 0, page)
  return reordered
}
