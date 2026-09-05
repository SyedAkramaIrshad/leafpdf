import type { SearchCursorEntry, TextOccurrence } from '../pdf/textSearch'

export interface SourceSearchEntry extends Omit<SearchCursorEntry, 'occurrence'> {
  occurrence: TextOccurrence
}

export interface SearchReplacementBatch {
  id: string
  replacementText: string
  entries: SourceSearchEntry[]
  index: number
}

export interface SearchReplacementRequest {
  id: string
  pageId: string
  occurrence: TextOccurrence
  replacementText: string
  historyGroup: string
  index: number
  total: number
}

export function sourceSearchEntries(entries: SearchCursorEntry[]): SourceSearchEntry[] {
  return entries.filter((entry): entry is SourceSearchEntry => entry.occurrence !== null)
}

export function createSearchReplacementBatch(
  entries: SearchCursorEntry[],
  replacementText: string,
  id: string,
): SearchReplacementBatch | null {
  const clean = replacementText.replace(/\s*\r?\n\s*/g, ' ').trim()
  const sourceEntries = sourceSearchEntries(entries)
  return id && clean && sourceEntries.length > 0
    ? { id, replacementText: clean, entries: sourceEntries, index: 0 }
    : null
}

export function currentSearchReplacementRequest(
  batch: SearchReplacementBatch,
): SearchReplacementRequest {
  const entry = batch.entries[batch.index]
  return {
    id: `${batch.id}:${batch.index}`,
    pageId: entry.pageId,
    occurrence: entry.occurrence,
    replacementText: batch.replacementText,
    historyGroup: batch.id,
    index: batch.index + 1,
    total: batch.entries.length,
  }
}

export function advanceSearchReplacementBatch(
  batch: SearchReplacementBatch,
): SearchReplacementBatch | null {
  return batch.index + 1 < batch.entries.length
    ? { ...batch, index: batch.index + 1 }
    : null
}

export function searchReplacementMatchesOccurrence(
  captured: TextOccurrence | null,
  request: SearchReplacementRequest,
): boolean {
  return captured?.start === request.occurrence.start
    && captured.end === request.occurrence.end
}
