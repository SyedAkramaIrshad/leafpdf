import { Encodings } from '@pdf-lib/standard-fonts'
import { LineCapStyle, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFName, PDFRadioGroup, PDFRef, PDFTextField, degrees, rgb, type PDFPage } from 'pdf-lib'
import { hasRedactions, imageOpacityOf, textMarkStrokeWidthOf, textMarkStyleOf, textStyleOf, type Annotation, type CreatedFormFieldAnnotation, type EditorDocument, type EditorPage, type FormValue } from '../model/editor'
import { createdFormFieldCollectionIssue, formFieldNamesConflict } from '../model/createdFormFields'
import { externalLinkDestination } from '../model/linkTarget'
import { createFontRegistry, type FontRegistry } from './fontRegistry'
import { appendExternalLinkAnnotation } from './linkAnnotation'
import { analyzeLoadedPdf, chooseExportStrategy, describeFeatures, isEncryptedPdfError, type SourcePdfFeatures } from './sourceAnalysis'
import type { PdfFormOutput } from './exportWorkerProtocol'

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

const CREATED_FIELD_BORDER_WIDTH = 0.75

function quarterTurn(rotation: number): 0 | 90 | 180 | 270 {
  return (((rotation % 360) + 360) % 360) as 0 | 90 | 180 | 270
}

/**
 * Convert the editor's top-left display rectangle into pdf-lib's form-widget
 * inputs. pdf-lib rotates the widget around its supplied anchor and expands its
 * rectangle by the border width, so the inverse below keeps the widget's outer
 * rectangle exactly aligned with the on-page editing proof.
 */
