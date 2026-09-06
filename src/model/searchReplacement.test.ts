import { describe, expect, it } from 'vitest'
import {
  advanceSearchReplacementBatch,
  createSearchReplacementBatch,
  currentSearchReplacementRequest,
  searchReplacementMatchesOccurrence,
  sourceSearchEntries,
} from './searchReplacement'

const entries = [
  { pageId: 'page-1', pageNumber: 1, occurrence: { start: 2, end: 6 } },
  { pageId: 'page-1', pageNumber: 1, occurrence: null },
  { pageId: 'page-2', pageNumber: 2, occurrence: { start: 9, end: 13 } },
]

describe('search replacement batches', () => {
  it('keeps source occurrences and excludes OCR-only cursor entries', () => {
    expect(sourceSearchEntries(entries)).toEqual([entries[0], entries[2]])
  })

  it('normalizes one-line replacement text and emits deterministic requests', () => {
    const batch = createSearchReplacementBatch(entries, '  offer\nletter  ', 'replace-1')
    expect(batch).toMatchObject({ id: 'replace-1', replacementText: 'offer letter', index: 0 })
    expect(currentSearchReplacementRequest(batch!)).toEqual({
      id: 'replace-1:0',
      pageId: 'page-1',
      occurrence: { start: 2, end: 6 },
      replacementText: 'offer letter',
      historyGroup: 'replace-1',
      index: 1,
      total: 2,
    })
    const next = advanceSearchReplacementBatch(batch!)
    expect(currentSearchReplacementRequest(next!)).toMatchObject({
      id: 'replace-1:1',
      pageId: 'page-2',
      index: 2,
    })
    expect(advanceSearchReplacementBatch(next!)).toBeNull()
  })

  it('rejects empty replacement text, empty ids, and OCR-only work', () => {
    expect(createSearchReplacementBatch(entries, '   ', 'replace-1')).toBeNull()
    expect(createSearchReplacementBatch(entries, 'name', '')).toBeNull()
    expect(createSearchReplacementBatch([entries[1]], 'name', 'replace-1')).toBeNull()
  })

  it('correlates a captured source range with only its exact request', () => {
    const batch = createSearchReplacementBatch(entries, 'name', 'replace-1')!
    const request = currentSearchReplacementRequest(batch)
    expect(searchReplacementMatchesOccurrence({ start: 2, end: 6 }, request)).toBe(true)
    expect(searchReplacementMatchesOccurrence({ start: 3, end: 6 }, request)).toBe(false)
    expect(searchReplacementMatchesOccurrence(null, request)).toBe(false)
  })
})
