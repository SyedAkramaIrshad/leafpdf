import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { DEFAULT_ADDED_TEXT, annotationId, type Annotation, type EditorAction, type EditorPage, type FormValue, type NormalizedPoint, type ShapeTool, type StampTool, type TextMarkStyle, type Tool } from '../model/editor'
import { createCreatedFormField } from '../model/createdFormFields'
import { createDateStampValue } from '../model/dateStamp'
import { normalizePoint, normalizeRect } from '../model/geometry'
import type {
  FormFieldFocusRequest,
  FormFieldTarget,
  FormWidgetLoader,
} from '../model/formNavigation'
import { mediaPlacementBounds, type MediaSurfaceSize, type PendingMediaPlacement } from '../model/mediaPlacement'
import type { PreparedDetailPlacement } from '../model/personalDetails'
import {
  searchReplacementMatchesOccurrence,
  type SearchReplacementRequest,
} from '../model/searchReplacement'
import {
  fitSourceReplacementWidth,
  sourceReplacementAnnotations,
  type SourceTextSelection,
} from '../model/sourceTextReplacement'
import { pageRenderSource, type ExternalDocuments } from '../pdf/pageSource'
import { isRenderCancellation, PAGE_RENDER_ERROR } from '../pdf/renderLifecycle'
import type { TextOccurrence } from '../pdf/textSearch'
import { CSS_FONT_STACKS } from '../pdf/textTypography'
import { AnnotationLayer } from './AnnotationLayer'
import { FormLayer } from './FormLayer'
import { SourceTextReplaceAction } from './SourceTextReplaceAction'
import { TextLayer } from './TextLayer'
import { useSourceTextSelection } from './useSourceTextSelection'

/** Physical-pixel ceiling for one page canvas, about 16 megapixels. */
const PIXEL_BUDGET = 16_000_000
const SHAPE_TOOLS: ShapeTool[] = ['rectangle', 'ellipse', 'line', 'arrow']
const STAMP_TOOLS: StampTool[] = ['check', 'cross', 'dot', 'date']
const TEXT_MARK_TOOLS: Tool[] = ['highlight', 'underline', 'strikeout']
const CREATED_FORM_TOOLS: Tool[] = ['form-text', 'form-checkbox', 'form-radio', 'form-dropdown']

function measuredReplacementTextWidth(
  selection: SourceTextSelection,
  replacementText: string,
  zoom: number,
  surfaceWidth: number,
): number {
  const context = document.createElement('canvas').getContext('2d')
  if (context) {
    context.font = `${selection.fontStyle} ${selection.fontWeight} ${selection.fontSize * 1.16 * zoom}px ${CSS_FONT_STACKS[selection.fontFamily]}`
    const measured = context.measureText(replacementText).width
    if (Number.isFinite(measured) && measured > 0) return measured
  }
  const sourceLength = Math.max(1, Array.from(selection.text).length)
  const replacementLength = Math.max(1, Array.from(replacementText).length)
  return selection.bounds.width * surfaceWidth * (replacementLength / sourceLength)
}

interface PageCanvasProps {
  pdf: PDFDocumentProxy
  page: EditorPage
  /** 1-based position of this page in the current document order. */
  pageNumber: number
  externalDocuments: ExternalDocuments
  annotations: Annotation[]
  /** Full document annotation list, used only to generate unique form-field names. */
  allAnnotations?: Annotation[]
  activeTool: Tool
  selectedAnnotationIds: string[]
  multiSelectMode?: boolean
  onMultiSelectComplete?: () => void
  zoom: number
  formValues: Record<string, FormValue>
  loadFormWidgets?: FormWidgetLoader
  formFieldFocusRequest?: FormFieldFocusRequest | null
  onFormFieldFocus?: (target: FormFieldTarget) => void
  onFormFocusRequestHandled?: (requestId: string) => void
  searchOccurrences?: TextOccurrence[]
  activeSearchOccurrence?: TextOccurrence | null
  searchReplacementRequest?: SearchReplacementRequest | null
  onSearchReplacementHandled?: (requestId: string) => void
  onSearchReplacementUnavailable?: (requestId: string) => void
  dispatch: (action: EditorAction) => void
  pendingMedia?: PendingMediaPlacement | null
  onPlaceMedia?: (pageId: string, point: NormalizedPoint, surface: MediaSurfaceSize) => void
  preparedDetail?: PreparedDetailPlacement | null
  onPlacePreparedDetail?: () => void
  announce?: (message: string) => void
  /** Reports the sheet's CSS size so the page strip can size placeholders. */
  onMeasured?: (size: { width: number; height: number }, renderedAtZoom: number) => void
}