function createdFieldWidgetPlacement(
  annotation: CreatedFormFieldAnnotation,
  page: PDFPage,
  rotation: number,
) {
  const { width: pageWidth, height: pageHeight } = page.getSize()
  const display = displaySize(pageWidth, pageHeight, rotation)
  const left = annotation.x * display.width
  const top = annotation.y * display.height
  const right = (annotation.x + annotation.width) * display.width
  const bottom = (annotation.y + annotation.height) * display.height
  const corners = [
    displayToPdf({ x: left, y: top }, pageWidth, pageHeight, rotation),
    displayToPdf({ x: right, y: top }, pageWidth, pageHeight, rotation),
    displayToPdf({ x: left, y: bottom }, pageWidth, pageHeight, rotation),
    displayToPdf({ x: right, y: bottom }, pageWidth, pageHeight, rotation),
  ]
  const xs = corners.map(({ x }) => x)
  const ys = corners.map(({ y }) => y)
  const target = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
  const border = CREATED_FIELD_BORDER_WIDTH
  const halfBorder = border / 2
  const fieldRotation = quarterTurn(rotation)
  if (fieldRotation === 90) {
    return {
      x: target.x + target.width - halfBorder,
      y: target.y + halfBorder,
      width: Math.max(0.01, target.height - border),
      height: Math.max(0.01, target.width - border),
      rotate: degrees(90),
    }
  }
  if (fieldRotation === 180) {
    return {
      x: target.x + target.width - halfBorder,
      y: target.y + target.height - halfBorder,
      width: Math.max(0.01, target.width - border),
      height: Math.max(0.01, target.height - border),
      rotate: degrees(180),
    }
  }
  if (fieldRotation === 270) {
    return {
      x: target.x + halfBorder,
      y: target.y + target.height - halfBorder,
      width: Math.max(0.01, target.height - border),
      height: Math.max(0.01, target.width - border),
      rotate: degrees(270),
    }
  }
  return {
    x: target.x + halfBorder,
    y: target.y + halfBorder,
    width: Math.max(0.01, target.width - border),
    height: Math.max(0.01, target.height - border),
    rotate: degrees(0),
  }
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
  if (annotation.kind === 'link') {
    const destination = externalLinkDestination(annotation)
    if (!destination) {
      throw new Error('A clickable link has no valid web, email, or phone destination.')
    }
    const corners = [
      pointInAnnotation(0, 0),
      pointInAnnotation(1, 0),
      pointInAnnotation(0, 1),
      pointInAnnotation(1, 1),
    ]
    const xs = corners.map(({ x }) => x)
    const ys = corners.map(({ y }) => y)
    appendExternalLinkAnnotation(
      output,
      page,
      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      destination,
      annotation.id,
    )
    return
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
    const mark = textMarkStyleOf(annotation)
    if (mark !== 'highlight') {
      const lineY = mark === 'underline' ? 0.82 : 0.5
      page.drawLine({
        start: pointInAnnotation(0, lineY),
        end: pointInAnnotation(1, lineY),
        thickness: textMarkStrokeWidthOf(annotation),
        color: colorFromHex(annotation.color),
        opacity: annotation.opacity,
        lineCap: LineCapStyle.Round,
      })
      return
    }
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
  if (annotation.kind === 'whiteout') {
    page.drawRectangle({
      x: metrics.anchor.x,
      y: metrics.anchor.y,
      width: metrics.drawWidth,
      height: metrics.drawHeight,
      color: rgb(1, 1, 1),
      rotate: angle,
    })
    return
  }
  if (annotation.kind === 'redaction') {
    // Only reached for blank pages, which have no source content to remove;
    // source-backed pages with redactions are replaced by bitmaps instead.
    page.drawRectangle({
      x: metrics.anchor.x,
      y: metrics.anchor.y,
      width: metrics.drawWidth,
      height: metrics.drawHeight,
      color: rgb(0, 0, 0),
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
  const fitted = image.scaleToFit(metrics.drawWidth, metrics.drawHeight)
  const offsetX = (metrics.drawWidth - fitted.width) / 2
  const offsetY = (metrics.drawHeight - fitted.height) / 2
  const fittedAnchor = pointInAnnotation(
    offsetX / metrics.drawWidth,
    (offsetY + fitted.height) / metrics.drawHeight,
  )
  page.drawImage(image, {
    x: fittedAnchor.x,
    y: fittedAnchor.y,
    width: fitted.width,
    height: fitted.height,
    rotate: angle,
    opacity: imageOpacityOf(annotation),
  })
}

export interface ExportOptions {
  /**
   * Set once the user has accepted, in the compatibility dialog, that rebuilding
   * can remove or invalidate outlines, forms, attachments, or a signature.
   */
  allowCompatibilityCopy?: boolean
  /** Bytes of every inserted PDF the document references, keyed by document id. */
  insertedDocuments?: Map<string, Uint8Array>
  /** Burned-in bitmaps for redacted pages, keyed by page id. See redactionRaster. */
  rasterizedPages?: Map<string, { width: number; height: number; png: ArrayBuffer }>
  /** Called after each page is painted, so a long export can show progress. */
  onProgress?: (completedPages: number, totalPages: number) => void
  /** Keep real form controls, or paint their current appearances into the pages. */
  formOutput?: PdfFormOutput
}

/**
 * Parse each inserted PDF once, on demand. A document that only reorders its
 * original pages never touches these bytes.
 */
class InsertedDocuments {
  private readonly parsed = new Map<string, Promise<PDFDocument>>()

  constructor(private readonly bytes: Map<string, Uint8Array>) {}

  get(id: string): Promise<PDFDocument> {
    const cached = this.parsed.get(id)
    if (cached) return cached
    const source = this.bytes.get(id)
    if (!source) {
      return Promise.reject(new Error('An inserted PDF is no longer available. Remove its pages and export again.'))
    }
    const loading = PDFDocument.load(source.slice(), { ignoreEncryption: false, updateMetadata: false })
    this.parsed.set(id, loading)
    return loading
  }
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
  createdFields: CreatedFieldExportContext,
) {
  const sourceRotation = page.getRotation().angle
  const finalRotation = ((sourceRotation + editorPage.rotation) % 360 + 360) % 360
  page.setRotation(degrees(finalRotation))
  const annotations = document.annotations.filter((annotation) => annotation.pageId === editorPage.id)
  for (const annotation of annotations) {
    if (annotation.kind === 'form-field') {
      await emitCreatedFormField(output, page, annotation, finalRotation, fonts, createdFields)
    } else {
      await paintAnnotation(output, page, annotation, finalRotation, fonts)
    }
  }
}

/**
 * Form-field appearances are regenerated with the standard Helvetica pdf-lib
 * uses, which stores WinAnsi text only. Refusing here, by name, beats an export
 * that silently drops what the user typed into a field.
 */
function fieldValueStorable(text: string): boolean {
  return Array.from(text, (character) => character.codePointAt(0) ?? 0)
    .every((codePoint) => Encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint))
}

interface CreatedFieldExportContext {
  radioGroups: Map<string, PDFRadioGroup>
  radioDefaults: Map<string, string>
}

function createCreatedFieldExportContext(): CreatedFieldExportContext {
  return { radioGroups: new Map(), radioDefaults: new Map() }
}

function finalizeCreatedFormFields(
  output: PDFDocument,
  context: CreatedFieldExportContext,
) {
  // Calling getForm() creates an AcroForm dictionary on a plain PDF. Do not
  // mutate documents that have no created radio group to finalize.
  if (context.radioGroups.size === 0) return
  const form = output.getForm()
  for (const [name, field] of context.radioGroups) {
    const selected = context.radioDefaults.get(name)
    if (selected) field.select(selected)
    else field.clear()
    field.defaultUpdateAppearances()
    form.markFieldAsClean(field.ref)
  }
}

async function emitCreatedFormField(
  output: PDFDocument,
  page: PDFPage,
  annotation: CreatedFormFieldAnnotation,
  rotation: number,
  fonts: FontRegistry,
  context: CreatedFieldExportContext,
) {
  const form = output.getForm()
  const placement = createdFieldWidgetPlacement(annotation, page, rotation)
  const appearance = {
    ...placement,
    textColor: rgb(0.094, 0.125, 0.149),
    backgroundColor: rgb(1, 1, 1),
    borderColor: rgb(0.42, 0.47, 0.55),
    borderWidth: CREATED_FIELD_BORDER_WIDTH,
  }
  if (annotation.fieldType === 'text') {
    if (!fieldValueStorable(annotation.defaultText)) {
      throw new Error(`Created text field "${annotation.fieldName}" has default text that its PDF font cannot store. Use Latin text or leave the default blank.`)
    }
    const field = form.createTextField(annotation.fieldName)
    if (annotation.required) field.enableRequired()
    if (annotation.multiline) field.enableMultiline()
    field.setText(annotation.defaultText)
    const font = await fonts.fontFor({ text: ' ', fontFamily: 'sans', fontWeight: 400 })
    field.addToPage(page, { ...appearance, font })
    // addToPage just built the appearance with the chosen font. Keeping this
    // field clean prevents PDFDocument.save() from replacing it with a generic
    // font while still allowing edited source fields to refresh normally.
    form.markFieldAsClean(field.ref)
    return
  }
  if (annotation.fieldType === 'checkbox') {
    const field = form.createCheckBox(annotation.fieldName)
    if (annotation.required) field.enableRequired()
    field.addToPage(page, appearance)
    if (annotation.checkedByDefault) field.check()
    else field.uncheck()
    form.markFieldAsClean(field.ref)
    return
  }
  if (annotation.fieldType === 'radio') {
    let field = context.radioGroups.get(annotation.fieldName)
    if (!field) {
      field = form.createRadioGroup(annotation.fieldName)
      if (annotation.required) field.enableRequired()
      context.radioGroups.set(annotation.fieldName, field)
    }
    field.addOptionToPage(annotation.optionValue, page, appearance)
    if (annotation.selectedByDefault) {
      context.radioDefaults.set(annotation.fieldName, annotation.optionValue)
    }
    return
  }

  const values = [...annotation.options, annotation.defaultOption].filter(Boolean)
  if (values.some((value) => !fieldValueStorable(value))) {
    throw new Error(`Created dropdown "${annotation.fieldName}" has a choice that its PDF font cannot store. Use Latin text for every choice.`)
  }
  const field = form.createDropdown(annotation.fieldName)
  if (annotation.required) field.enableRequired()
  field.setOptions(annotation.options)
  const font = await fonts.fontFor({
    text: annotation.defaultOption || annotation.options[0] || ' ',
    fontFamily: 'sans',
    fontWeight: 400,
  })
  field.addToPage(page, { ...appearance, font })
  if (annotation.defaultOption) field.select(annotation.defaultOption)
  field.defaultUpdateAppearances(font)
  form.markFieldAsClean(field.ref)
}

function catalogDictionary(document: PDFDocument, name: string): PDFDict | null {
  const value = document.catalog.get(PDFName.of(name))
  if (value instanceof PDFDict) return value
  if (value instanceof PDFRef) {
    const resolved = document.context.lookup(value)
    return resolved instanceof PDFDict ? resolved : null
  }
  return null
}

function hasXfaForm(document: PDFDocument): boolean {
  return catalogDictionary(document, 'AcroForm')?.get(PDFName.of('XFA')) !== undefined
}

interface WidgetAnnotationEntries {
  refs: Set<string>
  direct: Set<PDFDict>
}

function pageAnnotations(document: PDFDocument, page: PDFPage): PDFArray | null {
  const value = page.node.get(PDFName.of('Annots'))
  if (value instanceof PDFArray) return value
  if (!(value instanceof PDFRef)) return null
  const resolved = document.context.lookup(value)
  return resolved instanceof PDFArray ? resolved : null
}

function collectWidgetAnnotationEntries(document: PDFDocument): WidgetAnnotationEntries {
  const entries: WidgetAnnotationEntries = { refs: new Set(), direct: new Set() }
  for (const page of document.getPages()) {
    const annotations = pageAnnotations(document, page)
    if (!annotations) continue
    for (let index = 0; index < annotations.size(); index += 1) {
      const entry = annotations.get(index)
      const annotation = entry instanceof PDFRef ? document.context.lookup(entry) : entry
      if (!(annotation instanceof PDFDict)) continue
      const subtype = annotation.get(PDFName.of('Subtype'))
      if (!(subtype instanceof PDFName) || subtype.asString() !== '/Widget') continue
      if (entry instanceof PDFRef) entries.refs.add(entry.toString())
      else entries.direct.add(annotation)
    }
  }
  return entries
}

function removeFlattenedWidgetAnnotations(document: PDFDocument, widgets: WidgetAnnotationEntries) {
  for (const page of document.getPages()) {
    const annotations = pageAnnotations(document, page)
    if (!annotations) continue
    for (let index = annotations.size() - 1; index >= 0; index -= 1) {
      const entry = annotations.get(index)
      const remove = entry instanceof PDFRef
        ? widgets.refs.has(entry.toString())
        : entry instanceof PDFDict && widgets.direct.has(entry)
      if (remove) annotations.remove(index)
    }
    if (annotations.size() === 0) page.node.delete(PDFName.of('Annots'))
  }
}

function finalizeFormOutput(document: PDFDocument, formOutput: PdfFormOutput) {
  // Calling getForm() creates an AcroForm dictionary. A plain PDF must remain
  // plain even when the user asks for flattened output.
  if (formOutput !== 'flattened' || !catalogDictionary(document, 'AcroForm')) return
  const widgets = collectWidgetAnnotationEntries(document)
  document.getForm().flatten()
  // pdf-lib 1.17 deletes widget objects but can leave their page annotation
  // references behind. Remove those exact entries so readers do not need to
  // repair the xref table. Keep the now-empty AcroForm dictionary: pdf-lib's
  // flattened appearance resources can render blank if that catalog entry is
  // removed before serialization.
  removeFlattenedWidgetAnnotations(document, widgets)
}

function validateCreatedFieldsBeforeExport(
  source: PDFDocument,
  document: EditorDocument,
  sourceHasAcroForm: boolean,
  preservingSource: boolean,
) {
  const fields = document.annotations.filter(
    (annotation): annotation is CreatedFormFieldAnnotation => annotation.kind === 'form-field',
  )
  if (fields.length === 0) return

  const issue = createdFormFieldCollectionIssue(fields)
  if (issue) throw new Error(issue)

  const xfa = sourceHasAcroForm && hasXfaForm(source)
  if (xfa && preservingSource) {
    throw new Error('This PDF uses an XFA form. Adding AcroForm fields in place would remove that form, so LeafPDF stopped before changing it.')
  }
  if (!sourceHasAcroForm || xfa) return
  const sourceNames = source.getForm().getFields().map((field) => field.getName())
  for (const field of fields) {
    const conflicting = sourceNames.find((name) => formFieldNamesConflict(name, field.fieldName))
    if (conflicting) {
      throw new Error(`The source PDF already uses the form field name "${conflicting}". Rename the created field "${field.fieldName}" before saving.`)
    }
  }
}

/**
 * Write the user's filled values into the source PDF's own AcroForm fields, so
 * the exported file carries real, machine-readable field values — not pictures
 * of text sitting over empty fields. Only reached on the preserve path: a
 * rebuild cannot carry the form at all, which the compatibility dialog states.
 */
function applyFormValues(source: PDFDocument, values: Record<string, FormValue>) {
  const entries = Object.entries(values)
  if (entries.length === 0) return
  // Never call getForm() on an empty entry list: pdf-lib creates a missing
  // AcroForm dictionary on access, which would mutate a formless document.
  const form = source.getForm()
  const failures: string[] = []
  for (const [name, value] of entries) {
    try {
      const field = form.getField(name)
      if (field instanceof PDFTextField) {
        const text = String(value)
        if (!fieldValueStorable(text)) {
          failures.push(`"${name}": this form's fonts can only store Latin text`)
          continue
        }
        field.setText(text)
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check()
        else field.uncheck()
      } else if (field instanceof PDFRadioGroup || field instanceof PDFDropdown) {
        field.select(String(value))
      } else {
        failures.push(`"${name}": this field type cannot be filled`)
      }
    } catch (error) {
      failures.push(`"${name}": ${error instanceof Error ? error.message : 'could not be filled'}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`Some form fields could not be filled — ${failures.join('; ')}. `
      + 'Change those fields back, then export again.')
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
  inserted: InsertedDocuments,
  formOutput: PdfFormOutput,
  onProgress?: ExportOptions['onProgress'],
): Promise<Uint8Array> {
  // Belt and braces: the strategy chooser never routes a redacted document
  // here, because mutating in place cannot remove content that other objects
  // still reference. Failing beats silently keeping "removed" content.
  if (hasRedactions(document)) {
    throw new Error('Internal error: a redacted document must be exported as a rebuilt copy.')
  }
  const fonts = await createFontRegistry(source)
  const createdFields = createCreatedFieldExportContext()
  // Page references taken before any removal or insertion: they stay valid while
  // the page tree changes around them, unlike indexes.
  const originalPages = source.getPages()
  const keptSourceIndexes = new Set(
    document.pages.flatMap((page) => page.kind === 'original' ? [page.sourceIndex] : []),
  )

  // Remove from the highest index down so earlier indexes stay valid.
  for (let index = originalPages.length - 1; index >= 0; index -= 1) {
    if (!keptSourceIndexes.has(index)) source.removePage(index)
  }

  // The kept originals now sit in ascending order — the precondition of this
  // path — so walking the document order and inserting the added pages at the
  // running position lines everything up.
  for (const [index, editorPage] of document.pages.entries()) {
    let page: PDFPage
    if (editorPage.kind === 'original') {
      page = originalPages[editorPage.sourceIndex]
    } else if (editorPage.kind === 'blank') {
      page = source.insertPage(index, [editorPage.width, editorPage.height])
    } else {
      const donor = await inserted.get(editorPage.documentId)
      const [copied] = await source.copyPages(donor, [editorPage.sourceIndex])
      page = source.insertPage(index, copied)
    }
    await paintPage(source, page, editorPage, document, fonts, createdFields)
    onProgress?.(index + 1, document.pages.length)
  }

  finalizeCreatedFormFields(source, createdFields)
  applyFormValues(source, document.formValues)
  finalizeFormOutput(source, formOutput)

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
  inserted: InsertedDocuments,
  rasterized: Map<string, { width: number; height: number; png: ArrayBuffer }>,
  formOutput: PdfFormOutput,
  onProgress?: ExportOptions['onProgress'],
): Promise<Uint8Array> {
  const output = await PDFDocument.create()
  const fonts = await createFontRegistry(output)
  const createdFields = createCreatedFieldExportContext()

  for (const [index, editorPage] of document.pages.entries()) {
    const pageAnnotations = document.annotations.filter((annotation) => annotation.pageId === editorPage.id)
    const redacted = pageAnnotations.some((annotation) => annotation.kind === 'redaction')

    if (redacted && editorPage.kind !== 'blank') {
      // The redacted page is never copied: the output gets a fresh page holding
      // only the burned-in bitmap, so the covered content has no object in the
      // exported file to be recovered from. Refusing a missing bitmap is the
      // safety invariant — falling back to the original page would leak it.
      const raster = rasterized.get(editorPage.id)
      if (!raster) {
        throw new Error('A redacted page was not rasterized, so the export was stopped before anything could leak.')
      }
      const image = await output.embedPng(raster.png)
      const page = output.addPage([raster.width, raster.height])
      page.drawImage(image, { x: 0, y: 0, width: raster.width, height: raster.height })
      // The bitmap is already at display orientation; annotations therefore
      // paint against an unrotated page.
      for (const annotation of pageAnnotations) {
        if (annotation.kind === 'redaction') continue
        if (annotation.kind === 'form-field') {
          await emitCreatedFormField(output, page, annotation, 0, fonts, createdFields)
        } else {
          await paintAnnotation(output, page, annotation, 0, fonts)
        }
      }
      onProgress?.(index + 1, document.pages.length)
      continue
    }

    let page: PDFPage
    if (editorPage.kind === 'blank') {
      page = output.addPage([editorPage.width, editorPage.height])
    } else {
      const donor = editorPage.kind === 'original' ? source : await inserted.get(editorPage.documentId)
      const [copied] = await output.copyPages(donor, [editorPage.sourceIndex])
      output.addPage(copied)
      page = copied
    }
    await paintPage(output, page, editorPage, document, fonts, createdFields)
    onProgress?.(index + 1, document.pages.length)
  }

  finalizeCreatedFormFields(output, createdFields)
  finalizeFormOutput(output, formOutput)

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
  let source: PDFDocument
  try {
    source = await PDFDocument.load(sourceBytes.slice(), { ignoreEncryption: false, updateMetadata: false })
  } catch (error) {
    if (isEncryptedPdfError(error)) {
      // The open-time banner already said so; this backstop keeps the message
      // human if an export is somehow attempted anyway.
      throw new Error(
        'This PDF is encrypted (even a permissions-only lock counts), and LeafPDF cannot decrypt it to write an edited copy.',
        { cause: error },
      )
    }
    throw error
  }
  const features = analyzeLoadedPdf(source)
  const formOutput = options.formOutput ?? 'fillable'
  if (formOutput === 'flattened' && features.hasAcroForm && hasXfaForm(source)) {
    throw new Error('This PDF uses an XFA form, which LeafPDF cannot flatten safely. No file was saved.')
  }
  // The source page count is what makes a deletion distinguishable from an untouched
  // document; without it, deleting the last page reads as "nothing changed".
  const strategy = chooseExportStrategy(features, document, source.getPageCount())
  if (strategy === 'requires-confirmation' && !options.allowCompatibilityCopy) {
    throw new CompatibilityConfirmationRequired(features)
  }

  validateCreatedFieldsBeforeExport(
    source,
    document,
    features.hasAcroForm,
    strategy === 'preserve',
  )

  const inserted = new InsertedDocuments(options.insertedDocuments ?? new Map())
  return strategy === 'preserve'
    ? exportByPreserving(source, document, inserted, formOutput, options.onProgress)
    : exportByRebuilding(source, document, inserted, options.rasterizedPages ?? new Map(), formOutput, options.onProgress)
}

export { exportedFileName } from './exportNaming'
