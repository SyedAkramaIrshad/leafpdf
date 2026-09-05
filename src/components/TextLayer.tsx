import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { EditorPage } from '../model/editor'
import type { SearchReplacementRequest } from '../model/searchReplacement'
import { pageRenderSource, type ExternalDocuments } from '../pdf/pageSource'
import type { TextOccurrence } from '../pdf/textSearch'

interface TextLayerProps {
  pdf: PDFDocumentProxy
  page: EditorPage
  externalDocuments: ExternalDocuments
  zoom: number
  searchOccurrences: TextOccurrence[]
  activeSearchOccurrence: TextOccurrence | null
  selectionRequest?: SearchReplacementRequest | null
  onSelectionUnavailable?: (requestId: string) => void
}

interface SourceFontObject {
  black?: boolean
  bold?: boolean
  italic?: boolean
}

type SourceTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>
type SourceTextItem = Extract<SourceTextContent['items'][number], { str: string }>

function textNodeForSpan(span: HTMLElement): Text | null {
  return Array.from(span.childNodes).find((node): node is Text => node.nodeType === Node.TEXT_NODE) ?? null
}

/** Build one browser Range from the same UTF-16 offsets returned by text search. */
export function rangeForOccurrence(container: HTMLElement, occurrence: TextOccurrence): Range | null {
  if (!Number.isFinite(occurrence.start) || !Number.isFinite(occurrence.end)
    || occurrence.start < 0 || occurrence.end <= occurrence.start) return null
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (const span of container.querySelectorAll<HTMLElement>('span[role="presentation"]')) {
    const spanStart = Number(span.dataset.sourceTextStart)
    const spanEnd = Number(span.dataset.sourceTextEnd)
    if (!Number.isFinite(spanStart) || !Number.isFinite(spanEnd)) continue
    if (occurrence.end <= spanStart || occurrence.start >= spanEnd) continue
    const textNode = textNodeForSpan(span)
    const textLength = textNode?.textContent?.length ?? 0
    if (!textNode || textLength === 0) continue
    const overlapStart = Math.max(0, Math.min(textLength, Math.max(occurrence.start, spanStart) - spanStart))
    const overlapEnd = Math.max(0, Math.min(textLength, Math.min(occurrence.end, spanEnd) - spanStart))
    if (overlapEnd <= overlapStart) continue
    if (!startNode) {
      startNode = textNode
      startOffset = overlapStart
    }
    endNode = textNode
    endOffset = overlapEnd
  }

  if (!startNode || !endNode) return null
  const range = document.createRange()
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

async function collectTextItems(reader: ReadableStreamDefaultReader<SourceTextContent>): Promise<SourceTextItem[]> {
  const items: SourceTextItem[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) return items
    for (const item of value.items) {
      if ('str' in item) items.push(item)
    }
  }
}

function attachSourceFontMetadata(
  sourcePage: PDFPageProxy,
  container: HTMLElement,
  items: SourceTextItem[],
  cancelled: () => boolean,
) {
  const spans = Array.from(container.querySelectorAll<HTMLElement>('span[role="presentation"]'))
  const spansByFont = new Map<string, HTMLElement[]>()
  let sourceOffset = 0
  let spanIndex = 0
  for (const item of items) {
    if (item.str !== '') {
      const span = spans[spanIndex]
      spanIndex += 1
      if (span) {
        span.dataset.sourceTextStart = String(sourceOffset)
        span.dataset.sourceTextEnd = String(sourceOffset + item.str.length)
        const matching = spansByFont.get(item.fontName) ?? []
        matching.push(span)
        spansByFont.set(item.fontName, matching)
      }
    }
    sourceOffset += item.str.length
    if (item.hasEOL) sourceOffset += 1
  }

  for (const [fontName, matching] of spansByFont) {
    const apply = (font: SourceFontObject) => {
      if (cancelled()) return
      const weight = font.bold || font.black ? '700' : '400'
      const style = font.italic ? 'italic' : 'normal'
      for (const span of matching) {
        span.dataset.sourceFontWeight = weight
        span.dataset.sourceFontStyle = style
      }
    }
    if (sourcePage.commonObjs.has(fontName)) apply(sourcePage.commonObjs.get(fontName))
    else sourcePage.commonObjs.get(fontName, apply)
  }
}

/**
 * pdf.js's selectable text layer: invisible spans positioned exactly over the
 * painted glyphs, so the source document's text can be selected, copied, and
 * read by assistive technology. Without this the page is only a picture.
 */