export function PageCanvas({
  pdf,
  page,
  pageNumber,
  externalDocuments,
  annotations,
  allAnnotations = annotations,
  activeTool,
  selectedAnnotationIds,
  multiSelectMode = false,
  onMultiSelectComplete,
  zoom,
  formValues,
  loadFormWidgets,
  formFieldFocusRequest = null,
  onFormFieldFocus,
  onFormFocusRequestHandled,
  searchOccurrences = [],
  activeSearchOccurrence = null,
  searchReplacementRequest = null,
  onSearchReplacementHandled,
  onSearchReplacementUnavailable,
  dispatch,
  pendingMedia = null,
  onPlaceMedia,
  preparedDetail = null,
  onPlacePreparedDetail,
  announce,
  onMeasured,
}: PageCanvasProps) {
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
  const [mediaHoverPoint, setMediaHoverPoint] = useState<NormalizedPoint | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [reducedQuality, setReducedQuality] = useState(false)
  const pendingMediaTool = pendingMedia?.role === 'signature' ? 'signature' : 'image'
  const mediaPlacementActive = pendingMedia !== null && activeTool === pendingMediaTool
  const processedSearchReplacement = useRef<string | null>(null)
  const {
    selection: sourceSelection,
    sourceOccurrence,
    clear: clearSourceSelection,
  } = useSourceTextSelection({
    active: activeTool === 'select',
    pageId: page.id,
    zoom,
    surfaceRef,
    canvasRef,
  })

  useEffect(() => {
    const request = searchReplacementRequest
    if (!request || request.pageId !== page.id || !sourceSelection
      || processedSearchReplacement.current === request.id
      || !searchReplacementMatchesOccurrence(sourceOccurrence, request)) return
    const fittedSelection = fitSourceReplacementWidth(
      sourceSelection,
      request.replacementText,
      dimensions.width,
      measuredReplacementTextWidth(sourceSelection, request.replacementText, zoom, dimensions.width),
    )
    const replacements = sourceReplacementAnnotations(fittedSelection, annotationId)
    if (replacements.length === 0) {
      onSearchReplacementUnavailable?.(request.id)
      return
    }
    processedSearchReplacement.current = request.id
    dispatch({
      type: 'addAnnotations',
      annotations: replacements,
      historyGroup: request.historyGroup,
      selectLast: false,
    })
    clearSourceSelection()
    onSearchReplacementHandled?.(request.id)
  }, [
    clearSourceSelection,
    dispatch,
    dimensions.width,
    onSearchReplacementHandled,
    onSearchReplacementUnavailable,
    page.id,
    searchReplacementRequest,
    sourceOccurrence,
    sourceSelection,
    zoom,
  ])

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
          onMeasuredRef.current?.({ width, height }, zoom)
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
        onMeasuredRef.current?.({ width: viewport.width, height: viewport.height }, zoom)
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
    if (!mediaPlacementActive && activeTool !== 'text' && !CREATED_FORM_TOOLS.includes(activeTool) && !TEXT_MARK_TOOLS.includes(activeTool) && activeTool !== 'link' && activeTool !== 'whiteout' && activeTool !== 'redact' && !SHAPE_TOOLS.includes(activeTool as ShapeTool) && !STAMP_TOOLS.includes(activeTool as StampTool)) return
    const point = pointFromEvent(event)
    if (!point) return
    if (mediaPlacementActive) {
      setMediaHoverPoint(null)
      onPlaceMedia?.(page.id, point, dimensions)
      return
    }
    if (activeTool === 'text') {
      const width = preparedDetail?.width ?? 0.32
      const height = preparedDetail?.height ?? 0.07
      dispatch({
        type: 'addAnnotation',
        annotation: {
          id: annotationId(), pageId: page.id, kind: 'text', x: point.x, y: point.y,
          width, height,
          text: preparedDetail?.text ?? DEFAULT_ADDED_TEXT,
          color: '#182026', fontSize: preparedDetail?.fontSize ?? 18,
        },
      })
      if (preparedDetail) onPlacePreparedDetail?.()
      return
    }
    if (STAMP_TOOLS.includes(activeTool as StampTool)) {
      const stamp = activeTool as StampTool
      const width = stamp === 'date' ? 0.22 : 0.055
      const height = stamp === 'date' ? 0.05 : 0.045
      const dateDetails = stamp === 'date' ? createDateStampValue(new Date()) : null
      dispatch({
        type: 'addAnnotation',
        annotation: {
          id: annotationId(), pageId: page.id, kind: 'stamp', stamp,
          x: Math.min(1 - width, point.x), y: Math.min(1 - height, point.y),
          width, height, ...(dateDetails ?? {}),
          color: '#182026', strokeWidth: 2.5,
        },
      })
      return
    }
    const start = dragStart ?? point
    const bounds = surfaceRef.current?.getBoundingClientRect()
    if (!bounds) return
    const formFieldTool = CREATED_FORM_TOOLS.includes(activeTool)
    const squareFieldTool = activeTool === 'form-checkbox' || activeTool === 'form-radio'
    const dropdownFieldTool = activeTool === 'form-dropdown'
    const draggedWidth = Math.abs(point.x - start.x) * bounds.width
    const draggedHeight = Math.abs(point.y - start.y) * bounds.height
    const checkboxSize = Math.max(draggedWidth, draggedHeight, 28)
    const rect = normalizeRect({
      x: Math.min(start.x, point.x) * bounds.width,
      y: Math.min(start.y, point.y) * bounds.height,
      width: squareFieldTool ? checkboxSize : Math.max(draggedWidth, dropdownFieldTool ? 90 : 60),
      height: squareFieldTool ? checkboxSize : Math.max(draggedHeight, formFieldTool ? 28 : 22),
    }, bounds)
    if (formFieldTool) {
      dispatch({
        type: 'addAnnotation',
        annotation: createCreatedFormField({
          id: annotationId(),
          pageId: page.id,
          fieldType: activeTool === 'form-checkbox'
            ? 'checkbox'
            : activeTool === 'form-radio' ? 'radio' : activeTool === 'form-dropdown' ? 'dropdown' : 'text',
          ...rect,
          annotations: allAnnotations,
        }),
      })
    } else if (TEXT_MARK_TOOLS.includes(activeTool)) {
      const mark = activeTool as TextMarkStyle
      const color = mark === 'highlight' ? '#ffd447' : mark === 'underline' ? '#3157d5' : '#b54434'
      dispatch({
        type: 'addAnnotation',
        annotation: {
          id: annotationId(), pageId: page.id, kind: 'highlight', mark, ...rect,
          color, opacity: mark === 'highlight' ? 0.42 : 1,
          ...(mark === 'highlight' ? {} : { strokeWidth: 2 }),
        },
      })
    } else if (activeTool === 'link') {
      dispatch({
        type: 'addAnnotation',
        annotation: {
          id: annotationId(), pageId: page.id, kind: 'link', ...rect,
          targetType: 'url', target: '',
        },
      })
    } else if (activeTool === 'whiteout') {
      dispatch({
        type: 'addAnnotation',
        annotation: { id: annotationId(), pageId: page.id, kind: 'whiteout', ...rect },
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

  const mediaPreviewBounds = pendingMedia && mediaHoverPoint
    ? mediaPlacementBounds(pendingMedia, mediaHoverPoint, dimensions)
    : null
  const sourceActionPosition = sourceSelection
    ? (() => {
        const actionWidth = Math.min(190, Math.max(0, dimensions.width - 16))
        const left = Math.max(8, Math.min(
          dimensions.width - actionWidth - 8,
          sourceSelection.bounds.x * dimensions.width,
        ))
        const selectionTop = sourceSelection.bounds.y * dimensions.height
        const selectionBottom = (sourceSelection.bounds.y + sourceSelection.bounds.height) * dimensions.height
        const top = selectionTop >= 64
          ? selectionTop - 58
          : Math.min(dimensions.height - 58, selectionBottom + 8)
        return { left, top: Math.max(8, top) }
      })()
    : null

  const replaceSourceSelection = () => {
    if (!sourceSelection) return
    const replacements = sourceReplacementAnnotations(sourceSelection, annotationId)
    const replacement = replacements.at(-1)
    if (!replacement || replacement.kind !== 'text') return
    dispatch({ type: 'selectPage', pageId: sourceSelection.pageId })
    dispatch({
      type: 'addAnnotations',
      annotations: replacements,
      historyGroup: `annotation-${replacement.id}-text`,
    })
    clearSourceSelection()
    announce?.('Visual replacement added. The source text remains underneath; use Redact to remove content permanently.')
  }

  return (
    <div className="page-mat" role="group" aria-label={`Page ${pageNumber} editor`}>
      <div
        ref={surfaceRef}
        className="page-surface"
        style={{ width: dimensions.width, height: dimensions.height }}
        onPointerDown={CREATED_FORM_TOOLS.includes(activeTool) || TEXT_MARK_TOOLS.includes(activeTool) || activeTool === 'link' || activeTool === 'whiteout' || activeTool === 'redact' || SHAPE_TOOLS.includes(activeTool as ShapeTool) ? (event) => setDragStart(pointFromEvent(event)) : undefined}
        onPointerMove={mediaPlacementActive ? (event) => setMediaHoverPoint(pointFromEvent(event)) : undefined}
        onPointerLeave={mediaPlacementActive ? () => setMediaHoverPoint(null) : undefined}
      >
        <canvas ref={canvasRef} aria-label="Rendered PDF page" />
        <TextLayer
          pdf={pdf}
          page={page}
          externalDocuments={externalDocuments}
          zoom={zoom}
          searchOccurrences={searchOccurrences}
          activeSearchOccurrence={searchReplacementRequest?.occurrence ?? activeSearchOccurrence}
          selectionRequest={searchReplacementRequest}
          onSelectionUnavailable={onSearchReplacementUnavailable}
        />
        {renderError && <p className="page-render-error" role="alert">{renderError}</p>}
        {reducedQuality && !renderError && (
          <p className="page-quality-notice" role="status">Preview quality reduced for this large page</p>
        )}
        <AnnotationLayer
          annotations={annotations}
          activeTool={activeTool}
          selectedAnnotationIds={selectedAnnotationIds}
          multiSelectMode={multiSelectMode}
          onMultiSelectComplete={onMultiSelectComplete}
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
          loadFormWidgets={loadFormWidgets}
          focusRequest={formFieldFocusRequest}
          onFormFieldFocus={onFormFieldFocus}
          onFormFocusRequestHandled={onFormFocusRequestHandled}
        />
        {sourceSelection && sourceActionPosition && (
          <SourceTextReplaceAction
            left={sourceActionPosition.left}
            top={sourceActionPosition.top}
            onReplace={replaceSourceSelection}
          />
        )}
        {pendingMedia && mediaPreviewBounds && mediaPlacementActive && (
          <div
            className="media-placement-preview"
            data-media-role={pendingMediaTool}
            role="img"
            aria-label={`${pendingMediaTool === 'signature' ? 'Signature' : 'Image'} placement preview`}
            style={{
              left: `${mediaPreviewBounds.x * 100}%`,
              top: `${mediaPreviewBounds.y * 100}%`,
              width: `${mediaPreviewBounds.width * 100}%`,
              height: `${mediaPreviewBounds.height * 100}%`,
            }}
          >
            <span>{pendingMediaTool.toUpperCase()}</span>
            <img src={pendingMedia.dataUrl} alt="" />
          </div>
        )}
      </div>
    </div>
  )
}
