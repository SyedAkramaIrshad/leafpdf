import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Annotation, EditorAction, EditorPage, FormValue, NormalizedPoint, Tool } from '../model/editor'
import type {
  FormFieldFocusRequest,
  FormFieldTarget,
  FormWidgetLoader,
} from '../model/formNavigation'
import type { MediaSurfaceSize, PendingMediaPlacement } from '../model/mediaPlacement'
import type { PreparedDetailPlacement } from '../model/personalDetails'
import type { SearchReplacementRequest } from '../model/searchReplacement'
import { fitZoomForWidth } from '../model/zoomFit'
import type { ExternalDocuments } from '../pdf/pageSource'
import type { PageMatches, SearchCursorEntry } from '../pdf/textSearch'
import { PageCanvas } from './PageCanvas'

/**
 * How far beyond the viewport a page keeps its full editor mounted. Wide enough
 * that ordinary scrolling never shows an empty sheet, narrow enough that a
 * 100-page document holds only a handful of rendered canvases at a time.
 */
const MOUNT_MARGIN = '900px 0px'

interface PageStripProps {
  pdf: PDFDocumentProxy
  pages: EditorPage[]
  externalDocuments: ExternalDocuments
  annotations: Annotation[]
  activeTool: Tool
  selectedPageId: string
  selectedAnnotationIds: string[]
  multiSelectMode?: boolean
  onMultiSelectComplete?: () => void
  zoom: number
  fitWidth: boolean
  fitWidthRequest: number
  onFitZoom: (zoom: number) => void
  formValues: Record<string, FormValue>
  loadFormWidgets?: FormWidgetLoader
  formFieldFocusRequest?: FormFieldFocusRequest | null
  onFormFieldFocus?: (target: FormFieldTarget) => void
  onFormFocusRequestHandled?: (requestId: string) => void
  searchResults?: PageMatches[]
  activeSearchEntry?: SearchCursorEntry | null
  searchReplacementRequest?: SearchReplacementRequest | null
  onSearchReplacementHandled?: (requestId: string) => void
  onSearchReplacementUnavailable?: (requestId: string) => void
  pendingMedia?: PendingMediaPlacement | null
  onPlaceMedia?: (pageId: string, point: NormalizedPoint, surface: MediaSurfaceSize) => void
  preparedDetail?: PreparedDetailPlacement | null
  onPlacePreparedDetail?: () => void
  onPageMeasured?: (pageId: string, surface: MediaSurfaceSize) => void
  announce?: (message: string) => void
  /** The page that explicit navigation wants scrolled into view, then cleared. */
  scrollTargetPageId: string | null
  onScrolledToTarget: () => void
  dispatch: (action: EditorAction) => void
}

interface StripPageProps {
  root: HTMLElement | null
  pageNumber: number
  estimatedSize: { width: number; height: number }
  children: (mounted: boolean) => React.ReactNode
}

/**
 * Mounts its child editor only while the page is near the viewport, and keeps
 * the sheet's last measured size while unmounted so the scrollbar stays stable.
 */
function StripPage({ root, pageNumber, estimatedSize, children }: StripPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(pageNumber === 1)

  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper || typeof IntersectionObserver === 'undefined') {
      setMounted(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setMounted(entry.isIntersecting)
      },
      { root, rootMargin: MOUNT_MARGIN },
    )
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [root])

  return (
    <div
      ref={wrapperRef}
      className="strip-page"
      data-page-number={pageNumber}
      style={mounted ? undefined : { width: estimatedSize.width + 28, height: estimatedSize.height + 28 }}
    >
      {children(mounted)}
    </div>
  )
}

