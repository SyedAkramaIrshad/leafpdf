import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorAction, EditorPage } from '../model/editor'
import { isRenderCancellation } from '../pdf/renderLifecycle'

function Thumbnail({ pdf, page, priority }: { pdf: PDFDocumentProxy; page: EditorPage; priority: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(priority)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (priority) {
      setVisible(true)
      return
    }
    const container = containerRef.current
    if (!container || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '160px 0px' },
    )
    observer.observe(container)
    return () => observer.disconnect()
  }, [priority])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null
    const renderThumbnail = async () => {
      try {
        const sourcePage = await pdf.getPage(page.sourceIndex + 1)
        const viewport = sourcePage.getViewport({ scale: 0.16, rotation: (sourcePage.rotate + page.rotation) % 360 })
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d', { alpha: false })
        if (!canvas || !context || cancelled) return
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
  }, [pdf, page.sourceIndex, page.rotation, visible])
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
  dispatch: (action: EditorAction) => void
}

export function PageRail({ pdf, pages, selectedPageId, dispatch }: PageRailProps) {
  return (
    <aside className="page-rail" aria-label="Document pages">
      <div className="page-rail-heading"><span>PAGES</span><strong>{pages.length}</strong></div>
      <div className="thumbnail-list">
        {pages.map((page, index) => (
          <div key={page.id} className={`thumbnail-card ${selectedPageId === page.id ? 'is-selected' : ''}`}>
            <button type="button" className="thumbnail-preview" aria-label={`Select page ${index + 1}`} onClick={() => dispatch({ type: 'selectPage', pageId: page.id })}>
              <Thumbnail pdf={pdf} page={page} priority={selectedPageId === page.id} />
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
