import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage } from '../model/editor'
import { pageRenderSource, type ExternalDocuments } from './pageSource'

export interface PageMatches {
  pageId: string
  /** 1-based position of the page in the current document order. */
  pageNumber: number
  matches: number
  /** Source-PDF text offsets. OCR-only matches add to `matches` without geometry. */
  occurrences: TextOccurrence[]
}

export interface TextOccurrence {
  start: number
  end: number
}

export interface SearchCursorEntry {
  pageId: string
  pageNumber: number
  occurrence: TextOccurrence | null
}

/**
 * Extracted page text, cached per document so repeated searches never re-read
 * pages. Keyed weakly: closing the document releases everything.
 */
const documentTextCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<string>>>()

async function extractPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  let pages = documentTextCache.get(pdf)
  if (!pages) {
    pages = new Map()
    documentTextCache.set(pdf, pages)
  }
  const cached = pages.get(pageNumber)
  if (cached) return cached
  const loading = pdf.getPage(pageNumber).then(async (page) => {
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if ('str' in item) {
        text += item.str
        if (item.hasEOL) text += '\n'
      }
    }
    return text
  })
  pages.set(pageNumber, loading)
  return loading
}

/** Case-insensitive, non-overlapping source-text offsets. */
export function findOccurrences(text: string, query: string): TextOccurrence[] {
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  if (needle.length === 0) return []
  const occurrences: TextOccurrence[] = []
  let start = haystack.indexOf(needle)
  while (start !== -1) {
    occurrences.push({ start, end: start + needle.length })
    start = haystack.indexOf(needle, start + needle.length)
  }
  return occurrences
}

/** Case-insensitive, non-overlapping occurrence count. */
export function countMatches(text: string, query: string): number {
  return findOccurrences(text, query).length
}

/**
 * Flatten page summaries into the cursor order exposed by Previous/Next.
 * Source occurrences keep exact offsets; any remaining count represents OCR
 * words and deliberately carries no glyph geometry.
 */
export function searchCursorEntries(results: PageMatches[]): SearchCursorEntry[] {
  const entries: SearchCursorEntry[] = []
  for (const result of results) {
    for (const occurrence of result.occurrences) {
      entries.push({ pageId: result.pageId, pageNumber: result.pageNumber, occurrence })
    }
    const ocrMatches = Math.max(0, result.matches - result.occurrences.length)
    for (let index = 0; index < ocrMatches; index += 1) {
      entries.push({ pageId: result.pageId, pageNumber: result.pageNumber, occurrence: null })
    }
  }
  return entries
}

/**
 * Find which pages of the current document contain `query`, in display order.
 * Pages the user deleted are never searched; a reordered document reports the
 * new page numbers. Blank pages have no text; inserted-PDF pages are searched
 * through their own document.
 */
export async function searchDocument(
  pdf: PDFDocumentProxy,
  externalDocuments: ExternalDocuments,
  pages: EditorPage[],
  query: string,
): Promise<PageMatches[]> {
  const clean = query.trim()
  if (clean.length === 0) return []
  const results: PageMatches[] = []
  for (const [index, page] of pages.entries()) {
    const source = pageRenderSource(page, pdf, externalDocuments)
    if (!source) continue
    const text = await extractPageText(source.pdf, source.pageNumber)
    const occurrences = findOccurrences(text, clean)
    if (occurrences.length > 0) {
      results.push({
        pageId: page.id,
        pageNumber: index + 1,
        matches: occurrences.length,
        occurrences,
      })
    }
  }
  return results
}