export function PageStrip({
  pdf,
  pages,
  externalDocuments,
  annotations,
  activeTool,
  selectedPageId,
  selectedAnnotationIds,
  multiSelectMode = false,
  onMultiSelectComplete,
  zoom,
  fitWidth,
  fitWidthRequest,
  onFitZoom,
  formValues,
  loadFormWidgets,
  formFieldFocusRequest = null,
  onFormFieldFocus,
  onFormFocusRequestHandled,
  searchResults = [],
  activeSearchEntry = null,
  searchReplacementRequest = null,
  onSearchReplacementHandled,
  onSearchReplacementUnavailable,
  pendingMedia = null,
  onPlaceMedia,
  preparedDetail = null,
  onPlacePreparedDetail,
  onPageMeasured,
  announce,
  scrollTargetPageId,
  onScrolledToTarget,
  dispatch,
}: PageStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null)
  // Sheet sizes measured as pages render, so unmounted placeholders hold their
  // real footprint instead of a guess.
  const [measuredSizes, setMeasuredSizes] = useState(() => new Map<string, { width: number; height: number; zoom: number }>())
  const recordMeasurement = (pageId: string, size: MediaSurfaceSize, renderedAtZoom: number) => {
    onPageMeasured?.(pageId, size)
    setMeasuredSizes((current) => {
      const previous = current.get(pageId)
      if (
        previous
        && previous.width === size.width
        && previous.height === size.height
        && previous.zoom === renderedAtZoom
      ) return current
      const next = new Map(current)
      next.set(pageId, { ...size, zoom: renderedAtZoom })
      return next
    })
  }
  // Until a page of a document has rendered, placeholders assume US Letter; the
  // first real measurement becomes the default for the document's other sheets.
  const fallbackSize = measuredSizes.values().next().value ?? { width: 612 * 1.16, height: 792 * 1.16 }

  useEffect(() => {
    setScrollRoot(scrollRef.current)
  }, [])

  useEffect(() => {
    if (!fitWidth) return
    const root = scrollRef.current
    if (!root) return

    const selectedWrapper = Array.from(root.querySelectorAll<HTMLElement>('[data-page-id]'))
      .find((element) => element.dataset.pageId === selectedPageId)
    const surface = selectedWrapper?.querySelector<HTMLElement>('.page-surface') ?? null
    const mat = surface?.closest<HTMLElement>('.page-mat') ?? null
    const measured = measuredSizes.get(selectedPageId)
    if (!surface || !mat || !measured) return

    const cssPixels = (value: string) => {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    const fit = () => {
      const rootStyle = window.getComputedStyle(root)
      const matStyle = window.getComputedStyle(mat)
      const horizontalInsets = (
        cssPixels(rootStyle.paddingLeft)
        + cssPixels(rootStyle.paddingRight)
        + cssPixels(matStyle.paddingLeft)
        + cssPixels(matStyle.paddingRight)
      )
      const nextZoom = fitZoomForWidth({
        currentZoom: measured.zoom,
        renderedPageWidth: measured.width,
        viewportWidth: root.clientWidth || root.getBoundingClientRect().width,
        horizontalInsets,
      })
      if (Math.abs(nextZoom - zoom) >= 0.001) onFitZoom(nextZoom)
    }

    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(root)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [fitWidth, fitWidthRequest, measuredSizes, onFitZoom, selectedPageId, zoom])

  // Explicit navigation (page rail, search, insertion) scrolls to its target.
  // Scroll-driven `viewPage` updates never come through here, so the two cannot
  // fight over the scroll position.
  useEffect(() => {
    if (!scrollTargetPageId) return
    const target = scrollRef.current?.querySelector(`[data-page-id="${scrollTargetPageId}"]`)
    target?.scrollIntoView({ block: 'start' })
    onScrolledToTarget()
  }, [scrollTargetPageId, onScrolledToTarget])

  // The page crossing the middle band of the viewport becomes the current page.
  useEffect(() => {
    const root = scrollRoot
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const pageId = entry.target.getAttribute('data-page-id')
          if (pageId) dispatch({ type: 'viewPage', pageId })
        }
      },
      // A band around the viewport centre: only the page occupying it matches.
      { root, rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    for (const wrapper of Array.from(root.querySelectorAll('[data-page-id]'))) {
      observer.observe(wrapper)
    }
    return () => observer.disconnect()
  }, [scrollRoot, pages, dispatch])

  const sizeFor = (page: EditorPage) => {
    const measured = measuredSizes.get(page.id)
    if (measured) return measured
    if (page.kind === 'blank') {
      const sideways = page.rotation === 90 || page.rotation === 270
      return {
        width: (sideways ? page.height : page.width) * 1.16 * zoom,
        height: (sideways ? page.width : page.height) * 1.16 * zoom,
      }
    }
    return fallbackSize
  }

  return (
    <div className="canvas-scroll" ref={scrollRef}>
      {pages.map((page, index) => (
        <div key={page.id} data-page-id={page.id}>
          <StripPage
            root={scrollRoot}
            pageNumber={index + 1}
            estimatedSize={sizeFor(page)}
          >
            {(mounted) => mounted
              ? (
                <PageCanvas
                  pdf={pdf}
                  page={page}
                  pageNumber={index + 1}
                  externalDocuments={externalDocuments}
                  annotations={annotations.filter((annotation) => annotation.pageId === page.id)}
                  allAnnotations={annotations}
                  activeTool={activeTool}
                  selectedAnnotationIds={selectedAnnotationIds}
                  multiSelectMode={multiSelectMode}
                  onMultiSelectComplete={onMultiSelectComplete}
                  zoom={zoom}
                  formValues={formValues}
                  loadFormWidgets={loadFormWidgets}
                  formFieldFocusRequest={formFieldFocusRequest?.pageId === page.id
                    ? formFieldFocusRequest
                    : null}
                  onFormFieldFocus={onFormFieldFocus}
                  onFormFocusRequestHandled={onFormFocusRequestHandled}
                  searchOccurrences={searchResults.find((result) => result.pageId === page.id)?.occurrences ?? []}
                  activeSearchOccurrence={activeSearchEntry?.pageId === page.id
                    ? activeSearchEntry.occurrence
                    : null}
                  searchReplacementRequest={searchReplacementRequest?.pageId === page.id
                    ? searchReplacementRequest
                    : null}
                  onSearchReplacementHandled={onSearchReplacementHandled}
                  onSearchReplacementUnavailable={onSearchReplacementUnavailable}
                  pendingMedia={pendingMedia}
                  onPlaceMedia={onPlaceMedia}
                  preparedDetail={preparedDetail}
                  onPlacePreparedDetail={onPlacePreparedDetail}
                  announce={announce}
                  dispatch={dispatch}
                  onMeasured={(size, renderedAtZoom) => recordMeasurement(page.id, size, renderedAtZoom)}
                />
              )
              : null}
          </StripPage>
        </div>
      ))}
    </div>
  )
}
