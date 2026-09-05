import type {
  Annotation,
  FontFamily,
  FontStyle,
  FontWeight,
  TextDirection,
  TextAnnotation,
  WhiteoutAnnotation,
} from './editor'

export interface ScreenRectangle {
  left: number
  top: number
  right: number
  bottom: number
}

export interface SurfaceRectangle {
  left: number
  top: number
  width: number
  height: number
}

export interface SourceTextSelectionInput {
  pageId: string
  text: string
  clientRects: ScreenRectangle[]
  surface: SurfaceRectangle
  fontSize: number
  color: string
  fontFamily: FontFamily
  fontWeight: FontWeight
  fontStyle: FontStyle
  direction: TextDirection
}

export interface SelectionRectangle {
  x: number
  y: number
  width: number
  height: number
}

export interface SourceTextSelection {
  pageId: string
  text: string
  rects: SelectionRectangle[]
  bounds: SelectionRectangle
  fontSize: number
  color: string
  fontFamily: FontFamily
  fontWeight: FontWeight
  fontStyle: FontStyle
  direction: TextDirection
}

interface PixelRectangle extends ScreenRectangle {
  width: number
  height: number
}

const SAFE_TEXT_COLOR = '#182026'
const MINIMUM_TEXT_WIDTH = 70
const MINIMUM_TEXT_HEIGHT = 22
const WHITEOUT_PADDING = 1
const REPLACEMENT_HORIZONTAL_PADDING = 8

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function clippedRectangle(rectangle: ScreenRectangle, surface: SurfaceRectangle): PixelRectangle | null {
  if (![rectangle.left, rectangle.top, rectangle.right, rectangle.bottom].every(finite)) return null
  const surfaceRight = surface.left + surface.width
  const surfaceBottom = surface.top + surface.height
  const left = Math.max(surface.left, Math.min(rectangle.left, rectangle.right))
  const top = Math.max(surface.top, Math.min(rectangle.top, rectangle.bottom))
  const right = Math.min(surfaceRight, Math.max(rectangle.left, rectangle.right))
  const bottom = Math.min(surfaceBottom, Math.max(rectangle.top, rectangle.bottom))
  if (right <= left || bottom <= top) return null
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

function mergeableLine(left: PixelRectangle, right: PixelRectangle): boolean {
  const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top)
  const minimumHeight = Math.min(left.height, right.height)
  const centreDistance = Math.abs(
    (left.top + left.bottom) / 2 - (right.top + right.bottom) / 2,
  )
  const sameLine = verticalOverlap >= minimumHeight * 0.55
    || centreDistance <= minimumHeight * 0.35
  const horizontalGap = right.left - left.right
  return sameLine && horizontalGap <= Math.max(4, minimumHeight * 0.5)
}

function mergeClientRectangles(rectangles: PixelRectangle[]): PixelRectangle[] {
  const sorted = [...rectangles].sort((left, right) => left.top - right.top || left.left - right.left)
  const merged: PixelRectangle[] = []
  for (const rectangle of sorted) {
    const previous = merged.at(-1)
    if (!previous || !mergeableLine(previous, rectangle)) {
      merged.push(rectangle)
      continue
    }
    previous.left = Math.min(previous.left, rectangle.left)
    previous.top = Math.min(previous.top, rectangle.top)
    previous.right = Math.max(previous.right, rectangle.right)
    previous.bottom = Math.max(previous.bottom, rectangle.bottom)
    previous.width = previous.right - previous.left
    previous.height = previous.bottom - previous.top
  }
  return merged
}

function normalizedRectangle(rectangle: PixelRectangle, surface: SurfaceRectangle): SelectionRectangle {
  const left = Math.max(surface.left, rectangle.left - WHITEOUT_PADDING)
  const top = Math.max(surface.top, rectangle.top - WHITEOUT_PADDING)
  const right = Math.min(surface.left + surface.width, rectangle.right + WHITEOUT_PADDING)
  const bottom = Math.min(surface.top + surface.height, rectangle.bottom + WHITEOUT_PADDING)
  return {
    x: (left - surface.left) / surface.width,
    y: (top - surface.top) / surface.height,
    width: (right - left) / surface.width,
    height: (bottom - top) / surface.height,
  }
}

