import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { annotationId, type Annotation, type EditorAction, type EditorPage, type FormValue, type NormalizedPoint, type ShapeTool, type StampTool, type Tool } from '../model/editor'
import { normalizePoint, normalizeRect } from '../model/geometry'
import { pageRenderSource, type ExternalDocuments } from '../pdf/pageSource'
import { isRenderCancellation, PAGE_RENDER_ERROR } from '../pdf/renderLifecycle'
import { AnnotationLayer } from './AnnotationLayer'
import { FormLayer } from './FormLayer'
import { TextLayer } from './TextLayer'

/** Physical-pixel ceiling for one page canvas, about 16 megapixels. */
const PIXEL_BUDGET = 16_000_000
const SHAPE_TOOLS: ShapeTool[] = ['rectangle', 'ellipse', 'line', 'arrow']
const STAMP_TOOLS: StampTool[] = ['check', 'cross', 'dot', 'date']

interface PageCanvasProps {
  pdf: PDFDocumentProxy
  page: EditorPage
  /** 1-based position of this page in the current document order. */
  pageNumber: number
  externalDocuments: ExternalDocuments
  annotations: Annotation[]
  activeTool: Tool
  selectedAnnotationId: string | null
  zoom: number
  formValues: Record<string, FormValue>
  dispatch: (action: EditorAction) => void
  /** Reports the sheet's CSS size so the page strip can size placeholders. */
  onMeasured?: (size: { width: number; height: number }) => void
}