export function TextLayer({
  pdf,
  page,
  externalDocuments,
  zoom,
  searchOccurrences,
  activeSearchOccurrence,
  selectionRequest = null,
  onSelectionUnavailable,
}: TextLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchLayerRef = useRef<HTMLDivElement>(null)
  const handledSelectionRequest = useRef<string | null>(null)
  const [layerRevision, setLayerRevision] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    const searchLayer = searchLayerRef.current
    if (!container) return
    searchLayer?.replaceChildren()
    const source = pageRenderSource(page, pdf, externalDocuments)
    if (!source) {
      // A blank page has no text to select.
      container.replaceChildren()
      return
    }
    let cancelled = false
    let layer: { cancel: () => void } | null = null
    const render = async () => {
      try {
        // Loaded lazily so component modules never pull the full pdf.js bundle
        // at import time; by the time a page renders it is already in memory.
        const [{ TextLayer: PdfJsTextLayer }, sourcePage] = await Promise.all([
          import('pdfjs-dist'),
          source.pdf.getPage(source.pageNumber),
        ])
        if (cancelled) return
        // The same scale and rotation the canvas painted with, so spans align.
        const viewport = sourcePage.getViewport({ scale: 1.16 * zoom, rotation: (sourcePage.rotate + page.rotation) % 360 })
        container.replaceChildren()
        // The standalone TextLayer writes font heights in PDF points. Its viewer
        // CSS resolves those values through --total-scale-factor; without it the
        // browser falls back to 16px text, making selection rectangles wider than
        // the painted glyphs and corrupting select-to-replace geometry.
        container.style.setProperty('--scale-factor', String(viewport.scale))
        container.style.setProperty('--total-scale-factor', String(viewport.scale))
        const [renderStream, metadataStream] = sourcePage.streamTextContent().tee()
        const metadataReader = metadataStream.getReader()
        const textLayer = new PdfJsTextLayer({
          textContentSource: renderStream,
          container,
          viewport,
        })
        layer = textLayer
        const [, textItems] = await Promise.all([
          textLayer.render(),
          collectTextItems(metadataReader),
        ])
        if (!cancelled) {
          attachSourceFontMetadata(sourcePage, container, textItems, () => cancelled)
          setLayerRevision((current) => current + 1)
        }
      } catch {
        // A page whose text cannot be extracted (or a cancelled render) simply
        // offers no selection; viewing and annotating are unaffected.
        searchLayer?.replaceChildren()
      }
    }
    void render()
    return () => {
      cancelled = true
      layer?.cancel()
    }
  }, [pdf, page, externalDocuments, zoom])

  useLayoutEffect(() => {
    const container = containerRef.current
    const searchLayer = searchLayerRef.current
    if (!container || !searchLayer) return
    searchLayer.replaceChildren()
    if (searchOccurrences.length === 0) return

    const layerRect = container.getBoundingClientRect()
    const markers = document.createDocumentFragment()

    for (const occurrence of searchOccurrences) {
      const active = activeSearchOccurrence?.start === occurrence.start
        && activeSearchOccurrence.end === occurrence.end
      const range = rangeForOccurrence(container, occurrence)
      if (!range) continue
      for (const rect of range.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue
        const marker = document.createElement('span')
        marker.className = active ? 'search-match is-active' : 'search-match'
        marker.dataset.occurrenceStart = String(occurrence.start)
        marker.style.left = `${rect.left - layerRect.left - 1}px`
        marker.style.top = `${rect.top - layerRect.top - 1}px`
        marker.style.width = `${rect.width + 2}px`
        marker.style.height = `${rect.height + 2}px`
        markers.append(marker)
      }
    }
    searchLayer.append(markers)
  }, [activeSearchOccurrence, layerRevision, searchOccurrences])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !selectionRequest || layerRevision === 0
      || handledSelectionRequest.current === selectionRequest.id) return
    const range = rangeForOccurrence(container, selectionRequest.occurrence)
    handledSelectionRequest.current = selectionRequest.id
    if (!range) {
      onSelectionUnavailable?.(selectionRequest.id)
      return
    }
    const browserSelection = window.getSelection()
    if (!browserSelection) {
      onSelectionUnavailable?.(selectionRequest.id)
      return
    }
    browserSelection.removeAllRanges()
    browserSelection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  }, [layerRevision, onSelectionUnavailable, selectionRequest])

  return (
    <>
      <div ref={containerRef} className="text-layer" data-page-id={page.id} />
      <div ref={searchLayerRef} className="search-match-layer" data-page-id={page.id} aria-hidden="true" />
    </>
  )
}
