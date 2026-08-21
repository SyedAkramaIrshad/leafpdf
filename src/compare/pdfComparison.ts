import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface PageComparison {
  pageNumber: number
  status: 'same' | 'changed' | 'left-only' | 'right-only'
  added: string[]
  removed: string[]
  similarity: number
}

export interface PdfComparisonResult {
  leftPages: number
  rightPages: number
  changedPages: number
  pages: PageComparison[]
}

function textItem(value: unknown): value is { str: string; hasEOL?: boolean } {
  return typeof value === 'object' && value !== null && 'str' in value
    && typeof (value as { str?: unknown }).str === 'string'
}

export async function extractPdfPageLines(pdf: PDFDocumentProxy): Promise<string[][]> {
  const pages: string[][] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const lines: string[] = []
    let current = ''
    for (const item of content.items) {
      if (!textItem(item)) continue
      const next = item.str.trim()
      if (next) current = current ? `${current} ${next}` : next
      if (item.hasEOL && current) {
        lines.push(current.replace(/\s+/g, ' ').trim())
        current = ''
      }
    }
    if (current) lines.push(current.replace(/\s+/g, ' ').trim())
    pages.push(lines.filter(Boolean))
  }
  return pages
}

/** A bounded LCS diff. Large pages fall back to set comparison to avoid quadratic stalls. */
export function compareLines(left: string[], right: string[]): Pick<PageComparison, 'added' | 'removed' | 'similarity'> {
  if (left.length * right.length > 250_000) {
    const leftSet = new Set(left)
    const rightSet = new Set(right)
    const removed = left.filter((line) => !rightSet.has(line))
    const added = right.filter((line) => !leftSet.has(line))
    const common = Math.max(0, Math.max(left.length, right.length) - Math.max(removed.length, added.length))
    return {
      added,
      removed,
      similarity: Math.max(left.length, right.length) === 0 ? 1 : common / Math.max(left.length, right.length),
    }
  }

  const rows = left.length + 1
  const columns = right.length + 1
  const table = Array.from({ length: rows }, () => new Uint16Array(columns))
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const added: string[] = []
  const removed: string[] = []
  let i = 0
  let j = 0
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      removed.push(left[i])
      i += 1
    } else {
      added.push(right[j])
      j += 1
    }
  }
  while (i < left.length) removed.push(left[i++])
  while (j < right.length) added.push(right[j++])

  const common = table[0][0]
  return {
    added,
    removed,
    similarity: Math.max(left.length, right.length) === 0 ? 1 : common / Math.max(left.length, right.length),
  }
}

export async function comparePdfText(
  leftPdf: PDFDocumentProxy,
  rightPdf: PDFDocumentProxy,
): Promise<PdfComparisonResult> {
  const [leftPages, rightPages] = await Promise.all([
    extractPdfPageLines(leftPdf),
    extractPdfPageLines(rightPdf),
  ])
  const count = Math.max(leftPages.length, rightPages.length)
  const pages: PageComparison[] = []
  for (let index = 0; index < count; index += 1) {
    const left = leftPages[index]
    const right = rightPages[index]
    if (!left) {
      pages.push({ pageNumber: index + 1, status: 'right-only', added: right ?? [], removed: [], similarity: 0 })
      continue
    }
    if (!right) {
      pages.push({ pageNumber: index + 1, status: 'left-only', added: [], removed: left, similarity: 0 })
      continue
    }
    const difference = compareLines(left, right)
    pages.push({
      pageNumber: index + 1,
      status: difference.added.length === 0 && difference.removed.length === 0 ? 'same' : 'changed',
      ...difference,
    })
  }
  return {
    leftPages: leftPages.length,
    rightPages: rightPages.length,
    changedPages: pages.filter((page) => page.status !== 'same').length,
    pages,
  }
}
