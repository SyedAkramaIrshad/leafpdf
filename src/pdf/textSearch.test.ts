import { describe, expect, it } from 'vitest'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage } from '../model/editor'
import {
  countMatches,
  findOccurrences,
  searchCursorEntries,
  searchDocument,
} from './textSearch'

function fakePdf(pageTexts: string[][]): PDFDocumentProxy {
  return {
    getPage: (pageNumber: number) => Promise.resolve({
      getTextContent: () => Promise.resolve({
        items: pageTexts[pageNumber - 1].map((str, index) => ({
          str,
          hasEOL: index % 2 === 1,
        })),
      }),
    }),
  } as unknown as PDFDocumentProxy
}

function pagesOf(...sourceIndexes: number[]): EditorPage[] {
  return sourceIndexes.map((sourceIndex, index) => ({
    id: `page-${index + 1}`,
    kind: 'original' as const,
    sourceIndex,
    rotation: 0 as const,
  }))
}

describe('countMatches', () => {
  it('counts case-insensitively and without overlap', () => {
    expect(countMatches('Approve APPROVE approve', 'approve')).toBe(3)
    expect(countMatches('aaaa', 'aa')).toBe(2)
    expect(countMatches('nothing', 'missing')).toBe(0)
    expect(countMatches('anything', '')).toBe(0)
  })
})

describe('findOccurrences', () => {
  it('returns case-insensitive non-overlapping UTF-16 offsets', () => {
    expect(findOccurrences('PDF leafPdf pdf', 'pdf')).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
      { start: 12, end: 15 },
    ])
    expect(findOccurrences('aaaa', 'aa')).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
    expect(findOccurrences('anything', '')).toEqual([])
  })
})

describe('searchCursorEntries', () => {
  it('flattens source and OCR-only matches without inventing OCR geometry', () => {
    expect(searchCursorEntries([
      {
        pageId: 'page-1',
        pageNumber: 1,
        matches: 3,
        occurrences: [{ start: 4, end: 7 }, { start: 12, end: 15 }],
      },
    ])).toEqual([
      { pageId: 'page-1', pageNumber: 1, occurrence: { start: 4, end: 7 } },
      { pageId: 'page-1', pageNumber: 1, occurrence: { start: 12, end: 15 } },
      { pageId: 'page-1', pageNumber: 1, occurrence: null },
    ])
  })
})

describe('searchDocument', () => {
  it('reports matching pages in current document order with display page numbers', async () => {
    const pdf = fakePdf([
      ['The quarterly report', 'was approved by finance'],
      ['No relevant content'],
      ['Approved twice: approved'],
    ])
    // Source page 3 has been moved to display position 1.
    const pages = pagesOf(2, 0, 1)
    const results = await searchDocument(pdf, new Map(), pages, 'approved')
    expect(results).toEqual([
      {
        pageId: 'page-1',
        pageNumber: 1,
        matches: 2,
        occurrences: [{ start: 0, end: 8 }, { start: 16, end: 24 }],
      },
      {
        pageId: 'page-2',
        pageNumber: 2,
        matches: 1,
        occurrences: [{ start: 24, end: 32 }],
      },
    ])
  })

  it('never searches deleted pages and returns nothing for blank queries', async () => {
    const pdf = fakePdf([['secret text'], ['other text']])
    expect(await searchDocument(pdf, new Map(), pagesOf(1), 'secret')).toEqual([])
    expect(await searchDocument(pdf, new Map(), pagesOf(0, 1), '   ')).toEqual([])
  })

  it('applies line breaks exactly where the PDF marks them', async () => {
    const pdf = {
      getPage: (pageNumber: number) => Promise.resolve({
        getTextContent: () => Promise.resolve({
          items: pageNumber === 1
            // A marked line end must keep 'wor' and 'd' apart...
            ? [{ str: 'wor', hasEOL: true }, { str: 'd', hasEOL: false }]
            // ...while unmarked adjacent items are one run of text.
            : [{ str: 'wor', hasEOL: false }, { str: 'd', hasEOL: false }],
        }),
      }),
    } as unknown as PDFDocumentProxy
    const results = await searchDocument(pdf, new Map(), pagesOf(0, 1), 'word')
    expect(results).toEqual([{
      pageId: 'page-2',
      pageNumber: 2,
      matches: 1,
      occurrences: [{ start: 0, end: 4 }],
    }])
  })
})
