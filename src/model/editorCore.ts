import { clampZoom } from './zoomFit'
import type { DateStampFormat } from './dateStamp'
import { nextCreatedFormFieldName, nextRadioOptionValue } from './createdFormFields'
import { movePageToIndex } from './pageReorder'

export type ShapeTool = 'rectangle' | 'ellipse' | 'line' | 'arrow'
export type StampTool = 'check' | 'cross' | 'dot' | 'date'
export type Tool = 'select' | 'text' | 'form-text' | 'form-checkbox' | 'form-radio' | 'form-dropdown' | 'highlight' | 'underline' | 'strikeout' | 'link' | 'whiteout' | 'redact' | 'pen' | 'image' | 'signature' | ShapeTool | StampTool

export interface NormalizedPoint {
  x: number
  y: number
}

export type PageRotation = 0 | 90 | 180 | 270

interface EditorPageBase {
  id: string
  rotation: PageRotation
}

/** A page of the PDF the user opened. */
export interface OriginalPage extends EditorPageBase {
  kind: 'original'
  sourceIndex: number
}

/** An empty page the user added, sized in PDF points. */
export interface BlankPage extends EditorPageBase {
  kind: 'blank'
  width: number
  height: number
}

/**
 * A page inserted from another PDF during this session. The other document's
 * bytes live in the session's inserted-document registry, keyed by
 * `documentId`; they are never persisted, so recovery drops these pages.
 */
export interface ExternalPage extends EditorPageBase {
  kind: 'external'
  documentId: string
  sourceIndex: number
}

export type EditorPage = OriginalPage | BlankPage | ExternalPage

interface AnnotationBase {
  id: string
  pageId: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
}

export type FontFamily = 'sans' | 'serif' | 'mono'
export type FontWeight = 400 | 700
export type FontStyle = 'normal' | 'italic'
export type TextDirection = 'ltr' | 'rtl'

/** Typography chosen for added text. Missing fields use sensible defaults. */
export interface TextStyle {
  fontFamily?: FontFamily
  fontWeight?: FontWeight
  fontStyle?: FontStyle
  direction?: TextDirection
}

export interface ResolvedTextStyle {
  fontFamily: FontFamily
  fontWeight: FontWeight
  fontStyle: FontStyle
  direction: TextDirection
}

export function textStyleOf(style: TextStyle): ResolvedTextStyle {
  return {
    fontFamily: style.fontFamily ?? 'sans',
    fontWeight: style.fontWeight ?? 400,
    fontStyle: style.fontStyle ?? 'normal',
    direction: style.direction ?? 'ltr',
  }
}

export interface TextAnnotation extends AnnotationBase, TextStyle {
  kind: 'text'
  text: string
  color: string
  fontSize: number
  opacity?: number
  /** Added over one or more whiteouts derived from selected source-PDF text. */
  sourceReplacement?: boolean
}

export type TextMarkStyle = 'highlight' | 'underline' | 'strikeout'

export interface HighlightAnnotation extends AnnotationBase {
  kind: 'highlight'
  color: string
  opacity: number
  /** Missing on legacy projects, where this annotation is a filled highlight. */
  mark?: TextMarkStyle
  /** PDF-point line weight for underline and strikeout. Legacy marks default to 2. */
  strokeWidth?: number
}

export function textMarkStyleOf(annotation: HighlightAnnotation): TextMarkStyle {
  return annotation.mark ?? 'highlight'
}

export function textMarkStrokeWidthOf(annotation: HighlightAnnotation): number {
  return annotation.strokeWidth ?? 2
}

export type LinkTargetType = 'url' | 'email' | 'phone'

/** An editor proof area that exports as a standard invisible PDF link. */
export interface LinkAnnotation extends AnnotationBase {
  kind: 'link'
  targetType: LinkTargetType
  /** Raw user input. Export normalizes and validates it before writing `/URI`. */
  target: string
}

/**
 * An opaque white visual cover. Unlike redaction, this is ordinary page content:
 * the original text or image remains underneath and may still be recoverable.
 */
export interface WhiteoutAnnotation extends AnnotationBase {
  kind: 'whiteout'
}

/**
 * A region marked for permanent removal. At export, every source-backed page
 * carrying one of these is replaced by a rasterized copy with the region burned
 * in black — the original page content does not exist in the exported file.
 * Always opaque black; anything configurable would invite a see-through "redaction".
 */
