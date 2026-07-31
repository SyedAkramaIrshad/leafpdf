import { LineCapStyle, PDFDocument, PDFName, PDFRef, degrees, rgb, type PDFPage } from 'pdf-lib'
import { textStyleOf, type Annotation, type EditorDocument, type EditorPage } from '../model/editor'
import { createFontRegistry, type FontRegistry } from './fontRegistry'
import { analyzeLoadedPdf, chooseExportStrategy, describeFeatures, type SourcePdfFeatures } from './sourceAnalysis'

interface Point {
  x: number
  y: number
}

function colorFromHex(hex: string) {
  const clean = hex.replace('#', '')
  const value = Number.parseInt(clean.length === 3 ? clean.split('').map((part) => part + part).join('') : clean, 16)
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)
}

function displaySize(width: number, height: number, rotation: number) {
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height }
}

function displayToPdf(point: Point, width: number, height: number, rotation: number): Point {
  switch (rotation) {
    case 90: return { x: point.y, y: point.x }
    case 180: return { x: width - point.x, y: point.y }
    case 270: return { x: width - point.y, y: height - point.x }
    default: return { x: point.x, y: height - point.y }
  }
}

export interface AnchorBox {
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

/**
 * Map a point `offsetFromTop` below an annotation's top-left corner into PDF
 * coordinates. `offsetFromTop === box height` gives the bottom-left corner, which
 * is what pdf-lib wants for rectangles and images. A smaller offset is used to put
 * a text baseline near the top of the box, matching how the browser lays text out.
 */
export function anchorAtOffsetFromTop(
  box: AnchorBox,
  pageWidth: number,
  pageHeight: number,
  rotation: number,
  offsetFromTop: number,
): Point {
  const display = displaySize(pageWidth, pageHeight, rotation)
  const angle = (box.rotation ?? 0) * Math.PI / 180
  const offset = { x: -Math.sin(angle) * offsetFromTop, y: Math.cos(angle) * offsetFromTop }
  return displayToPdf(
    { x: box.x * display.width + offset.x, y: box.y * display.height + offset.y },
    pageWidth,
    pageHeight,
    rotation,
  )
}

function annotationMetrics(annotation: Annotation, page: PDFPage, rotation: number) {
  const { width, height } = page.getSize()
  const display = displaySize(width, height, rotation)
  const displayX = annotation.x * display.width
  const displayY = annotation.y * display.height
  const drawWidth = annotation.width * display.width
  const drawHeight = annotation.height * display.height
  const annotationAngle = (annotation.rotation ?? 0) * Math.PI / 180
  const widthVector = { x: Math.cos(annotationAngle) * drawWidth, y: Math.sin(annotationAngle) * drawWidth }
  const heightVector = { x: -Math.sin(annotationAngle) * drawHeight, y: Math.cos(annotationAngle) * drawHeight }
  const displayAnchor = { x: displayX + heightVector.x, y: displayY + heightVector.y }
  const anchor = displayToPdf(displayAnchor, width, height, rotation)
  const right = displayToPdf(
    { x: displayAnchor.x + widthVector.x, y: displayAnchor.y + widthVector.y },
    width,
    height,
    rotation,
  )
  const drawAngle = Math.atan2(right.y - anchor.y, right.x - anchor.x) * 180 / Math.PI
  return { width, height, display, displayX, displayY, drawWidth, drawHeight, anchor, drawAngle }
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const payload = dataUrl.split(',')[1]
  if (!payload) throw new Error('The placed image data is invalid.')
  const binary = atob(payload)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function paintAnnotation(
  output: PDFDocument,
  page: PDFPage,
  annotation: Annotation,
  rotation: number,
  fonts: FontRegistry,
) {
  const metrics = annotationMetrics(annotation, page, rotation)
  const angle = degrees(metrics.drawAngle)
  const pointInAnnotation = (u: number, v: number) => {
    const radians = (annotation.rotation ?? 0) * Math.PI / 180
    const localX = u * metrics.drawWidth
    const localY = v * metrics.drawHeight
    return displayToPdf(
      {
        x: metrics.displayX + Math.cos(radians) * localX - Math.sin(radians) * localY,
        y: metrics.displayY + Math.sin(radians) * localX + Math.cos(radians) * localY,
      },
      metrics.width,
      metrics.height,
      rotation,
    )
  }
  if (annotation.kind === 'text') {
    const text = annotation.text || ' '
    const { fontFamily, fontWeight, fontStyle } = textStyleOf(annotation)
    const font = await fonts.fontFor({
      text,
      fontFamily,
      fontWeight,
      fontStyle,
    })
    // The browser lays the first line out from the top of the box, so the baseline
    // sits one ascent below the box top. Anchoring to the box bottom instead pushed
    // exported text below its preview by the full height of the box.
    const { width: pageWidth, height: pageHeight } = page.getSize()
    const baseline = anchorAtOffsetFromTop(
      annotation,
      pageWidth,
      pageHeight,
      rotation,
      font.heightAtSize(annotation.fontSize, { descender: false }),
    )
    page.drawText(text, {
      x: baseline.x,
      y: baseline.y,
      size: annotation.fontSize,
      font,
      color: colorFromHex(annotation.color),
      rotate: angle,
      lineHeight: annotation.fontSize * 1.2,
      maxWidth: Math.max(metrics.drawWidth, annotation.fontSize),
      opacity: annotation.opacity ?? 1,
    })
    return
  }
  if (annotation.kind === 'highlight') {
    page.drawRectangle({
      x: metrics.anchor.x,
      y: metrics.anchor.y,
      width: metrics.drawWidth,
      height: metrics.drawHeight,
      color: colorFromHex(annotation.color),
      opacity: annotation.opacity,
      rotate: angle,
    })
    return
  }
  if (annotation.kind === 'ink') {
    for (let index = 1; index < annotation.points.length; index += 1) {
      const previous = annotation.points[index - 1]
      const current = annotation.points[index]
      const start = displayToPdf(
        { x: previous.x * metrics.display.width, y: previous.y * metrics.display.height },
        metrics.width,
        metrics.height,
        rotation,
      )
      const end = displayToPdf(
        { x: current.x * metrics.display.width, y: current.y * metrics.display.height },
        metrics.width,
        metrics.height,
        rotation,
      )
      page.drawLine({ start, end, thickness: annotation.strokeWidth, color: colorFromHex(annotation.color), lineCap: LineCapStyle.Round })
    }
    return
  }
  if (annotation.kind === 'shape') {
    if (annotation.shape === 'rectangle') {
      page.drawRectangle({
        x: metrics.anchor.x,
        y: metrics.anchor.y,
        width: metrics.drawWidth,
        height: metrics.drawHeight,
        color: annotation.fillColor ? colorFromHex(annotation.fillColor) : undefined,
        borderColor: colorFromHex(annotation.strokeColor),
        borderWidth: annotation.strokeWidth,
        rotate: angle,
      })
      return
    }
    if (annotation.shape === 'ellipse') {
      const center = pointInAnnotation(0.5, 0.5)
      page.drawEllipse({
        x: center.x,
        y: center.y,
        xScale: metrics.drawWidth / 2,
        yScale: metrics.drawHeight / 2,
        color: annotation.fillColor ? colorFromHex(annotation.fillColor) : undefined,
        borderColor: colorFromHex(annotation.strokeColor),
        borderWidth: annotation.strokeWidth,
        rotate: angle,
      })
      return
    }
    const start = pointInAnnotation(0.03, 0.97)
    const end = pointInAnnotation(0.97, 0.03)
    page.drawLine({ start, end, thickness: annotation.strokeWidth, color: colorFromHex(annotation.strokeColor), lineCap: LineCapStyle.Round })
    if (annotation.shape === 'arrow') {
      page.drawLine({ start: pointInAnnotation(0.72, 0.03), end, thickness: annotation.strokeWidth, color: colorFromHex(annotation.strokeColor), lineCap: LineCapStyle.Round })
      page.drawLine({ start: pointInAnnotation(0.97, 0.28), end, thickness: annotation.strokeWidth, color: colorFromHex(annotation.strokeColor), lineCap: LineCapStyle.Round })
    }
    return
  }
  if (annotation.kind === 'stamp') {
    const color = colorFromHex(annotation.color)
    if (annotation.stamp === 'check') {
      page.drawLine({ start: pointInAnnotation(0.08, 0.52), end: pointInAnnotation(0.38, 0.82), thickness: annotation.strokeWidth, color, lineCap: LineCapStyle.Round })
      page.drawLine({ start: pointInAnnotation(0.38, 0.82), end: pointInAnnotation(0.94, 0.15), thickness: annotation.strokeWidth, color, lineCap: LineCapStyle.Round })
    } else if (annotation.stamp === 'cross') {
      page.drawLine({ start: pointInAnnotation(0.14, 0.14), end: pointInAnnotation(0.86, 0.86), thickness: annotation.strokeWidth, color, lineCap: LineCapStyle.Round })
      page.drawLine({ start: pointInAnnotation(0.86, 0.14), end: pointInAnnotation(0.14, 0.86), thickness: annotation.strokeWidth, color, lineCap: LineCapStyle.Round })
    } else if (annotation.stamp === 'dot') {
      const center = pointInAnnotation(0.5, 0.5)
      page.drawEllipse({ x: center.x, y: center.y, xScale: metrics.drawWidth * 0.34, yScale: metrics.drawHeight * 0.34, color, rotate: angle })
    } else {
      const text = annotation.label || ' '
      const size = Math.max(6, Math.min(16, metrics.drawHeight * 0.55))
      const font = await fonts.fontFor({ text, fontFamily: 'mono', fontWeight: 700 })
      const baseline = anchorAtOffsetFromTop(annotation, metrics.width, metrics.height, rotation, size)
      page.drawText(text, { x: baseline.x, y: baseline.y, size, font, color, rotate: angle, maxWidth: metrics.drawWidth })
    }
    return
  }
  if (annotation.kind !== 'image') return
  const bytes = dataUrlBytes(annotation.dataUrl)
  const image = annotation.mimeType === 'image/png'
    ? await output.embedPng(bytes)
    : await output.embedJpg(bytes)
  page.drawImage(image, {
    x: metrics.anchor.x,
    y: metrics.anchor.y,
    width: metrics.drawWidth,
    height: metrics.drawHeight,
    rotate: angle,
  })
}

export interface ExportOptions {
  /**
   * Set once the user has accepted, in the compatibility dialog, that rebuilding
   * can remove or invalidate outlines, forms, attachments, or a signature.
   */
  allowCompatibilityCopy?: boolean
  /** Called after each page is painted, so a long export can show progress. */
  onProgress?: (completedPages: number, totalPages: number) => void
}

export class CompatibilityConfirmationRequired extends Error {
  readonly features: SourcePdfFeatures

  constructor(features: SourcePdfFeatures) {
    super(
      'This PDF needs a compatibility copy. Reordering or deleting its pages can remove or invalidate: '
      + `${describeFeatures(features).join(', ')}.`,
    )
    this.name = 'CompatibilityConfirmationRequired'
    this.features = features
  }
}

async function paintPage(
  output: PDFDocument,
  page: PDFPage,
  editorPage: EditorPage,
  document: EditorDocument,
  fonts: FontRegistry,
) {
  const sourceRotation = page.getRotation().angle
  const finalRotation = ((sourceRotation + editorPage.rotation) % 360 + 360) % 360
  page.setRotation(degrees(finalRotation))
  const annotations = document.annotations.filter((annotation) => annotation.pageId === editorPage.id)
  for (const annotation of annotations) {
    await paintAnnotation(output, page, annotation, finalRotation, fonts)
  }
}

/**
 * Mutate the source document in place. Metadata, outlines, attachments, form
 * fields, and every other catalog feature stay exactly as they were because the
 * catalog is never rebuilt.
 */
async function exportByPreserving(
  source: PDFDocument,
  document: EditorDocument,
  onProgress?: ExportOptions['onProgress'],
): Promise<Uint8Array> {
  const fonts = await createFontRegistry(source)
  const keptSourceIndexes = new Set(document.pages.map((page) => page.sourceIndex))

  for (const [index, editorPage] of document.pages.entries()) {
    const page = source.getPage(editorPage.sourceIndex)
    await paintPage(source, page, editorPage, document, fonts)
    onProgress?.(index + 1, document.pages.length)
  }

  // Remove from the highest index down so earlier indexes stay valid.
  const originalCount = source.getPageCount()
  for (let index = originalCount - 1; index >= 0; index -= 1) {
    if (!keptSourceIndexes.has(index)) source.removePage(index)
  }

  source.setProducer('LeafPDF')
  source.setModificationDate(new Date())
  return source.save()
}

/**
 * Copy pages into a new document. Only reached when the source has no catalog
 * feature to lose, or when the user accepted a compatibility copy. Metadata is
 * copied explicitly because `copyPages` does not carry it.
 */
async function exportByRebuilding(
  source: PDFDocument,
  document: EditorDocument,
  onProgress?: ExportOptions['onProgress'],
): Promise<Uint8Array> {
  const output = await PDFDocument.create()
  const fonts = await createFontRegistry(output)

  for (const [index, editorPage] of document.pages.entries()) {
    const [page] = await output.copyPages(source, [editorPage.sourceIndex])
    output.addPage(page)
    await paintPage(output, page, editorPage, document, fonts)
    onProgress?.(index + 1, document.pages.length)
  }

  const title = source.getTitle()
  const author = source.getAuthor()
  const subject = source.getSubject()
  const keywords = source.getKeywords()
  const creator = source.getCreator()
  const creationDate = source.getCreationDate()
  if (title) output.setTitle(title)
  if (author) output.setAuthor(author)
  if (subject) output.setSubject(subject)
  if (keywords) output.setKeywords(keywords.split(/[,\s]+/).filter(Boolean))
  if (creator) output.setCreator(creator)
  if (creationDate) output.setCreationDate(creationDate)

  // These catalog entries neither reference pages nor depend on page order, and each
  // is a single direct object (a name or a string), so it can be carried over safely.
  // Anything held indirectly — /Metadata, /ViewerPreferences — is deliberately not
  // copied here: its nested references belong to the source's object graph and would
  // dangle in this document. Those are disclosed by BLOCKING_CATALOG_ENTRIES instead.
  for (const key of ['Lang', 'PageMode', 'PageLayout'] as const) {
    const value = source.catalog.get(PDFName.of(key))
    if (value === undefined || value instanceof PDFRef) continue
    output.catalog.set(PDFName.of(key), value)
  }

  output.setProducer('LeafPDF')
  output.setModificationDate(new Date())
  return output.save()
}

export async function exportEditedPdf(
  sourceBytes: Uint8Array,
  document: EditorDocument,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  // Parse once and analyse the loaded document, rather than loading it here and
  // again inside analyzeSourcePdf. On a 100 MB file that second parse cost a full
  // extra copy of the object graph for no benefit.
  //
  // `updateMetadata: false` keeps pdf-lib from stamping its own producer and
  // modification date over the source values before we decide what to keep.
  const source = await PDFDocument.load(sourceBytes.slice(), { ignoreEncryption: false, updateMetadata: false })
  const features = analyzeLoadedPdf(source)
  // The source page count is what makes a deletion distinguishable from an untouched
  // document; without it, deleting the last page reads as "nothing changed".
  const strategy = chooseExportStrategy(features, document, source.getPageCount())
  if (strategy === 'requires-confirmation' && !options.allowCompatibilityCopy) {
    throw new CompatibilityConfirmationRequired(features)
  }

  return strategy === 'preserve'
    ? exportByPreserving(source, document, options.onProgress)
    : exportByRebuilding(source, document, options.onProgress)
}

export { exportedFileName } from './exportNaming'
