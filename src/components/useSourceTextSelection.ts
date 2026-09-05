import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { FontFamily, FontStyle, FontWeight, TextDirection } from '../model/editor'
import {
  buildSourceTextSelection,
  type ScreenRectangle,
  type SourceTextSelection,
} from '../model/sourceTextReplacement'
import type { TextOccurrence } from '../pdf/textSearch'
import { dominantTextColor } from '../pdf/textColor'

interface UseSourceTextSelectionOptions {
  active: boolean
  pageId: string
  zoom: number
  surfaceRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLCanvasElement | null>
}

interface CapturedSourceTextSelection {
  selection: SourceTextSelection | null
  sourceOccurrence: TextOccurrence | null
  clear: () => void
}

function elementForNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
}

function sourceBoundaryOffset(node: Node, offset: number, textLayer: HTMLElement): number | null {
  const element = elementForNode(node)
  const span = element?.closest<HTMLElement>('span[role="presentation"]') ?? null
  if (!span || !textLayer.contains(span)) return null
  const spanStart = Number(span.dataset.sourceTextStart)
  if (!Number.isFinite(spanStart)) return null
  if (node.nodeType === Node.TEXT_NODE) {
    const textLength = node.textContent?.length ?? 0
    return spanStart + Math.max(0, Math.min(textLength, offset))
  }
  if (node === span) {
    const childOffset = Array.from(span.childNodes)
      .slice(0, Math.max(0, offset))
      .reduce((length, child) => length + (child.textContent?.length ?? 0), 0)
    return spanStart + childOffset
  }
  return null
}

export function sourceOccurrenceForRange(range: Range, textLayer: HTMLElement): TextOccurrence | null {
  const start = sourceBoundaryOffset(range.startContainer, range.startOffset, textLayer)
  const end = sourceBoundaryOffset(range.endContainer, range.endOffset, textLayer)
  return start !== null && end !== null && end > start ? { start, end } : null
}

function sourceFontFamily(value: string): FontFamily {
  const family = value.toLowerCase()
  if (family.includes('mono') || family.includes('courier')) return 'mono'
  if (family.includes('sans') || family.includes('arial') || family.includes('helvetica')) return 'sans'
  if (family.includes('serif') || family.includes('times') || family.includes('georgia')) return 'serif'
  return 'sans'
}

function sourceFontWeight(value: string): FontWeight {
  const numeric = Number.parseInt(value, 10)
  return value === 'bold' || (Number.isFinite(numeric) && numeric >= 600) ? 700 : 400
}

function sourceFontStyle(value: string): FontStyle {
  return value === 'italic' || value === 'oblique' ? 'italic' : 'normal'
}

function sourceDirection(value: string): TextDirection {
  return value === 'rtl' ? 'rtl' : 'ltr'
}

function sampledTextColor(
  canvas: HTMLCanvasElement | null,
  rectangles: ScreenRectangle[],
): string {
  if (!canvas || rectangles.length === 0 || canvas.width <= 0 || canvas.height <= 0) return '#182026'
  const canvasBounds = canvas.getBoundingClientRect()
  if (canvasBounds.width <= 0 || canvasBounds.height <= 0) return '#182026'
  const left = Math.min(...rectangles.map((rectangle) => rectangle.left))
  const top = Math.min(...rectangles.map((rectangle) => rectangle.top))
  const right = Math.max(...rectangles.map((rectangle) => rectangle.right))
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.bottom))
  const scaleX = canvas.width / canvasBounds.width
  const scaleY = canvas.height / canvasBounds.height
  const x = Math.max(0, Math.floor((left - canvasBounds.left) * scaleX))
  const y = Math.max(0, Math.floor((top - canvasBounds.top) * scaleY))
  const width = Math.max(1, Math.min(canvas.width - x, Math.ceil((right - left) * scaleX)))
  const height = Math.max(1, Math.min(canvas.height - y, Math.ceil((bottom - top) * scaleY)))
  if (x >= canvas.width || y >= canvas.height || width <= 0 || height <= 0) return '#182026'
  try {
    const context = canvas.getContext('2d')
    return context
      ? dominantTextColor(context.getImageData(x, y, width, height).data, '#ffffff')
      : '#182026'
  } catch {
    return '#182026'
  }
}

export function useSourceTextSelection({
  active,
  pageId,
  zoom,
  surfaceRef,
  canvasRef,
}: UseSourceTextSelectionOptions): CapturedSourceTextSelection {
  const [capture, setCapture] = useState<{
    selection: SourceTextSelection | null
    sourceOccurrence: TextOccurrence | null
  }>({ selection: null, sourceOccurrence: null })

  useEffect(() => {
    if (!active) return
    const capture = () => {
      const browserSelection = window.getSelection()
      const surface = surfaceRef.current
      const textLayer = surface?.querySelector<HTMLElement>('.text-layer') ?? null
      if (!browserSelection || !surface || !textLayer || browserSelection.rangeCount !== 1
        || browserSelection.isCollapsed || !browserSelection.anchorNode || !browserSelection.focusNode
        || !textLayer.contains(browserSelection.anchorNode)
        || !textLayer.contains(browserSelection.focusNode)) {
        setCapture({ selection: null, sourceOccurrence: null })
        return
      }
      const range = browserSelection.getRangeAt(0)
      const styleElement = elementForNode(range.startContainer)
      if (!styleElement || !textLayer.contains(styleElement)) {
        setCapture({ selection: null, sourceOccurrence: null })
        return
      }
      const clientRects = Array.from(range.getClientRects(), (rectangle) => ({
        left: rectangle.left,
        top: rectangle.top,
        right: rectangle.right,
        bottom: rectangle.bottom,
      }))
      const computed = window.getComputedStyle(styleElement)
      const sourceSpan = styleElement.closest<HTMLElement>('span[role="presentation"]')
      const cssFontSize = Number.parseFloat(computed.fontSize)
      setCapture({
        selection: buildSourceTextSelection({
        pageId,
        text: browserSelection.toString(),
        clientRects,
        surface: surface.getBoundingClientRect(),
        fontSize: cssFontSize / (1.16 * zoom),
        color: sampledTextColor(canvasRef.current, clientRects),
        fontFamily: sourceFontFamily(computed.fontFamily),
        fontWeight: sourceFontWeight(sourceSpan?.dataset.sourceFontWeight ?? computed.fontWeight),
        fontStyle: sourceFontStyle(sourceSpan?.dataset.sourceFontStyle ?? computed.fontStyle),
        direction: sourceDirection(computed.direction),
        }),
        sourceOccurrence: sourceOccurrenceForRange(range, textLayer),
      })
    }
    document.addEventListener('selectionchange', capture)
    return () => document.removeEventListener('selectionchange', capture)
  }, [active, canvasRef, pageId, surfaceRef, zoom])

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setCapture({ selection: null, sourceOccurrence: null })
  }, [])

  return {
    selection: active ? capture.selection : null,
    sourceOccurrence: active ? capture.sourceOccurrence : null,
    clear,
  }
}