export interface RedactionAnnotation extends AnnotationBase {
  kind: 'redaction'
}

export interface InkAnnotation extends AnnotationBase {
  kind: 'ink'
  points: NormalizedPoint[]
  color: string
  strokeWidth: number
}

export interface ImageAnnotation extends AnnotationBase {
  kind: 'image'
  dataUrl: string
  mimeType: 'image/png' | 'image/jpeg'
  role?: 'image' | 'signature'
  /** Missing on legacy projects, where placed media is fully opaque. */
  opacity?: number
}

export function imageOpacityOf(annotation: ImageAnnotation): number {
  return annotation.opacity ?? 1
}

export interface ShapeAnnotation extends AnnotationBase {
  kind: 'shape'
  shape: ShapeTool
  strokeColor: string
  fillColor?: string
  strokeWidth: number
}

export interface StampAnnotation extends AnnotationBase {
  kind: 'stamp'
  stamp: StampTool
  label?: string
  dateValue?: string
  dateFormat?: DateStampFormat
  color: string
  strokeWidth: number
}

export type CreatedFormFieldType = 'text' | 'checkbox' | 'radio' | 'dropdown'

interface CreatedFormFieldBase extends AnnotationBase {
  kind: 'form-field'
  fieldType: CreatedFormFieldType
  fieldName: string
  required: boolean
  /** AcroForm widgets are axis-aligned; created fields intentionally cannot rotate. */
  rotation?: never
}

export interface CreatedTextFormFieldAnnotation extends CreatedFormFieldBase {
  fieldType: 'text'
  defaultText: string
  multiline: boolean
  checkedByDefault?: never
}

export interface CreatedCheckboxFormFieldAnnotation extends CreatedFormFieldBase {
  fieldType: 'checkbox'
  checkedByDefault: boolean
  defaultText?: never
  multiline?: never
}

export interface CreatedRadioFormFieldAnnotation extends CreatedFormFieldBase {
  fieldType: 'radio'
  optionValue: string
  selectedByDefault: boolean
  defaultText?: never
  multiline?: never
  checkedByDefault?: never
  options?: never
  defaultOption?: never
}

export interface CreatedDropdownFormFieldAnnotation extends CreatedFormFieldBase {
  fieldType: 'dropdown'
  options: string[]
  defaultOption: string
  defaultText?: never
  multiline?: never
  checkedByDefault?: never
  optionValue?: never
  selectedByDefault?: never
}

export type CreatedFormFieldAnnotation =
  | CreatedTextFormFieldAnnotation
  | CreatedCheckboxFormFieldAnnotation
  | CreatedRadioFormFieldAnnotation
  | CreatedDropdownFormFieldAnnotation

export type Annotation =
  | TextAnnotation
  | HighlightAnnotation
  | LinkAnnotation
  | WhiteoutAnnotation
  | RedactionAnnotation
  | InkAnnotation
  | ImageAnnotation
  | ShapeAnnotation
  | StampAnnotation
  | CreatedFormFieldAnnotation

export const DEFAULT_ADDED_TEXT = 'Type here'

export function replacementTextForWhiteout(
  whiteout: WhiteoutAnnotation,
  id: string,
): TextAnnotation {
  return {
    id,
    pageId: whiteout.pageId,
    kind: 'text',
    x: whiteout.x,
    y: whiteout.y,
    width: whiteout.width,
    height: whiteout.height,
    rotation: whiteout.rotation,
    text: DEFAULT_ADDED_TEXT,
    color: '#182026',
    fontSize: 18,
  }
}

export function isUnfinishedTextAnnotation(annotation: Annotation): annotation is TextAnnotation {
  if (annotation.kind !== 'text') return false
  const text = annotation.text.trim()
  return text.length === 0 || text === DEFAULT_ADDED_TEXT
}

/** True when any page of the document carries a pending redaction. */
export function hasRedactions(document: EditorDocument): boolean {
  return document.annotations.some((annotation) => annotation.kind === 'redaction')
}

/** A filled AcroForm value: text/radio/dropdown store strings, checkboxes booleans. */
export type FormValue = string | boolean

export interface EditorDocument {
  fileName: string
  pages: EditorPage[]
  annotations: Annotation[]
  /**
   * Values the user typed into the source PDF's own form fields, keyed by fully
   * qualified field name. Only fields the user actually edited appear here;
   * untouched fields keep whatever the source PDF stores. Living in the document
   * gives form filling undo/redo, the dirty flag, and recovery for free.
   */
  formValues: Record<string, FormValue>
}

