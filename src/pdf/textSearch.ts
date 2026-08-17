import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage } from '../model/editor'
import { pageRenderSource, type ExternalDocuments } from './pageSource'

export interface PageMatches {
  pageId: string
  /** 1-based position of the page in the current document order. */
  pageNumber: number
  matches: number
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

/** Case-insensitive, non-overlapping occurrence count. */
export function countMatches(text: string, query: string): number {
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  if (needle.length === 0) return 0
  let count = 0
  let position = haystack.indexOf(needle)
  while (position !== -1) {
    count += 1
    position = haystack.indexOf(needle, position + needle.length)
  }
  return count
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
    const matches = countMatches(text, clean)
    if (matches > 0) results.push({ pageId: page.id, pageNumber: index + 1, matches })
  }
  return results
}
