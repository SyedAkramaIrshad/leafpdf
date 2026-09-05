import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorAction, EditorPage } from '../model/editor'
import { movePageToIndex } from '../model/pageReorder'
import { pageRenderSource, type ExternalDocuments } from '../pdf/pageSource'
import { isRenderCancellation } from '../pdf/renderLifecycle'
import { useModalDialog } from './useModalDialog'

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
  onClose: () => void
  dispatch: (action: EditorAction) => void
}

interface PageDragState {
  pageId: string
  pointerId: number
  startIndex: number
  previewPages: EditorPage[]
}

export function PageRail({ pdf, pages, selectedPageId, externalDocuments, onInsertBlankPage, onInsertPdf, onSelectPage, onClose, dispatch }: PageRailProps) {
  const insertInputRef = useRef<HTMLInputElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const thumbnailListRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<PageDragState | null>(null)
  const [drag, setDrag] = useState<PageDragState | null>(null)
  const [reorderNotice, setReorderNotice] = useState('')
  const dialogRef = useModalDialog<HTMLElement>({ onEscape: onClose, initialFocusRef: closeButtonRef })
  const displayedPages = drag?.previewPages ?? pages

  const setCurrentDrag = (next: PageDragState | null) => {
    dragRef.current = next
    setDrag(next)
  }

  const startReorder = (event: ReactPointerEvent<HTMLButtonElement>, pageId: string, index: number) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const next = { pageId, pointerId: event.pointerId, startIndex: index, previewPages: pages }
    setCurrentDrag(next)
    setReorderNotice(`Moving page ${index + 1}. Drag to its new position.`)
  }

  const previewReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current
    const list = thumbnailListRef.current
    if (!current || current.pointerId !== event.pointerId || !list) return
    event.preventDefault()
    const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-page-reorder-id]'))
    if (cards.length === 0) return
    let targetIndex = cards.length - 1
    for (let index = 0; index < cards.length; index += 1) {
      const bounds = cards[index].getBoundingClientRect()
      if (event.clientY < bounds.top + bounds.height / 2) {
        targetIndex = index
        break
      }
    }
    const listBounds = list.getBoundingClientRect()
    if (event.clientY < listBounds.top + 56) list.scrollTop -= 20
    else if (event.clientY > listBounds.bottom - 56) list.scrollTop += 20

    const previewPages = movePageToIndex(current.previewPages, current.pageId, targetIndex)
    if (previewPages === current.previewPages) return
    const next = { ...current, previewPages }
    setCurrentDrag(next)
    const originalPage = pages.findIndex((page) => page.id === current.pageId) + 1
    setReorderNotice(`Page ${originalPage} will move to position ${targetIndex + 1}.`)
  }

  const finishReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const targetIndex = current.previewPages.findIndex((page) => page.id === current.pageId)
    const originalPage = pages.findIndex((page) => page.id === current.pageId) + 1
    setCurrentDrag(null)
    if (targetIndex < 0 || targetIndex === current.startIndex) {
      setReorderNotice('Page order unchanged.')
      return
    }
    dispatch({ type: 'movePageToIndex', pageId: current.pageId, targetIndex })
    setReorderNotice(`Moved page ${originalPage} to position ${targetIndex + 1}. Undo reverses it.`)
  }

  const cancelReorder = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragRef.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    setCurrentDrag(null)
    setReorderNotice('Page reorder cancelled.')
  }

  return (
    <aside
      ref={dialogRef}
      id="document-pages"
      className="page-rail"
      role="dialog"
      aria-modal="true"
      aria-label="Document pages"
    >
      <header className="page-rail-heading">
        <h2><span>Pages</span><strong aria-label={`${pages.length} pages`}>{pages.length}</strong></h2>
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close page organizer">
          <span aria-hidden="true">×</span>
        </button>
      </header>
      <div className="page-insert-actions">
        <button type="button" onClick={onInsertBlankPage} title="Insert a blank page after the selected page">+ Blank page</button>
        <button type="button" onClick={() => insertInputRef.current?.click()} title="Insert every page of another PDF after the selected page">+ Insert PDF</button>
        <input
          ref={insertInputRef}
          className="visually-hidden"
          hidden
          type="file"
          accept="application/pdf,.pdf"
          aria-label="Choose a PDF to insert"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onInsertPdf(file)
            event.target.value = ''
          }}
        />
      </div>
      <p id="page-reorder-help" className="page-reorder-help">
        <span aria-hidden="true">⠿</span> Drag grip · arrows move one step
      </p>
      <span className="visually-hidden" role="status" aria-live="polite">{reorderNotice}</span>
      <div ref={thumbnailListRef} className="thumbnail-list">
        {displayedPages.map((page, index) => (
          <div
            key={page.id}
            data-page-reorder-id={page.id}
            className={`thumbnail-card ${selectedPageId === page.id ? 'is-selected' : ''} ${drag?.pageId === page.id ? 'is-dragging' : ''}`}
          >
            <button
              type="button"
              tabIndex={-1}
              className="page-drag-handle"
              aria-label={`Drag page ${index + 1} to reorder`}
              aria-describedby="page-reorder-help"
              aria-pressed={drag?.pageId === page.id}
              onPointerDown={(event) => startReorder(event, page.id, index)}
              onPointerMove={previewReorder}
              onPointerUp={finishReorder}
              onPointerCancel={cancelReorder}
            >
              <span aria-hidden="true">⠿</span>
            </button>
            <button
              type="button"
              className="thumbnail-preview"
              aria-label={`Select page ${index + 1}`}
              aria-current={selectedPageId === page.id ? 'page' : undefined}
              onClick={() => onSelectPage(page.id)}
            >
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
