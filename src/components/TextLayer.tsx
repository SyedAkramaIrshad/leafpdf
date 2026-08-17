import { useEffect, useRef } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage } from '../model/editor'
import { pageRenderSource, type ExternalDocuments } from '../pdf/pageSource'

interface TextLayerProps {
  pdf: PDFDocumentProxy
  page: EditorPage
  externalDocuments: ExternalDocuments
  zoom: number
}

/**
 * pdf.js's selectable text layer: invisible spans positioned exactly over the
 * painted glyphs, so the source document's text can be selected, copied, and
 * read by assistive technology. Without this the page is only a picture.
 */
export function TextLayer({ pdf, page, externalDocuments, zoom }: TextLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
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
        // pdf.js positions spans against this variable; without it every span
        // lands at the wrong place at any zoom other than exactly 1.
        container.style.setProperty('--scale-factor', String(viewport.scale))
        const textLayer = new PdfJsTextLayer({
          textContentSource: sourcePage.streamTextContent(),
          container,
          viewport,
        })
        layer = textLayer
        await textLayer.render()
      } catch {
        // A page whose text cannot be extracted (or a cancelled render) simply
        // offers no selection; viewing and annotating are unaffected.
      }
    }
    void render()
    return () => {
      cancelled = true
      layer?.cancel()
    }
  }, [pdf, page, externalDocuments, zoom])

  return <div ref={containerRef} className="text-layer" />
}