export interface EditorState {
  past: EditorDocument[]
  present: EditorDocument
  future: EditorDocument[]
  selectedPageId: string
  /** Ordered, same-page annotation selection. Empty means no selected item. */
  selectedAnnotationIds: string[]
  activeTool: Tool
  zoom: number
  /**
   * Identifies the run of related edits currently collapsing into one undo entry,
   * such as a single typing session in one field. Null when no group is open.
   */
  historyGroupKey: string | null
  /** True when the document differs from the last exported file. */
  dirty: boolean
  /** In-app object clipboard; deliberately separate from the system clipboard. */
  clipboard: Annotation | null
}

export type EditorAction =
  | { type: 'selectPage'; pageId: string }
  /**
   * Scroll-driven variant of selectPage: the page under the viewport centre
   * becomes current without clearing the annotation selection, so scrolling
   * past other pages never deselects what the user is working on.
   */
  | { type: 'viewPage'; pageId: string }
  | { type: 'selectAnnotation'; annotationId: string | null }
  | { type: 'toggleAnnotationSelection'; annotationId: string }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setZoom'; zoom: number }
  | { type: 'rotatePage'; pageId: string; degrees: 90 | -90 }
  | { type: 'movePage'; pageId: string; direction: -1 | 1 }
  | { type: 'movePageToIndex'; pageId: string; targetIndex: number }
  | { type: 'removePage'; pageId: string }
  /** Insert ready-made pages after `afterPageId`, or at the front when null. */
  | { type: 'insertPages'; afterPageId: string | null; pages: EditorPage[] }
  | { type: 'addAnnotation'; annotation: Annotation }
  | {
      type: 'addAnnotations'
      annotations: Annotation[]
      historyGroup?: string
      /** Batch-generated annotations stay out of the inline editor. */
      selectLast?: boolean
    }
  | { type: 'updateAnnotation'; annotationId: string; patch: Partial<Annotation>; historyGroup?: string }
  | { type: 'replaceAnnotation'; annotation: Annotation }
  | { type: 'replaceAnnotations'; annotations: Annotation[]; historyGroup?: string }
  | { type: 'removeAnnotation'; annotationId: string }
  | { type: 'removeAnnotations'; annotationIds: string[] }
  | { type: 'copyAnnotation'; annotationId: string }
  | { type: 'pasteAnnotation'; pageId: string; newId: string }
  | { type: 'duplicateAnnotation'; annotationId: string; newId: string }
  | { type: 'bringForward'; annotationId: string }
  | { type: 'sendBackward'; annotationId: string }
  | { type: 'restoreDocument'; document: EditorDocument }
  | { type: 'setFormValue'; fieldName: string; value: FormValue; historyGroup?: string }
  | { type: 'endHistoryGroup' }
  /**
   * Carries the exact document that was written to disk. Export runs
   * asynchronously, so by the time it finishes the user may have edited further;
   * only the document that was actually exported may clear the dirty flag.
   */
  | { type: 'markSaved'; document: EditorDocument }
  | { type: 'undo' }
  | { type: 'redo' }

const HISTORY_LIMIT = 50

export function createEditorState(fileName: string, pageCount: number): EditorState {
  if (pageCount < 1) throw new Error('A PDF must contain at least one page.')
  const pages: EditorPage[] = Array.from({ length: pageCount }, (_, index) => ({
    id: `page-${index + 1}`,
    kind: 'original',
    sourceIndex: index,
    rotation: 0,
  }))
  return {
    past: [],
    present: { fileName, pages, annotations: [], formValues: {} },
    future: [],
    selectedPageId: pages[0].id,
    selectedAnnotationIds: [],
    activeTool: 'select',
    zoom: 1,
    historyGroupKey: null,
    dirty: false,
    clipboard: null,
  }
}

/**
 * Record a document change as its own undo entry and close any open group. Every
 * edit that is not part of a typing-style run goes through here.
 */
function commit(state: EditorState, present: EditorDocument): EditorState {
  if (present === state.present) return state
  return {
    ...state,
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    historyGroupKey: null,
    dirty: true,
  }
}

/**
 * Record a change that belongs to a run of related edits. The first action in a
 * group snapshots the document; later actions with the same key replace `present`
 * without adding another snapshot, so one typing session undoes in one step.
 */