function selectionBounds(rectangles: SelectionRectangle[], surface: SurfaceRectangle): SelectionRectangle {
  const x = Math.min(...rectangles.map((rectangle) => rectangle.x))
  const y = Math.min(...rectangles.map((rectangle) => rectangle.y))
  const right = Math.max(...rectangles.map((rectangle) => rectangle.x + rectangle.width))
  const bottom = Math.max(...rectangles.map((rectangle) => rectangle.y + rectangle.height))
  return {
    x,
    y,
    width: Math.min(1 - x, Math.max(right - x, MINIMUM_TEXT_WIDTH / surface.width)),
    height: Math.min(1 - y, Math.max(bottom - y, MINIMUM_TEXT_HEIGHT / surface.height)),
  }
}

export function buildSourceTextSelection(input: SourceTextSelectionInput): SourceTextSelection | null {
  const text = input.text.replace(/\r\n?/g, '\n').trim()
  if (!input.pageId || !text || !finite(input.surface.width) || !finite(input.surface.height)
    || input.surface.width <= 0 || input.surface.height <= 0) return null
  const clipped = input.clientRects
    .map((rectangle) => clippedRectangle(rectangle, input.surface))
    .filter((rectangle): rectangle is PixelRectangle => rectangle !== null)
  if (clipped.length === 0) return null
  const rects = mergeClientRectangles(clipped)
    .map((rectangle) => normalizedRectangle(rectangle, input.surface))
    .filter((rectangle) => rectangle.width > 0 && rectangle.height > 0)
  if (rects.length === 0) return null
  return {
    pageId: input.pageId,
    text,
    rects,
    bounds: selectionBounds(rects, input.surface),
    fontSize: finite(input.fontSize) && input.fontSize >= 6 && input.fontSize <= 96
      ? input.fontSize
      : 18,
    color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : SAFE_TEXT_COLOR,
    fontFamily: input.fontFamily,
    fontWeight: input.fontWeight,
    fontStyle: input.fontStyle,
    direction: input.direction,
  }
}

/** Expand an automated replacement to its measured source-styled width. */
export function fitSourceReplacementWidth(
  selection: SourceTextSelection,
  replacementText: string,
  surfaceWidth: number,
  measuredTextWidth: number,
): SourceTextSelection {
  if (!finite(surfaceWidth) || surfaceWidth <= 0 || !finite(measuredTextWidth)) {
    return { ...selection, text: replacementText }
  }
  const sourceRunWidth = Math.max(
    selection.bounds.width * surfaceWidth,
    ...selection.rects.map((rectangle) => rectangle.width * surfaceWidth),
  )
  const fontSize = measuredTextWidth > sourceRunWidth && measuredTextWidth > 0
    ? Math.max(6, selection.fontSize * (sourceRunWidth / measuredTextWidth))
    : selection.fontSize
  const fittedTextWidth = measuredTextWidth * (fontSize / selection.fontSize)
  const measuredWidth = Math.max(0, fittedTextWidth + REPLACEMENT_HORIZONTAL_PADDING) / surfaceWidth
  const width = Math.min(
    1 - selection.bounds.x,
    Math.max(selection.bounds.width, measuredWidth),
  )
  return {
    ...selection,
    text: replacementText,
    fontSize,
    bounds: { ...selection.bounds, width },
  }
}

export function sourceReplacementAnnotations(
  selection: SourceTextSelection,
  createId: () => string,
): Annotation[] {
  const whiteouts: WhiteoutAnnotation[] = selection.rects.map((rectangle) => ({
    id: createId(),
    pageId: selection.pageId,
    kind: 'whiteout',
    ...rectangle,
  }))
  const replacement: TextAnnotation = {
    id: createId(),
    pageId: selection.pageId,
    kind: 'text',
    ...selection.bounds,
    text: selection.text,
    color: selection.color,
    fontSize: selection.fontSize,
    fontFamily: selection.fontFamily,
    fontWeight: selection.fontWeight,
    fontStyle: selection.fontStyle,
    direction: selection.direction,
    sourceReplacement: true,
  }
  return [...whiteouts, replacement]
}
