import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorAction, EditorPage } from '../model/editor'
import { pageRenderSource, type ExternalDocuments } from '../pdf/pageSource'
import { isRenderCancellation } from '../pdf/renderLifecycle'

function Thumbnail({ pdf, page, externalDocuments, priority }: {
  pdf: PDFDocumentProxy
  page: EditorPage
  externalDocuments: ExternalDocuments
  priority: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Render eagerly from the start when lazy observation is impossible.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  const [failed, setFailed] = useState(false)
  // Visibility is derived, not mirrored into state: the selected page renders
  // immediately, and any page that has scrolled into view stays rendered.
  const visible = priority || seen

  useEffect(() => {
    if (visible) return
    const container = containerRef.current
    if (!container) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin: '160px 0px' },
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null
    const renderThumbnail = async () => {
      try {
        const source = pageRenderSource(page, pdf, externalDocuments)
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d', { alpha: false })
        if (!canvas || !context || cancelled) return
        if (!source) {
          if (page.kind !== 'blank') {
            setFailed(true)
            return
          }
          const sideways = page.rotation === 90 || page.rotation === 270
          canvas.width = Math.max(1, (sideways ? page.height : page.width) * 0.16)
          canvas.height = Math.max(1, (sideways ? page.width : page.height) * 0.16)
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          setFailed(false)
          return
        }
        const sourcePage = await source.pdf.getPage(source.pageNumber)
        const viewport = sourcePage.getViewport({ scale: 0.16, rotation: (sourcePage.rotate + page.rotation) % 360 })
        if (cancelled) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        const task = sourcePage.render({ canvas, canvasContext: context, viewport })
        renderTask = task
        await task.promise
        if (!cancelled) setFailed(false)
      } catch (error) {
        if (!isRenderCancellation(error) && !cancelled) setFailed(true)
      }
    }
    void renderThumbnail()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdf, page, externalDocuments, visible])
  return (
    <div ref={containerRef} className="thumbnail-canvas">
      <canvas ref={canvasRef} />
      {failed && <span className="thumbnail-error" aria-hidden="true">!</span>}
    </div>
  )
}

interface PageRailProps {
  pdf: PDFDocumentProxy
  pages: EditorPage[]
  selectedPageId: string
  externalDocuments: ExternalDocuments
  onInsertBlankPage: () => void
  onInsertPdf: (file: File) => void
  /** Explicit navigation: selects the page and scrolls the strip to it. */
  onSelectPage: (pageId: string) => void
  dispatch: (action: EditorAction) => void
}

export function PageRail({ pdf, pages, selectedPageId, externalDocuments, onInsertBlankPage, onInsertPdf, onSelectPage, dispatch }: PageRailProps) {
  const insertInputRef = useRef<HTMLInputElement>(null)
  return (
    <aside className="page-rail" aria-label="Document pages">
      <div className="page-rail-heading"><span>PAGES</span><strong>{pages.length}</strong></div>
      <div className="page-insert-actions">
        <button type="button" onClick={onInsertBlankPage} title="Insert a blank page after the selected page">+ Blank page</button>
        <button type="button" onClick={() => insertInputRef.current?.click()} title="Insert every page of another PDF after the selected page">+ Insert PDF</button>
        <input
          ref={insertInputRef}
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Choose a PDF to insert"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onInsertPdf(file)
            event.target.value = ''
          }}
        />
      </div>
      <div className="thumbnail-list">
        {pages.map((page, index) => (
          <div key={page.id} className={`thumbnail-card ${selectedPageId === page.id ? 'is-selected' : ''}`}>
            <button type="button" className="thumbnail-preview" aria-label={`Select page ${index + 1}`} onClick={() => onSelectPage(page.id)}>
              <Thumbnail pdf={pdf} page={page} externalDocuments={externalDocuments} priority={selectedPageId === page.id} />
              <span>{String(index + 1).padStart(2, '0')}</span>
            </button>
            <div className="page-actions">
              <button type="button" aria-label={`Move page ${index + 1} up`} disabled={index === 0} onClick={() => dispatch({ type: 'movePage', pageId: page.id, direction: -1 })}>↑</button>
              <button type="button" aria-label={`Move page ${index + 1} down`} disabled={index === pages.length - 1} onClick={() => dispatch({ type: 'movePage', pageId: page.id, direction: 1 })}>↓</button>
              <button
                type="button"
                aria-label={`Rotate page ${index + 1}`}
                title="Rotate page"
                onClick={() => dispatch({ type: 'rotatePage', pageId: page.id, degrees: 90 })}
              >↻</button>
              <button type="button" aria-label={`Delete page ${index + 1}`} disabled={pages.length === 1} onClick={() => dispatch({ type: 'removePage', pageId: page.id })}>×</button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