function commitGrouped(state: EditorState, present: EditorDocument, groupKey: string): EditorState {
  if (present === state.present) return state
  if (state.historyGroupKey === groupKey) {
    return { ...state, present, future: [], dirty: true }
  }
  return {
    ...state,
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    historyGroupKey: groupKey,
    dirty: true,
  }
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  return (((value % 360) + 360) % 360) as 0 | 90 | 180 | 270
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'selectPage':
      return state.present.pages.some((page) => page.id === action.pageId)
        ? {
            ...state,
            selectedPageId: action.pageId,
            selectedAnnotationIds: [],
            historyGroupKey: null,
          }
        : state
    case 'viewPage':
      return state.selectedPageId !== action.pageId && state.present.pages.some((page) => page.id === action.pageId)
        ? { ...state, selectedPageId: action.pageId }
        : state
    case 'selectAnnotation': {
      if (action.annotationId !== null
        && !state.present.annotations.some(({ id }) => id === action.annotationId)) return state
      const selectedAnnotationIds = action.annotationId === null ? [] : [action.annotationId]
      const unchangedSelection = state.selectedAnnotationIds.length === selectedAnnotationIds.length
        && state.selectedAnnotationIds.every((id, index) => id === selectedAnnotationIds[index])
      const groupBelongsToSelection = action.annotationId !== null
        && state.historyGroupKey?.startsWith(`annotation-${action.annotationId}-`)
      if (unchangedSelection && (state.historyGroupKey === null || groupBelongsToSelection)) return state
      return { ...state, selectedAnnotationIds, historyGroupKey: null }
    }
    case 'toggleAnnotationSelection': {
      const annotation = state.present.annotations.find(({ id }) => id === action.annotationId)
      if (!annotation) return state
      const selected = state.selectedAnnotationIds.includes(annotation.id)
      const selectedAnnotations = state.present.annotations.filter(({ id }) =>
        state.selectedAnnotationIds.includes(id))
      const samePage = selectedAnnotations.every(({ pageId }) => pageId === annotation.pageId)
      const selectedAnnotationIds = selected
        ? state.selectedAnnotationIds.filter((id) => id !== annotation.id)
        : samePage
          ? [...state.selectedAnnotationIds, annotation.id]
          : [annotation.id]
      return {
        ...state,
        selectedPageId: annotation.pageId,
        selectedAnnotationIds,
        historyGroupKey: null,
      }
    }
    case 'setTool':
      return { ...state, activeTool: action.tool, selectedAnnotationIds: [], historyGroupKey: null }
    case 'setZoom':
      return { ...state, zoom: clampZoom(action.zoom) }
    case 'rotatePage': {
      const pages = state.present.pages.map((page) =>
        page.id === action.pageId
          ? { ...page, rotation: normalizeRotation(page.rotation + action.degrees) }
          : page,
      )
      return commit(state, { ...state.present, pages })
    }
    case 'movePage': {
      const index = state.present.pages.findIndex((page) => page.id === action.pageId)
      const target = index + action.direction
      if (index < 0 || target < 0 || target >= state.present.pages.length) return state
      const pages = [...state.present.pages]
      ;[pages[index], pages[target]] = [pages[target], pages[index]]
      return commit(state, { ...state.present, pages })
    }
    case 'movePageToIndex': {
      const pages = movePageToIndex(state.present.pages, action.pageId, action.targetIndex)
      return pages === state.present.pages ? state : commit(state, { ...state.present, pages })
    }
    case 'removePage': {
      if (state.present.pages.length === 1) return state
      const index = state.present.pages.findIndex((page) => page.id === action.pageId)
      if (index < 0) return state
      const pages = state.present.pages.filter((page) => page.id !== action.pageId)
      const annotations = state.present.annotations.filter((annotation) => annotation.pageId !== action.pageId)
      const selectedPageId = state.selectedPageId === action.pageId
        ? pages[Math.min(index, pages.length - 1)].id
        : state.selectedPageId
      return {
        ...commit(state, { ...state.present, pages, annotations }),
        selectedPageId,
        selectedAnnotationIds: [],
      }
    }
    case 'insertPages': {
      if (action.pages.length === 0) return state
      const existingIds = new Set(state.present.pages.map((page) => page.id))
      if (action.pages.some((page) => existingIds.has(page.id))) return state
      const at = action.afterPageId === null
        ? 0
        : state.present.pages.findIndex((page) => page.id === action.afterPageId) + 1
      if (at === 0 && action.afterPageId !== null) return state
      const pages = [
        ...state.present.pages.slice(0, at),
        ...action.pages,
        ...state.present.pages.slice(at),
      ]
      return {
        ...commit(state, { ...state.present, pages }),
        selectedPageId: action.pages[0].id,
        selectedAnnotationIds: [],
      }
    }
    case 'addAnnotation':
      return {
        ...commit(state, {
          ...state.present,
          annotations: [...state.present.annotations, action.annotation],
        }),
        selectedAnnotationIds: [action.annotation.id],
        activeTool: 'select',
      }
    case 'addAnnotations':
      if (action.annotations.length === 0) return state
      return {
        ...(action.historyGroup
          ? commitGrouped(state, {
              ...state.present,
              annotations: [...state.present.annotations, ...action.annotations],
            }, action.historyGroup)
          : commit(state, {
              ...state.present,
              annotations: [...state.present.annotations, ...action.annotations],
            })),
        selectedAnnotationIds: action.selectLast === false
          ? []
          : action.annotations.at(-1)?.id ? [action.annotations.at(-1)!.id] : [],
        activeTool: 'select',
      }
    case 'updateAnnotation': {
      const annotations = state.present.annotations.map((annotation) =>
        annotation.id === action.annotationId
          ? ({ ...annotation, ...action.patch, id: annotation.id, pageId: annotation.pageId, kind: annotation.kind } as Annotation)
          : annotation,
      )
      const next = { ...state.present, annotations }
      return action.historyGroup
        ? commitGrouped(state, next, action.historyGroup)
        : commit(state, next)
    }
    case 'replaceAnnotation': {
      const index = state.present.annotations.findIndex((annotation) => annotation.id === action.annotation.id)
      if (index < 0) return state
      if (state.present.annotations[index] === action.annotation) return state
      const annotations = [...state.present.annotations]
      annotations[index] = action.annotation
      return commit(state, { ...state.present, annotations })
    }
    case 'replaceAnnotations': {
      if (action.annotations.length === 0) return state
      const replacements = new Map(action.annotations.map((annotation) => [annotation.id, annotation]))
      if (replacements.size !== action.annotations.length) return state
      const currentById = new Map(state.present.annotations.map((annotation) => [annotation.id, annotation]))
      if (action.annotations.some((annotation) => {
        const current = currentById.get(annotation.id)
        return !current || current.pageId !== annotation.pageId || current.kind !== annotation.kind
      })) return state
      let changed = false
      const annotations = state.present.annotations.map((annotation) => {
        const replacement = replacements.get(annotation.id)
        if (!replacement || replacement === annotation) return annotation
        changed = true
        return replacement
      })
      if (!changed) return state
      const next = { ...state.present, annotations }
      return action.historyGroup
        ? commitGrouped(state, next, action.historyGroup)
        : commit(state, next)
    }
    case 'removeAnnotation':
      return {
        ...commit(state, {
          ...state.present,
          annotations: state.present.annotations.filter((annotation) => annotation.id !== action.annotationId),
        }),
        selectedAnnotationIds: state.selectedAnnotationIds.filter((id) => id !== action.annotationId),
      }
    case 'removeAnnotations': {
      const removedIds = new Set(action.annotationIds)
      if (removedIds.size === 0) return state
      const annotations = state.present.annotations.filter((annotation) => !removedIds.has(annotation.id))
      if (annotations.length === state.present.annotations.length) return state
      return {
        ...commit(state, { ...state.present, annotations }),
        selectedAnnotationIds: state.selectedAnnotationIds.filter((id) => !removedIds.has(id)),
      }
    }
    case 'copyAnnotation': {
      const annotation = state.present.annotations.find(({ id }) => id === action.annotationId)
      return annotation ? { ...state, clipboard: structuredClone(annotation) } : state
    }
    case 'pasteAnnotation': {
      if (!state.clipboard) return state
      const annotation = offsetClone(state.clipboard, action.newId, action.pageId, state.present.annotations)
      return {
        ...commit(state, { ...state.present, annotations: [...state.present.annotations, annotation] }),
        selectedPageId: action.pageId,
        selectedAnnotationIds: [annotation.id],
      }
    }
    case 'duplicateAnnotation': {
      const source = state.present.annotations.find(({ id }) => id === action.annotationId)
      if (!source) return state
      const annotation = offsetClone(source, action.newId, source.pageId, state.present.annotations)
      return {
        ...commit(state, { ...state.present, annotations: [...state.present.annotations, annotation] }),
        selectedAnnotationIds: [annotation.id],
      }
    }
    case 'bringForward':
    case 'sendBackward': {
      const annotations = [...state.present.annotations]
      const index = annotations.findIndex(({ id }) => id === action.annotationId)
      if (index < 0) return state
      const direction = action.type === 'bringForward' ? 1 : -1
      let target = index + direction
      while (target >= 0 && target < annotations.length && annotations[target].pageId !== annotations[index].pageId) {
        target += direction
      }
      if (target < 0 || target >= annotations.length) return state
      ;[annotations[index], annotations[target]] = [annotations[target], annotations[index]]
      return commit(state, { ...state.present, annotations })
    }
    case 'setFormValue': {
      if (state.present.formValues[action.fieldName] === action.value) return state
      const next = {
        ...state.present,
        formValues: { ...state.present.formValues, [action.fieldName]: action.value },
      }
      return action.historyGroup
        ? commitGrouped(state, next, action.historyGroup)
        : commit(state, next)
    }
    case 'restoreDocument':
      if (action.document.pages.length === 0) return state
      return {
        ...state,
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: action.document,
        future: [],
        selectedPageId: action.document.pages[0].id,
        selectedAnnotationIds: [],
        historyGroupKey: null,
        dirty: true,
      }
    case 'endHistoryGroup':
      return state.historyGroupKey === null ? state : { ...state, historyGroupKey: null }
    case 'markSaved':
      // Every edit replaces `present` with a new object, so reference equality is
      // exactly the question being asked: is the exported document still current?
      if (state.present !== action.document) return state
      return state.dirty ? { ...state, dirty: false } : state
    case 'undo': {
      const previous = state.past.at(-1)
      if (!previous) return state
      const pageExists = previous.pages.some((page) => page.id === state.selectedPageId)
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future].slice(0, HISTORY_LIMIT),
        selectedPageId: pageExists ? state.selectedPageId : previous.pages[0].id,
        selectedAnnotationIds: [],
        historyGroupKey: null,
        // Stepping back through history still leaves the exported file out of date.
        dirty: true,
      }
    }
    case 'redo': {
      const next = state.future[0]
      if (!next) return state
      const pageExists = next.pages.some((page) => page.id === state.selectedPageId)
      return {
        ...state,
        past: [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        future: state.future.slice(1),
        selectedPageId: pageExists ? state.selectedPageId : next.pages[0].id,
        selectedAnnotationIds: [],
        historyGroupKey: null,
        dirty: true,
      }
    }
  }
}