export function PageCanvas({ pdf, page, pageNumber, externalDocuments, annotations, activeTool, selectedAnnotationId, zoom, formValues, dispatch, onMeasured }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 612, height: 792 })
  // Read through a ref so an inline callback never re-runs the render effect.
  const onMeasuredRef = useRef(onMeasured)
  useEffect(() => {
    onMeasuredRef.current = onMeasured
  }, [onMeasured])
  const [dragStart, setDragStart] = useState<NormalizedPoint | null>(null)
  const [draftPoints, setDraftPoints] = useState<NormalizedPoint[]>([])
  const [renderError, setRenderError] = useState<string | null>(null)
  const [reducedQuality, setReducedQuality] = useState(false)

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null
    const renderPage = async () => {
      try {
        const source = pageRenderSource(page, pdf, externalDocuments)
        if (!source) {
          if (page.kind !== 'blank') {
            // An external page whose document registry entry is gone.
            setRenderError(PAGE_RENDER_ERROR)
            return
          }
          // A blank page has nothing to rasterize: one white sheet at its
          // stored size, swapped when rotated onto its side.
          const sideways = page.rotation === 90 || page.rotation === 270
          const width = (sideways ? page.height : page.width) * 1.16 * zoom
          const height = (sideways ? page.width : page.height) * 1.16 * zoom
          setDimensions({ width, height })
          onMeasuredRef.current?.({ width, height })
          const canvas = canvasRef.current
          const context = canvas?.getContext('2d', { alpha: false })
          if (!canvas || !context) return
          canvas.width = Math.max(1, Math.floor(width))
          canvas.height = Math.max(1, Math.floor(height))
          canvas.style.width = `${width}px`
          canvas.style.height = `${height}px`
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          setReducedQuality(false)
          setRenderError(null)
          return
        }
        const sourcePage = await source.pdf.getPage(source.pageNumber)
        const rotation = (sourcePage.rotate + page.rotation) % 360
        const viewport = sourcePage.getViewport({ scale: 1.16 * zoom, rotation })
        if (cancelled) return
        setDimensions({ width: viewport.width, height: viewport.height })
        onMeasuredRef.current?.({ width: viewport.width, height: viewport.height })
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d', { alpha: false })
        if (!canvas || !context) return
        // Cap physical pixels so a poster-sized page cannot ask the browser for a
        // canvas it will refuse to allocate. Export coordinates stay based on the CSS
        // viewport, so a reduced canvas only affects preview sharpness.
        //
        // The scale must be allowed below 1: when the CSS viewport alone exceeds the
        // budget, rendering at 1 device pixel per CSS pixel is already too large.
        // Clamping the lower bound to 1 made this cap a no-op for exactly the pages
        // it exists to protect.
        const idealScale = Math.min(window.devicePixelRatio || 1, 2)
        const cssArea = viewport.width * viewport.height
        // A zero-area viewport would divide into Infinity, so fall back to the ideal
        // scale and let the 1px floors below produce a valid, tiny canvas.
        const pixelBudgetScale = cssArea > 0 ? Math.sqrt(PIXEL_BUDGET / cssArea) : idealScale
        // No lower bound on the scale: any floor here is a hole in the budget, and a
        // 0.05 floor let a 100,000px page through at 25 megapixels.
        const outputScale = Math.min(idealScale, pixelBudgetScale)
        // Flooring can round a dimension to 0 on an extreme page, and a canvas needs at
        // least 1px per side. That costs at most a single pixel row, not a budget breach.
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        // Only claim reduced quality when the budget actually forced a downgrade.
        setReducedQuality(pixelBudgetScale < idealScale)
        const task = sourcePage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        })
        renderTask = task
        await task.promise
        if (cancelled) return
        setRenderError(null)
      } catch (error) {
        if (!isRenderCancellation(error) && !cancelled) setRenderError(PAGE_RENDER_ERROR)
      }
    }
    void renderPage()
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
    // `page` is in the dependencies rather than its fields: page kinds carry
    // different fields, and a page object only changes when one of them does.
  }, [pdf, page, externalDocuments, zoom])

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = surfaceRef.current?.getBoundingClientRect()
    if (!bounds) return null
    return normalizePoint({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds)
  }

  const createSimpleAnnotation = (event: PointerEvent<HTMLDivElement>) => {
    if (activeTool !== 'text' && activeTool !== 'highlight' && activeTool !== 'redact' && !SHAPE_TOOLS.includes(activeTool as ShapeTool) && !STAMP_TOOLS.includes(activeTool as StampTool)) return
    const point = pointFromEvent(event)
    if (!point) return
    if (activeTool === 'text') {
      dispatch({
        type: 'addAnnotation',
        annotation: {
          id: annotationId(), pageId: page.id, kind: 'text', x: point.x, y: point.y,
          width: 0.32, height: 0.07, text: 'Type here', color: '#182026', fontSize: 18,
        },
      })
      return
    }
    if (STAMP_TOOLS.includes(activeTool as StampTool)) {
      const stamp = activeTool as StampTool
      const width = stamp === 'date' ? 0.22 : 0.055
      const height = stamp === 'date' ? 0.05 : 0.045
      dispatch({
        type: 'addAnnotation',
        annotation: {
          id: annotationId(), pageId: page.id, kind: 'stamp', stamp,
          x: Math.min(1 - width, point.x), y: Math.min(1 - height, point.y),
          width, height, label: stamp === 'date' ? new Intl.DateTimeFormat().format(new Date()) : undefined,
          color: '#182026', strokeWidth: 2.5,
        },
      })
      return
    }
    const start = dragStart ?? point
    const bounds = surfaceRef.current?.getBoundingClientRect()
    if (!bounds) return
    const rect = normalizeRect({
      x: Math.min(start.x, point.x) * bounds.width,
      y: Math.min(start.y, point.y) * bounds.height,
      width: Math.max(Math.abs(point.x - start.x) * bounds.width, 60),
      height: Math.max(Math.abs(point.y - start.y) * bounds.height, 22),
    }, bounds)
    if (activeTool === 'highlight') {
      dispatch({
        type: 'addAnnotation',
        annotation: { id: annotationId(), pageId: page.id, kind: 'highlight', ...rect, color: '#ffd447', opacity: 0.42 },
      })
    } else if (activeTool === 'redact') {
      dispatch({
        type: 'addAnnotation',
        annotation: { id: annotationId(), pageId: page.id, kind: 'redaction', ...rect },
      })
    } else {
      const shape = activeTool as ShapeTool
      dispatch({
        type: 'addAnnotation',
        annotation: {
          id: annotationId(), pageId: page.id, kind: 'shape', shape, ...rect,
          strokeColor: '#3157d5',
          fillColor: shape === 'rectangle' || shape === 'ellipse' ? '#dce5ff' : undefined,
          strokeWidth: 2,
        },
      })
    }
    setDragStart(null)
  }

  const drawStart = (event: PointerEvent<HTMLDivElement>) => {
    const point = pointFromEvent(event)
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraftPoints([point])
  }
  const drawMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const point = pointFromEvent(event)
    if (point) setDraftPoints((current) => [...current, point])
  }
  const drawEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (draftPoints.length > 1) {
      dispatch({
        type: 'addAnnotation',
        annotation: {
          id: annotationId(), pageId: page.id, kind: 'ink', x: 0, y: 0, width: 1, height: 1,
          points: draftPoints, color: '#3157d5', strokeWidth: 2.5,
        },
      })
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDraftPoints([])
  }

  return (
    <div className="page-mat" aria-label={`Page ${pageNumber} editor`}>
      <div
        ref={surfaceRef}
        className="page-surface"
        style={{ width: dimensions.width, height: dimensions.height }}
        onPointerDown={activeTool === 'highlight' || activeTool === 'redact' || SHAPE_TOOLS.includes(activeTool as ShapeTool) ? (event) => setDragStart(pointFromEvent(event)) : undefined}
      >
        <canvas ref={canvasRef} aria-label="Rendered PDF page" />
        <TextLayer pdf={pdf} page={page} externalDocuments={externalDocuments} zoom={zoom} />
        {renderError && <p className="page-render-error" role="alert">{renderError}</p>}
        {reducedQuality && !renderError && (
          <p className="page-quality-notice" role="status">Preview quality reduced for this large page</p>
        )}
        <AnnotationLayer
          annotations={annotations}
          activeTool={activeTool}
          selectedAnnotationId={selectedAnnotationId}
          dispatch={dispatch}
          onCreate={createSimpleAnnotation}
          onDrawStart={drawStart}
          onDrawMove={drawMove}
          onDrawEnd={drawEnd}
          draftPoints={draftPoints}
          renderScale={1.16 * zoom}
        />
        {/* Above the annotation layer so field inputs stay clickable; the layer
            itself is pointer-transparent, so tools keep working around fields. */}
        <FormLayer
          pdf={pdf}
          page={page}
          pageSize={dimensions}
          activeTool={activeTool}
          formValues={formValues}
          dispatch={dispatch}
        />
      </div>
    </div>
  )
}