export function annotationId(): string {
  return `annotation-${crypto.randomUUID()}`
}

function offsetClone(
  source: Annotation,
  id: string,
  pageId: string,
  annotations: readonly Annotation[],
): Annotation {
  const clone = structuredClone(source)
  if (clone.kind === 'ink') {
    const maxX = Math.max(...clone.points.map(({ x }) => x), 0)
    const maxY = Math.max(...clone.points.map(({ y }) => y), 0)
    const dx = Math.min(0.02, 1 - maxX)
    const dy = Math.min(0.02, 1 - maxY)
    return {
      ...clone, id, pageId,
      points: clone.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    }
  }
  const offset = {
    ...clone, id, pageId,
    x: Math.round(Math.min(1 - clone.width, clone.x + 0.02) * 1e6) / 1e6,
    y: Math.round(Math.min(1 - clone.height, clone.y + 0.02) * 1e6) / 1e6,
  }
  if (offset.kind !== 'form-field') return offset
  if (offset.fieldType === 'radio') {
    const gap = 0.015
    const maxX = 1 - clone.width
    const maxY = 1 - clone.height
    const beside = clone.x + clone.width + gap
    const below = clone.y + clone.height + gap
    const position = beside <= maxX
      ? { x: beside, y: clone.y }
      : below <= maxY
        ? { x: clone.x, y: below }
        : { x: Math.max(0, clone.x - clone.width - gap), y: clone.y }
    return {
      ...offset,
      x: Math.round(position.x * 1e6) / 1e6,
      y: Math.round(position.y * 1e6) / 1e6,
      optionValue: nextRadioOptionValue(offset.fieldName, annotations),
      selectedByDefault: false,
    }
  }
  return { ...offset, fieldName: nextCreatedFormFieldName(offset.fieldType, annotations) }
}
