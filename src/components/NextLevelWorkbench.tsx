import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { comparePdfText, type PdfComparisonResult } from '../compare/pdfComparison'
import {
  annotationId,
  createEditorState,
  editorReducer,
  isUnfinishedTextAnnotation,
  type EditorDocument,
  type EditorPage,
  type ExternalPage,
  type ImageAnnotation,
  type NormalizedPoint,
  type TextAnnotation,
  type Tool,
} from '../model/editor'
import {
  adjacentFormFieldTarget,
  firstFormFieldTarget,
  type FormFieldDirection,
  type FormFieldFocusRequest,
  type FormFieldTarget,
} from '../model/formNavigation'
import { validatePlacedImage } from '../model/imageValidation'
import { externalLinkDestination } from '../model/linkTarget'
import {
  mediaAnnotationAtPoint,
  replacementMediaBounds,
  type MediaSurfaceSize,
  type PendingMediaPlacement,
} from '../model/mediaPlacement'
import type { PersonalDetails, PreparedDetailPlacement } from '../model/personalDetails'
import {
  advanceSearchReplacementBatch,
  createSearchReplacementBatch,
  currentSearchReplacementRequest,
  sourceSearchEntries,
  type SearchReplacementBatch,
  type SearchReplacementRequest,
} from '../model/searchReplacement'
import { nativeOcrAvailable, runNativeOcr } from '../ocr/nativeOcr'
import { addStandardTextComments, importStandardTextComments } from '../pdf/standardAnnotationInterop'
import { sanitizeInWorker } from '../pdf/sanitizeClient'
import { formatFileSize, MAX_PDF_BYTES } from '../pdf/loadPdf'
import {
  searchCursorEntries,
  searchDocument,
  type PageMatches,
  type SearchCursorEntry,
} from '../pdf/textSearch'
import type { ExportProgress, PdfFormOutput } from '../pdf/exportWorkerProtocol'
import type { SourcePdfFeatures } from '../pdf/sourceFeatures'
import type { LoadedPdf } from '../pdf/types'
import { readPageFormFields, type FormFieldWidget } from '../pdf/formFields'
import {
  createLeafProject,
  hydrateLeafProject,
  projectFileName,
  serializeLeafProject,
} from '../project/projectFormat'
import {
  deleteProjectRecovery,
  loadProjectRecovery,
  projectRecoveryKey,
  saveProjectRecovery,
} from '../project/projectRecovery'
import type {
  LeafProject,
  OcrPageResult,
  OpenedLeafProject,
  ReviewComment,
} from '../project/projectTypes'
import { buildPrivacyReport } from '../privacy/privacyReport'
import {
  PDF_SAVE_TYPE,
  PROJECT_SAVE_TYPE,
  requestPersistentStorage,
  saveLocalBlob,
} from '../pwa/fileAccess'
import {
  deletePersonalDetails,
  deleteSignature,
  loadPersonalDetails,
  loadSignatures,
  savePersonalDetails,
  saveSignature,
  type SavedSignature,
} from '../persistence/localStore'
import { RecoveryQueue } from '../persistence/recoveryQueue'
import { ComparisonPanel } from './ComparisonPanel'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { DetailsPanel } from './DetailsPanel'
import { DocumentMarksDialog, type DocumentMarkRequest } from './DocumentMarksDialog'
import { ExportCompatibilityDialog } from './ExportCompatibilityDialog'
import { FormFieldGuide } from './FormFieldGuide'
import { HelpPanel } from './HelpPanel'
import { Inspector } from './Inspector'
import { MultiSelectionInspector } from './MultiSelectionInspector'
import { OcrPanel } from './OcrPanel'
import { PageRail } from './PageRail'
import { PageStrip } from './PageStrip'
import { PdfSaveMenu } from './PdfSaveMenu'
import { PrivacyPanel } from './PrivacyPanel'
import { ProjectToolsMenu } from './ProjectToolsMenu'
import { RecoveryDialog } from './RecoveryDialog'
import { ReviewPanel } from './ReviewPanel'
import { SearchReplacePopover } from './SearchReplacePopover'
import { SIGNATURE_ASPECT_RATIO, SignatureDialog } from './SignatureDialog'
import { SkipNavigation } from './SkipNavigation'
import { ToolPlacementHint } from './ToolPlacementHint'
import { ToolRail } from './ToolRail'
import { UnfinishedTextDialog } from './UnfinishedTextDialog'
import { ZoomControl, type ZoomMode } from './ZoomControl'

interface NextLevelWorkbenchProps {
  loaded: LoadedPdf
  initialProject?: OpenedLeafProject | null
  closing?: boolean
  onClose: () => void
}

interface SavedPdfReceipt {
  document: EditorDocument
  comments: ReviewComment[]
}

type InsertedPdfEntry = { file: File; pdf: PDFDocumentProxy }
type NextPanel = 'review' | 'privacy' | 'ocr' | 'compare' | 'help' | 'details' | null

const NUDGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The image could not be read.'))
    reader.readAsDataURL(file)
  })
}

function initialEditorState(loaded: LoadedPdf, project?: OpenedLeafProject | null) {
  const state = createEditorState(loaded.fileName, loaded.pageCount)
  if (!project) return state
  const document = structuredClone(project.project.document)
  return {
    ...state,
    present: document,
    selectedPageId: document.pages[0].id,
    dirty: false,
  }
}

async function loadInsertedPdfMap(files: Map<string, File>): Promise<Map<string, InsertedPdfEntry>> {
  const { getDocument } = await import('pdfjs-dist')
  const entries = await Promise.all(Array.from(files, async ([id, file]) => {
    const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    return [id, { file, pdf }] as const
  }))
  return new Map(entries)
}

function sourceSignature(primary: File, inserted: Map<string, InsertedPdfEntry>): string {
  return [
    `${primary.name}:${primary.size}:${primary.lastModified}`,
    ...Array.from(inserted, ([id, { file }]) => `${id}:${file.name}:${file.size}:${file.lastModified}`).sort(),
  ].join('|')
}

function sanitizedFileName(sourceName: string): string {
  const stem = sourceName.replace(/\.pdf$/i, '') || 'document'
  return `${stem}-sanitized.pdf`
}

export function NextLevelWorkbench({
  loaded,
  initialProject = null,
  closing = false,
  onClose,
}: NextLevelWorkbenchProps) {
  const [state, dispatch] = useReducer(
    editorReducer,
    undefined,
    () => initialEditorState(loaded, initialProject),
  )
  const [insertedPdfs, setInsertedPdfs] = useState<Map<string, InsertedPdfEntry>>(new Map())
  const [projectReady, setProjectReady] = useState(initialProject === null)
  const [projectSavedDocument, setProjectSavedDocument] = useState<EditorDocument>(() => state.present)
  const [projectOnlyDirty, setProjectOnlyDirty] = useState(false)
  const [comments, setComments] = useState<ReviewComment[]>(() => structuredClone(initialProject?.project.comments ?? []))
  const [ocr, setOcr] = useState<OcrPageResult[]>(() => structuredClone(initialProject?.project.ocr ?? []))
  const [activePanel, setActivePanel] = useState<NextPanel>(null)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [savedPdfReceipt, setSavedPdfReceipt] = useState<SavedPdfReceipt | null>(null)
  const [savingProject, setSavingProject] = useState(false)
  const [sanitizing, setSanitizing] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [comparisonName, setComparisonName] = useState<string | null>(null)
  const [comparison, setComparison] = useState<PdfComparisonResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [compatibilityFeatures, setCompatibilityFeatures] = useState<SourcePdfFeatures | null>(null)
  const [unfinishedText, setUnfinishedText] = useState<TextAnnotation[]>([])
  const [pendingFormOutput, setPendingFormOutput] = useState<PdfFormOutput>('fillable')
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [marksOpen, setMarksOpen] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryProject, setRecoveryProject] = useState<LeafProject | null>(null)
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([])
  const [savedDetails, setSavedDetails] = useState<PersonalDetails | null>(null)
  const [savingDetails, setSavingDetails] = useState(false)
  const [pendingDetail, setPendingDetail] = useState<PreparedDetailPlacement | null>(null)
  const [pendingMedia, setPendingMedia] = useState<PendingMediaPlacement | null>(null)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PageMatches[] | null>(null)
  const [searchCursor, setSearchCursor] = useState(0)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacementText, setReplacementText] = useState('')
  const [replacementBatch, setReplacementBatch] = useState<SearchReplacementBatch | null>(null)
  const [formGuideOpen, setFormGuideOpen] = useState(loaded.features.hasAcroForm)
  const [formFieldTarget, setFormFieldTarget] = useState<FormFieldTarget | null>(null)
  const [formFieldFocusRequest, setFormFieldFocusRequest] = useState<FormFieldFocusRequest | null>(null)
  const [formNavigationBusy, setFormNavigationBusy] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const nudgeTimerRef = useRef<number | null>(null)
  const formFocusRequestCounter = useRef(0)
  const formWidgetsCacheRef = useRef<{
    document: PDFDocumentProxy
    pages: Map<number, Promise<FormFieldWidget[]>>
  }>({ document: loaded.document, pages: new Map() })
  const pageSurfaceSizesRef = useRef(new Map<string, MediaSurfaceSize>())
  const [scrollTargetPageId, setScrollTargetPageId] = useState<string | null>(null)
  const pageOrderSignature = state.present.pages.map(({ id }) => id).join('\u0000')
  const previousPageOrderSignatureRef = useRef(pageOrderSignature)
  const [zoomMode, setZoomMode] = useState<ZoomMode>('manual')
  const [fitWidthRequest, setFitWidthRequest] = useState(0)

  const latestDocument = useRef(state.present)
  const latestComments = useRef(comments)
  const latestOcr = useRef(ocr)
  const insertedPdfsRef = useRef(insertedPdfs)
  const projectSourceCache = useRef<{ signature: string; project: LeafProject } | null>(
    initialProject ? { signature: '', project: structuredClone(initialProject.project) } : null,
  )
  const recoveryQueue = useRef(new RecoveryQueue<LeafProject>(saveProjectRecovery, deleteProjectRecovery))
  const loadFormWidgets = useCallback((sourceIndex: number) => {
    if (formWidgetsCacheRef.current.document !== loaded.document) {
      formWidgetsCacheRef.current = { document: loaded.document, pages: new Map() }
    }
    const cache = formWidgetsCacheRef.current.pages
    const cached = cache.get(sourceIndex)
    if (cached) return cached
    const request = readPageFormFields(loaded.document, sourceIndex + 1)
      .catch(() => [] as FormFieldWidget[])
    cache.set(sourceIndex, request)
    return request
  }, [loaded.document])

  const setManualZoom = useCallback((zoom: number) => {
    setZoomMode('manual')
    dispatch({ type: 'setZoom', zoom })
  }, [])
  const fitPageWidth = useCallback(() => {
    setZoomMode('fit-width')
    setFitWidthRequest((current) => current + 1)
  }, [])
  const changeTool = useCallback((tool: Tool) => {
    setMultiSelectMode(false)
    dispatch({ type: 'setTool', tool })
  }, [])
  const selectEditorPage = useCallback((pageId: string) => {
    setMultiSelectMode(false)
    dispatch({ type: 'selectPage', pageId })
  }, [])

  useEffect(() => {
    if (previousPageOrderSignatureRef.current === pageOrderSignature) return
    previousPageOrderSignatureRef.current = pageOrderSignature
    // Reordering, inserting, deleting, Undo, and Redo can move the selected page
    // under a fixed scroll offset. Keep the paper aligned with the selected id.
    setScrollTargetPageId(state.selectedPageId)
  }, [pageOrderSignature, state.selectedPageId])
  const applyFitZoom = useCallback((zoom: number) => {
    dispatch({ type: 'setZoom', zoom })
  }, [])

  useEffect(() => { latestDocument.current = state.present }, [state.present])
  useEffect(() => { latestComments.current = comments }, [comments])
  useEffect(() => { latestOcr.current = ocr }, [ocr])
  useEffect(() => { insertedPdfsRef.current = insertedPdfs }, [insertedPdfs])

  useEffect(() => {
    if (!initialProject) return
    let active = true
    void loadInsertedPdfMap(initialProject.insertedFiles).then((loadedInserted) => {
      if (!active) {
        for (const entry of loadedInserted.values()) void entry.pdf.loadingTask.destroy().catch(() => undefined)
        return
      }
      setInsertedPdfs(loadedInserted)
      projectSourceCache.current = {
        signature: sourceSignature(loaded.sourceFile, loadedInserted),
        project: structuredClone(initialProject.project),
      }
      setProjectReady(true)
    }).catch((error) => {
      if (active) {
        setNotice(error instanceof Error ? `Project open failed: ${error.message}` : 'Project open failed.')
        setProjectReady(true)
      }
    })
    return () => { active = false }
  }, [initialProject, loaded.sourceFile])

  useEffect(() => () => {
    for (const entry of insertedPdfsRef.current.values()) {
      void entry.pdf.loadingTask.destroy().catch(() => undefined)
    }
  }, [])

  const externalDocuments = useMemo(
    () => new Map(Array.from(insertedPdfs, ([id, entry]) => [id, entry.pdf])),
    [insertedPdfs],
  )
  const selectedPage = state.present.pages.find((page) => page.id === state.selectedPageId) ?? state.present.pages[0]
  const selectedAnnotations = state.present.annotations.filter(({ id }) => state.selectedAnnotationIds.includes(id))
  const selectedAnnotation = selectedAnnotations.length === 1 ? selectedAnnotations[0] : null
  const pageNumberById = useMemo(
    () => new Map(state.present.pages.map((page, index) => [page.id, index + 1])),
    [state.present.pages],
  )
  const projectDirty = state.present !== projectSavedDocument || projectOnlyDirty
  const pdfCopyCurrent = savedPdfReceipt !== null
    && savedPdfReceipt.document === state.present
    && savedPdfReceipt.comments === comments
  const pdfSaveStatus = savedPdfReceipt === null
    ? { label: 'Ready to save PDF', tone: 'ready' }
    : pdfCopyCurrent
      ? { label: 'PDF copy saved', tone: 'saved' }
      : { label: 'New changes to save', tone: 'stale' }
  const visibleNotice = savedPdfReceipt !== null
    && !pdfCopyCurrent
    && (notice?.startsWith('Saved fillable PDF as ') || notice?.startsWith('Saved flattened PDF as '))
    ? null
    : notice
  const modalOpen = signatureOpen
    || pagesOpen
    || discardOpen
    || marksOpen
    || recoveryOpen
    || compatibilityFeatures !== null
    || unfinishedText.length > 0
  const recoveryKey = useMemo(
    () => projectRecoveryKey(loaded.sourceFile, loaded.documentFingerprint),
    [loaded.documentFingerprint, loaded.sourceFile],
  )
  const privacyReport = useMemo(
    () => buildPrivacyReport(loaded.features, state.present, comments, ocr),
    [loaded.features, state.present, comments, ocr],
  )
  const selectedOcr = ocr.find((result) => result.pageId === selectedPage.id) ?? null

  const commitPendingMedia = useCallback((pageId: string, point: NormalizedPoint, surface?: MediaSurfaceSize) => {
    if (!pendingMedia) return
    const placementSurface = surface ?? pageSurfaceSizesRef.current.get(pageId)
    if (!placementSurface) {
      setNotice('This page is still loading. Wait for it to appear, then press Enter again.')
      return
    }
    const role = pendingMedia.role === 'signature' ? 'Signature' : 'Image'
    selectEditorPage(pageId)
    dispatch({
      type: 'addAnnotation',
      annotation: mediaAnnotationAtPoint(pendingMedia, pageId, point, annotationId(), placementSurface),
    })
    setPendingMedia(null)
    setNotice(`${role} placed. Resize if needed, then choose Done.`)
  }, [pendingMedia, selectEditorPage])

  const navigateToPage = useCallback((pageId: string) => {
    selectEditorPage(pageId)
    setScrollTargetPageId(pageId)
  }, [selectEditorPage])

  const focusFormTarget = useCallback((target: FormFieldTarget) => {
    formFocusRequestCounter.current += 1
    setFormFieldTarget(target)
    setFormFieldFocusRequest({
      requestId: `form-focus-${formFocusRequestCounter.current}`,
      pageId: target.pageId,
      widgetId: target.widgetId,
    })
    navigateToPage(target.pageId)
  }, [navigateToPage])

  const startFormNavigation = useCallback(async () => {
    setFormNavigationBusy(true)
    setPendingMedia(null)
    setPendingDetail(null)
    changeTool('select')
    try {
      const target = await firstFormFieldTarget(state.present.pages, loadFormWidgets)
      if (!target) {
        setNotice('This PDF has no text, choice, or checkbox fields LeafPDF can fill.')
        return
      }
      focusFormTarget(target)
    } finally {
      setFormNavigationBusy(false)
    }
  }, [changeTool, focusFormTarget, loadFormWidgets, state.present.pages])

  const moveFormNavigation = useCallback(async (direction: FormFieldDirection) => {
    if (!formFieldTarget) {
      await startFormNavigation()
      return
    }
    setFormNavigationBusy(true)
    try {
      const target = await adjacentFormFieldTarget(
        state.present.pages,
        formFieldTarget,
        direction,
        loadFormWidgets,
      )
      if (!target) {
        setNotice(direction === 'next'
          ? 'This is the last fillable field.'
          : 'This is the first fillable field.')
        return
      }
      focusFormTarget(target)
    } finally {
      setFormNavigationBusy(false)
    }
  }, [focusFormTarget, formFieldTarget, loadFormWidgets, startFormNavigation, state.present.pages])

  const handleFormFieldFocus = useCallback((target: FormFieldTarget) => {
    setFormFieldTarget(target)
  }, [])

  const handleFormFocusRequestHandled = useCallback((requestId: string) => {
    setFormFieldFocusRequest((current) => current?.requestId === requestId ? null : current)
  }, [])

  const buildProject = useCallback(async (
    documentSnapshot: EditorDocument,
    commentsSnapshot: ReviewComment[],
    ocrSnapshot: OcrPageResult[],
  ): Promise<LeafProject> => {
    const signature = sourceSignature(loaded.sourceFile, insertedPdfs)
    let base = projectSourceCache.current
    if (!base || base.signature !== signature) {
      const referencedSourceIds = new Set(
        documentSnapshot.pages.flatMap((page) => page.kind === 'external' ? [page.documentId] : []),
      )
      const project = await createLeafProject({
        primaryFile: loaded.sourceFile,
        insertedFiles: Array.from(insertedPdfs)
          .filter(([id]) => referencedSourceIds.has(id))
          .map(([id, entry]) => ({ id, file: entry.file })),
        document: documentSnapshot,
        comments: commentsSnapshot,
        ocr: ocrSnapshot,
      })
      base = { signature, project }
      projectSourceCache.current = base
    }
    return {
      ...structuredClone(base.project),
      updatedAt: Date.now(),
      document: structuredClone(documentSnapshot),
      comments: structuredClone(commentsSnapshot),
      ocr: structuredClone(ocrSnapshot),
    }
  }, [insertedPdfs, loaded.sourceFile])

  useEffect(() => {
    if (!projectReady || !projectDirty) return
    const documentSnapshot = state.present
    const commentsSnapshot = comments
    const ocrSnapshot = ocr
    const timer = window.setTimeout(() => {
      void buildProject(documentSnapshot, commentsSnapshot, ocrSnapshot)
        .then((project) => recoveryQueue.current.save(recoveryKey, project))
        .catch(() => setNotice('Complete local recovery is unavailable. Save a .leafpdf project to keep every source and edit.'))
    }, 800)
    return () => window.clearTimeout(timer)
  }, [buildProject, comments, ocr, projectDirty, projectReady, recoveryKey, state.present])

  useEffect(() => {
    let active = true
    void loadSignatures().then((signatures) => {
      if (active) setSavedSignatures(signatures)
    }).catch(() => undefined)
    void loadPersonalDetails().then((details) => {
      if (active) setSavedDetails(details)
    }).catch(() => undefined)
    if (!initialProject) {
      void loadProjectRecovery(recoveryKey).then((recovered) => {
        if (active && recovered) {
          setRecoveryProject(recovered)
          setRecoveryOpen(true)
        }
      })
    }
    return () => { active = false }
  }, [initialProject, recoveryKey])

  useEffect(() => {
    if (modalOpen) return
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target
      const isEditing = target instanceof Element && target.matches('input, textarea, select')
      const annotationControl = target instanceof Element
        && target.closest('.annotation, .move-handle, .group-move-handle')
      if (!isEditing && annotationControl && NUDGE_KEYS.has(event.key)) {
        if (nudgeTimerRef.current !== null) window.clearTimeout(nudgeTimerRef.current)
        nudgeTimerRef.current = window.setTimeout(() => {
          dispatch({ type: 'endHistoryGroup' })
          nudgeTimerRef.current = null
        }, 400)
      }
      if (!isEditing && event.key === 'Enter' && pendingMedia) {
        event.preventDefault()
        commitPendingMedia(selectedPage.id, { x: 0.5, y: 0.5 })
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        const historyAction = event.shiftKey ? 'redo' : 'undo'
        dispatch({ type: historyAction })
        setMultiSelectMode(false)
        setNotice(historyAction === 'undo' ? 'Undid last change.' : 'Redid last change.')
      } else if (!isEditing && (event.key === 'Delete' || event.key === 'Backspace') && state.selectedAnnotationIds.length > 0) {
        dispatch({ type: 'removeAnnotations', annotationIds: state.selectedAnnotationIds })
      } else if (!isEditing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && selectedAnnotation) {
        event.preventDefault()
        dispatch({ type: 'copyAnnotation', annotationId: selectedAnnotation.id })
      } else if (!isEditing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v' && state.clipboard) {
        event.preventDefault()
        dispatch({ type: 'pasteAnnotation', pageId: selectedPage.id, newId: annotationId() })
      } else if (!isEditing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && selectedAnnotation) {
        event.preventDefault()
        dispatch({ type: 'duplicateAnnotation', annotationId: selectedAnnotation.id, newId: annotationId() })
      } else if (!isEditing && event.key === ']' && selectedAnnotation) {
        dispatch({ type: 'bringForward', annotationId: selectedAnnotation.id })
      } else if (!isEditing && event.key === '[' && selectedAnnotation) {
        dispatch({ type: 'sendBackward', annotationId: selectedAnnotation.id })
      } else if (!isEditing && (event.key === '?' || (event.key === '/' && event.shiftKey))) {
        setActivePanel((current) => current === 'help' ? null : 'help')
      } else if (!isEditing && event.key === 'Escape') {
        if (pendingMedia) {
          setNotice(`${pendingMedia.role === 'signature' ? 'Signature' : 'Image'} placement cancelled.`)
          setPendingMedia(null)
        }
        if (pendingDetail) {
          setNotice(`${pendingDetail.label} placement cancelled.`)
          setPendingDetail(null)
        }
        dispatch({ type: 'selectAnnotation', annotationId: null })
        changeTool('select')
        setMultiSelectMode(false)
        setActivePanel(null)
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => {
      window.removeEventListener('keydown', keyboard)
      if (nudgeTimerRef.current !== null) {
        window.clearTimeout(nudgeTimerRef.current)
        nudgeTimerRef.current = null
      }
    }
  }, [changeTool, commitPendingMedia, modalOpen, pendingDetail, pendingMedia, selectedAnnotation, selectedPage.id, state.clipboard, state.selectedAnnotationIds])

  useEffect(() => {
    if (!state.dirty && !projectDirty) return
    const confirmLeave = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', confirmLeave)
    return () => window.removeEventListener('beforeunload', confirmLeave)
  }, [projectDirty, state.dirty])

  const requestClose = () => {
    if (state.dirty || projectDirty) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }

  const placeImage = async (file: File) => {
    try {
      setFormGuideOpen(false)
      setPendingDetail(null)
      const { width, height } = await validatePlacedImage(file)
      const dataUrl = await readDataUrl(file)
      const placedWidth = 0.36
      setPendingMedia({
        width: placedWidth,
        aspectRatio: width / height,
        dataUrl,
        mimeType: file.type as PendingMediaPlacement['mimeType'],
      })
      changeTool('image')
      setNotice(null)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The image could not be read.')
    }
  }

  const replaceImage = async (annotation: ImageAnnotation, file: File) => {
    if (annotation.role === 'signature') return
    const surface = pageSurfaceSizesRef.current.get(annotation.pageId)
    if (!surface) {
      setNotice('This page is still loading. Wait for it to appear, then replace the image again.')
      return
    }
    try {
      const { width, height } = await validatePlacedImage(file)
      const dataUrl = await readDataUrl(file)
      dispatch({
        type: 'updateAnnotation',
        annotationId: annotation.id,
        patch: {
          ...replacementMediaBounds(annotation, width / height, surface),
          dataUrl,
          mimeType: file.type as ImageAnnotation['mimeType'],
        },
      })
      setNotice('Image replaced. Undo restores the previous image.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The image could not be replaced.')
    }
  }

  const placeSignature = (dataUrl: string, saveForReuse = false, suggestedName?: string) => {
    setFormGuideOpen(false)
    setPendingDetail(null)
    setPendingMedia({
      width: 0.32,
      aspectRatio: SIGNATURE_ASPECT_RATIO,
      dataUrl,
      mimeType: 'image/png',
      role: 'signature',
    })
    if (saveForReuse) {
      const signature: SavedSignature = {
        id: `signature-${crypto.randomUUID()}`,
        name: suggestedName?.trim() || `Signature ${savedSignatures.length + 1}`,
        dataUrl,
        createdAt: Date.now(),
      }
      void saveSignature(signature)
        .then(() => setSavedSignatures((current) => [signature, ...current]))
        .catch(() => setNotice('This browser could not save that signature for reuse; you can still place it now.'))
    }
    setSignatureOpen(false)
    changeTool('signature')
    setNotice(null)
  }

  const removeSavedSignature = (id: string) => {
    void deleteSignature(id)
      .then(() => setSavedSignatures((current) => current.filter((signature) => signature.id !== id)))
      .catch(() => setNotice('That saved signature could not be deleted.'))
  }

  const saveDetailsOnDevice = (details: PersonalDetails) => {
    setSavingDetails(true)
    void savePersonalDetails(details)
      .then(() => {
        setSavedDetails(structuredClone(details))
        setNotice('Personal details saved only in this browser.')
      })
      .catch(() => setNotice('This browser could not save those details; you can still place them now.'))
      .finally(() => setSavingDetails(false))
  }

  const clearDetailsFromDevice = () => {
    setSavingDetails(true)
    void deletePersonalDetails()
      .then(() => {
        setSavedDetails(null)
        setNotice('Saved personal details cleared from this browser.')
      })
      .catch(() => setNotice('Saved personal details could not be cleared.'))
      .finally(() => setSavingDetails(false))
  }

  const prepareDetailPlacement = (placement: PreparedDetailPlacement) => {
    setFormGuideOpen(false)
    setPendingMedia(null)
    setPendingDetail(placement)
    setActivePanel(null)
    changeTool('text')
    setNotice(null)
  }

  const finishPreparedDetailPlacement = () => {
    if (!pendingDetail) return
    const label = pendingDetail.label
    setPendingDetail(null)
    setNotice(`${label} added. Edit it on the page, then press Enter.`)
  }

  const addDocumentMarks = (request: DocumentMarkRequest) => {
    const pages = request.kind === 'watermark' && request.scope === 'current'
      ? [selectedPage]
      : state.present.pages
    const annotations = pages.map((page, pageIndex) => {
      if (request.kind === 'watermark') {
        return {
          id: annotationId(), pageId: page.id, kind: 'text' as const,
          x: 0.18, y: 0.45, width: 0.64, height: 0.1,
          text: request.text, color: '#5d6870', fontSize: 42,
          fontWeight: 700 as const, rotation: -32, opacity: request.opacity,
        }
      }
      const number = pageIndex + 1
      const text = request.format === 'number'
        ? `${number}`
        : request.format === 'page-number'
          ? `Page ${number}`
          : `Page ${number} of ${state.present.pages.length}`
      const x = request.position === 'bottom-left' ? 0.05 : request.position === 'bottom-right' ? 0.75 : 0.4
      return {
        id: annotationId(), pageId: page.id, kind: 'text' as const,
        x, y: 0.94, width: 0.2, height: 0.035,
        text, color: '#4f5756', fontSize: 10,
      }
    })
    dispatch({ type: 'addAnnotations', annotations })
    setMarksOpen(false)
    setNotice(request.kind === 'watermark'
      ? `Watermark added to ${pages.length} page${pages.length === 1 ? '' : 's'}.`
      : `Page numbers added to ${pages.length} pages.`)
  }

  const insertBlankPage = async () => {
    try {
      let width = 595.28
      let height = 841.89
      if (selectedPage.kind === 'blank') {
        width = selectedPage.width
        height = selectedPage.height
      } else {
        const proxy = selectedPage.kind === 'original'
          ? loaded.document
          : insertedPdfs.get(selectedPage.documentId)?.pdf
        if (proxy) {
          const sourcePage = await proxy.getPage(selectedPage.sourceIndex + 1)
          const viewport = sourcePage.getViewport({ scale: 1 })
          width = viewport.width
          height = viewport.height
        }
      }
      const page: EditorPage = {
        id: `page-${crypto.randomUUID()}`,
        kind: 'blank',
        rotation: 0,
        width,
        height,
      }
      dispatch({ type: 'insertPages', afterPageId: selectedPage.id, pages: [page] })
      setScrollTargetPageId(page.id)
      setNotice('Blank page inserted.')
    } catch {
      setNotice('A blank page could not be inserted.')
    }
  }

  const insertPdf = async (file: File) => {
    try {
      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        setNotice('Choose a PDF file to insert.')
        return
      }
      if (file.size > MAX_PDF_BYTES) {
        setNotice(`LeafPDF has been tested with PDF files up to ${formatFileSize(MAX_PDF_BYTES)}.`)
        return
      }
      const { getDocument } = await import('pdfjs-dist')
      const pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
      const documentId = `inserted-${crypto.randomUUID()}`
      const pages: ExternalPage[] = Array.from({ length: pdf.numPages }, (_, index) => ({
        id: `page-${crypto.randomUUID()}`,
        kind: 'external',
        documentId,
        sourceIndex: index,
        rotation: 0,
      }))
      projectSourceCache.current = null
      setInsertedPdfs((current) => new Map(current).set(documentId, { file, pdf }))
      dispatch({ type: 'insertPages', afterPageId: selectedPage.id, pages })
      setScrollTargetPageId(pages[0].id)
      setNotice(`Inserted ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} from ${file.name}. The source is included in project recovery and .leafpdf saves.`)
    } catch {
      setNotice('That PDF could not be inserted.')
    }
  }

  const runSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (replacementBatch) return
    setReplaceOpen(false)
    try {
      const results = await searchDocument(loaded.document, externalDocuments, state.present.pages, searchQuery)
      const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
      const merged = new Map(results.map((result) => [result.pageId, result]))
      if (normalizedQuery) {
        for (const result of ocr) {
          const matches = result.words.filter((word) => word.text.toLocaleLowerCase().includes(normalizedQuery)).length
          if (matches === 0) continue
          const pageNumber = pageNumberById.get(result.pageId)
          if (!pageNumber) continue
          const existing = merged.get(result.pageId)
          merged.set(result.pageId, {
            pageId: result.pageId,
            pageNumber,
            matches: (existing?.matches ?? 0) + matches,
            occurrences: existing?.occurrences ?? [],
          })
        }
      }
      const allResults = Array.from(merged.values()).sort((left, right) => left.pageNumber - right.pageNumber)
      setSearchResults(allResults)
      setSearchCursor(0)
      const firstEntry = searchCursorEntries(allResults)[0]
      if (firstEntry) navigateToPage(firstEntry.pageId)
    } catch {
      setNotice('The document text could not be searched.')
    }
  }

  const liveResults = (searchResults ?? []).filter((result) =>
    state.present.pages.some((page) => page.id === result.pageId))
  const liveSearchEntries = searchCursorEntries(liveResults)
  const activeSearchIndex = liveSearchEntries.length === 0
    ? -1
    : Math.min(searchCursor, liveSearchEntries.length - 1)
  const activeSearchEntry: SearchCursorEntry | null = activeSearchIndex === -1
    ? null
    : liveSearchEntries[activeSearchIndex]
  const stepSearch = (direction: 1 | -1) => {
    if (liveSearchEntries.length === 0) return
    const next = ((activeSearchIndex + direction) % liveSearchEntries.length + liveSearchEntries.length)
      % liveSearchEntries.length
    setSearchCursor(next)
    navigateToPage(liveSearchEntries[next].pageId)
  }
  const totalMatches = liveSearchEntries.length
  const searchStatus = liveSearchEntries.length === 0
    ? 'No matches'
    : `${totalMatches} match${totalMatches === 1 ? '' : 'es'} · page ${activeSearchEntry?.pageNumber} · ${activeSearchIndex + 1} of ${totalMatches}`
  const compactSearchStatus = liveSearchEntries.length === 0
    ? searchStatus
    : `${activeSearchIndex + 1}/${totalMatches} · page ${activeSearchEntry?.pageNumber}`
  const sourceSearchMatches = sourceSearchEntries(liveSearchEntries)
  const replacementRequest = replacementBatch
    ? currentSearchReplacementRequest(replacementBatch)
    : null
  const replacementBusy = replacementBatch !== null

  const showSearchReplacementRequest = useCallback((request: SearchReplacementRequest) => {
    const cursor = liveSearchEntries.findIndex((entry) => entry.pageId === request.pageId
      && entry.occurrence?.start === request.occurrence.start
      && entry.occurrence.end === request.occurrence.end)
    if (cursor >= 0) setSearchCursor(cursor)
    dispatch({ type: 'viewPage', pageId: request.pageId })
    setScrollTargetPageId(request.pageId)
  }, [liveSearchEntries])

  const startSearchReplacement = (entries: SearchCursorEntry[], value: string) => {
    const batch = createSearchReplacementBatch(
      entries,
      value,
      `search-replace-${crypto.randomUUID()}`,
    )
    if (!batch) return
    setPendingMedia(null)
    setPendingDetail(null)
    changeTool('select')
    setReplacementText(batch.replacementText)
    setReplacementBatch(batch)
    showSearchReplacementRequest(currentSearchReplacementRequest(batch))
  }

  const stopSearchReplacement = useCallback((message?: string) => {
    if (!replacementBatch) return
    const completed = replacementBatch.index
    const total = replacementBatch.entries.length
    dispatch({ type: 'endHistoryGroup' })
    setReplacementBatch(null)
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
    setNotice(message ?? (
      completed > 0
        ? `Replacement stopped after ${completed} of ${total}. One Undo removes the completed visual corrections.`
        : 'Replacement stopped before any visual corrections were added.'
    ))
  }, [replacementBatch])

  const handleSearchReplacementUnavailable = useCallback((requestId: string) => {
    if (!replacementBatch || replacementRequest?.id !== requestId) return
    const completed = replacementBatch.index
    stopSearchReplacement(
      `Find & Replace stopped at match ${replacementRequest.index}; its source geometry was unavailable. ${completed} visual correction${completed === 1 ? '' : 's'} completed.`,
    )
  }, [replacementBatch, replacementRequest, stopSearchReplacement])

  const handleSearchReplacementHandled = useCallback((requestId: string) => {
    if (!replacementBatch || replacementRequest?.id !== requestId) return
    const next = advanceSearchReplacementBatch(replacementBatch)
    if (next) {
      setReplacementBatch(next)
      showSearchReplacementRequest(currentSearchReplacementRequest(next))
      return
    }
    dispatch({ type: 'endHistoryGroup' })
    setReplacementBatch(null)
    setReplaceOpen(false)
    const count = replacementBatch.entries.length
    setNotice(`Replaced ${count} source match${count === 1 ? '' : 'es'} visually. Original PDF text remains underneath; use Redact for permanent removal.`)
  }, [replacementBatch, replacementRequest, showSearchReplacementRequest])

  useEffect(() => {
    if (!replacementRequest) return
    const requestId = replacementRequest.id
    const timeout = window.setTimeout(() => {
      handleSearchReplacementUnavailable(requestId)
    }, 10_000)
    return () => window.clearTimeout(timeout)
  }, [handleSearchReplacementUnavailable, replacementRequest])

  const buildEditedBytes = async (
    documentSnapshot: EditorDocument,
    allowCompatibilityCopy: boolean,
    formOutput: PdfFormOutput,
    includeComments: boolean,
    commentsSnapshot: ReviewComment[],
  ): Promise<Uint8Array> => {
    const [{ exportInWorker }, { rasterizeRedactedPages }] = await Promise.all([
      import('../pdf/exportClient'),
      import('../pdf/redactionRaster'),
    ])
    const referencedIds = new Set(
      documentSnapshot.pages.flatMap((page) => page.kind === 'external' ? [page.documentId] : []),
    )
    const insertedFiles = Array.from(insertedPdfs)
      .filter(([id]) => referencedIds.has(id))
      .map(([id, entry]) => ({ id, file: entry.file }))
    const rasterizedPages = await rasterizeRedactedPages(loaded.document, externalDocuments, documentSnapshot)
    let bytes = await exportInWorker(
      loaded.sourceFile,
      documentSnapshot,
      (progress) => setExportProgress(progress),
      { allowCompatibilityCopy, formOutput, insertedFiles, rasterizedPages },
    )
    if (includeComments && commentsSnapshot.length > 0) {
      bytes = await addStandardTextComments(
        bytes,
        commentsSnapshot,
        new Map(documentSnapshot.pages.map((page, index) => [page.id, index])),
      )
    }
    return bytes
  }

  const exportFile = async (formOutput: PdfFormOutput, allowCompatibilityCopy = false) => {
    setPendingFormOutput(formOutput)
    setExporting(true)
    setExportProgress(null)
    setNotice(null)
    const documentSnapshot = state.present
    const commentsSnapshot = comments
    try {
      let bytes: Uint8Array
      try {
        bytes = await buildEditedBytes(
          documentSnapshot,
          allowCompatibilityCopy,
          formOutput,
          true,
          commentsSnapshot,
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'CompatibilityConfirmationRequired') {
          const { features } = error as Error & { features?: SourcePdfFeatures }
          setCompatibilityFeatures(features ?? loaded.features)
          return
        }
        throw error
      }
      const { exportedFileName } = await import('../pdf/exportNaming')
      const fileName = exportedFileName(loaded.fileName, formOutput)
      const result = await saveLocalBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), fileName, PDF_SAVE_TYPE)
      if (result === 'cancelled') {
        setNotice('PDF export cancelled.')
        return
      }
      setSavedPdfReceipt({ document: documentSnapshot, comments: commentsSnapshot })
      setCompatibilityFeatures(null)
      dispatch({ type: 'markSaved', document: documentSnapshot })
      const projectOnlyStateSaved = latestComments.current === commentsSnapshot
        && latestOcr.current.length === 0
      if (latestDocument.current === documentSnapshot && projectOnlyStateSaved) {
        setProjectSavedDocument(documentSnapshot)
        setProjectOnlyDirty(false)
        await recoveryQueue.current.clear(recoveryKey)
      }
      const pdfSnapshotCurrent = latestDocument.current === documentSnapshot
        && latestComments.current === commentsSnapshot
      const outputLabel = formOutput === 'flattened' ? 'flattened PDF' : 'fillable PDF'
      const outputDetail = formOutput === 'flattened'
        ? ' Form controls were removed; this is not encryption.'
        : commentsSnapshot.length ? ' It includes standard PDF comments.' : ''
      setNotice(
        pdfSnapshotCurrent
          ? `Saved ${outputLabel} as ${fileName}.${outputDetail}`
          : `Saved ${outputLabel} as ${fileName}. Edits made while it was building are not in that file.`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed.')
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  const requestPdfSave = (formOutput: PdfFormOutput) => {
    setPendingFormOutput(formOutput)
    const invalidLink = state.present.annotations.find((annotation) =>
      annotation.kind === 'link' && externalLinkDestination(annotation) === null)
    if (invalidLink?.kind === 'link') {
      changeTool('select')
      navigateToPage(invalidLink.pageId)
      dispatch({ type: 'selectAnnotation', annotationId: invalidLink.id })
      setNotice('Add a valid link destination before saving the PDF.')
      return
    }
    const unfinished = state.present.annotations.filter(isUnfinishedTextAnnotation)
    if (unfinished.length === 0) {
      void exportFile(formOutput)
      return
    }
    dispatch({ type: 'selectAnnotation', annotationId: null })
    setUnfinishedText(unfinished)
  }

  const reviewUnfinishedText = () => {
    const first = unfinishedText[0]
    if (!first) return
    setUnfinishedText([])
    changeTool('select')
    navigateToPage(first.pageId)
    dispatch({ type: 'selectAnnotation', annotationId: first.id })
  }

  const saveWithUnfinishedText = () => {
    setUnfinishedText([])
    void exportFile(pendingFormOutput)
  }

  const saveProject = async () => {
    setSavingProject(true)
    setNotice(null)
    const documentSnapshot = state.present
    const commentsSnapshot = comments
    const ocrSnapshot = ocr
    try {
      const project = await buildProject(documentSnapshot, commentsSnapshot, ocrSnapshot)
      const fileName = projectFileName(loaded.fileName)
      const result = await saveLocalBlob(serializeLeafProject(project), fileName, PROJECT_SAVE_TYPE)
      if (result === 'cancelled') {
        setNotice('Project save cancelled.')
        return
      }
      projectSourceCache.current = {
        signature: sourceSignature(loaded.sourceFile, insertedPdfs),
        project: structuredClone(project),
      }
      if (latestDocument.current === documentSnapshot) {
        setProjectSavedDocument(documentSnapshot)
        dispatch({ type: 'markSaved', document: documentSnapshot })
      }
      if (latestComments.current === commentsSnapshot && latestOcr.current === ocrSnapshot) setProjectOnlyDirty(false)
      if (
        latestDocument.current === documentSnapshot
        && latestComments.current === commentsSnapshot
        && latestOcr.current === ocrSnapshot
      ) {
        await recoveryQueue.current.clear(recoveryKey)
      }
      void requestPersistentStorage()
      setNotice(`Saved editable project ${fileName}.`)
    } catch (error) {
      setNotice(error instanceof Error ? `Project save failed: ${error.message}` : 'Project save failed.')
    } finally {
      setSavingProject(false)
    }
  }

  const exportSanitized = async () => {
    setSanitizing(true)
    setNotice(null)
    try {
      const edited = await buildEditedBytes(state.present, true, 'fillable', false, comments)
      const sanitized = await sanitizeInWorker(edited)
      const fileName = sanitizedFileName(loaded.fileName)
      const result = await saveLocalBlob(
        new Blob([new Uint8Array(sanitized)], { type: 'application/pdf' }),
        fileName,
        PDF_SAVE_TYPE,
      )
      setNotice(result === 'cancelled' ? 'Sanitized export cancelled.' : `Exported ${fileName}.`)
    } catch (error) {
      setNotice(error instanceof Error ? `Sanitized export failed: ${error.message}` : 'Sanitized export failed.')
    } finally {
      setSanitizing(false)
    }
  }

  const createComment = (body: string, author: string) => {
    const now = Date.now()
    setComments((current) => [...current, {
      id: `comment-${crypto.randomUUID()}`,
      pageId: selectedPage.id,
      x: 0.92,
      y: 0.08,
      body,
      author,
      createdAt: now,
      updatedAt: now,
      resolved: false,
    }])
    setProjectOnlyDirty(true)
  }

  const importComments = async () => {
    try {
      const pageIds: string[] = []
      for (const page of state.present.pages) {
        if (page.kind === 'original') pageIds[page.sourceIndex] = page.id
      }
      const imported = await importStandardTextComments(loaded.document, pageIds)
      setComments((current) => {
        const existing = new Set(current.map((comment) => comment.id))
        return [...current, ...imported.filter((comment) => !existing.has(comment.id))]
      })
      if (imported.length > 0) setProjectOnlyDirty(true)
      setNotice(`Imported ${imported.length} standard PDF comment${imported.length === 1 ? '' : 's'}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'PDF comments could not be imported.')
    }
  }

  const runOcr = async () => {
    setOcrRunning(true)
    try {
      const result = await runNativeOcr(loaded.document, externalDocuments, selectedPage)
      setOcr((current) => [...current.filter((entry) => entry.pageId !== result.pageId), result])
      setProjectOnlyDirty(true)
      setNotice(`Recognized ${result.words.length} text region${result.words.length === 1 ? '' : 's'} on page ${pageNumberById.get(selectedPage.id)}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Local OCR failed.')
    } finally {
      setOcrRunning(false)
    }
  }

  const compareWith = async (file: File) => {
    setComparing(true)
    setNotice(null)
    let comparisonPdf: PDFDocumentProxy | null = null
    let currentPdf: PDFDocumentProxy | null = null
    try {
      const { getDocument } = await import('pdfjs-dist')
      comparisonPdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
      if (!loaded.features.isEncrypted) {
        const currentBytes = await buildEditedBytes(state.present, true, 'fillable', false, comments)
        currentPdf = await getDocument({ data: new Uint8Array(currentBytes) }).promise
      }
      setComparison(await comparePdfText(currentPdf ?? loaded.document, comparisonPdf))
      setComparisonName(file.name)
    } catch (error) {
      setNotice(error instanceof Error ? `Comparison failed: ${error.message}` : 'Comparison failed.')
    } finally {
      setComparing(false)
      if (comparisonPdf) void comparisonPdf.loadingTask.destroy().catch(() => undefined)
      if (currentPdf) void currentPdf.loadingTask.destroy().catch(() => undefined)
    }
  }

  const restoreRecovery = async () => {
    if (!recoveryProject) return
    try {
      const opened = await hydrateLeafProject(recoveryProject)
      const restoredInserted = await loadInsertedPdfMap(opened.insertedFiles)
      for (const entry of insertedPdfsRef.current.values()) void entry.pdf.loadingTask.destroy().catch(() => undefined)
      setInsertedPdfs(restoredInserted)
      projectSourceCache.current = {
        signature: sourceSignature(loaded.sourceFile, restoredInserted),
        project: structuredClone(opened.project),
      }
      dispatch({ type: 'restoreDocument', document: structuredClone(opened.project.document) })
      setComments(structuredClone(opened.project.comments))
      setOcr(structuredClone(opened.project.ocr))
      setProjectOnlyDirty(true)
      setRecoveryProject(null)
      setRecoveryOpen(false)
      setNotice('Complete local project restored, including inserted PDFs, comments, and OCR.')
    } catch (error) {
      setNotice(error instanceof Error ? `Recovery failed: ${error.message}` : 'Recovery failed.')
    }
  }

  if (!projectReady) {
    return <div className="editor-loading" role="status">Opening editable LeafPDF project…</div>
  }

  return (
    <main className="workbench-shell next-level-workbench">
      <SkipNavigation hasItemProperties={selectedAnnotations.length > 0} />
      <header className="topbar">
        <button type="button" className="brand-button" disabled={closing} onClick={requestClose} aria-label="Close document and return home">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span>LeafPDF</span>
        </button>
        <div className="document-identity">
          <h1 title={loaded.fileName}>{loaded.fileName}</h1>
          <span className={`pdf-save-status is-${pdfSaveStatus.tone}`}>
            <i className="status-dot" /> {state.present.pages.length} page{state.present.pages.length === 1 ? '' : 's'}
            {' · '}{formatFileSize(loaded.sourceFile.size)} · {pdfSaveStatus.label}
          </span>
        </div>
        <div className="history-controls" aria-label="Edit history">
          <button type="button" disabled={state.past.length === 0} onClick={() => {
            dispatch({ type: 'undo' })
            setNotice('Undid last change.')
          }} aria-label="Undo">↶</button>
          <button type="button" disabled={state.future.length === 0} onClick={() => {
            dispatch({ type: 'redo' })
            setNotice('Redid last change.')
          }} aria-label="Redo">↷</button>
        </div>
        <div className="next-actions" aria-label="Project and review tools">
          <ProjectToolsMenu
            commentsCount={comments.length}
            savingProject={savingProject}
            onSaveProject={() => void saveProject()}
            onReview={() => setActivePanel(activePanel === 'review' ? null : 'review')}
            onPrivacy={() => setActivePanel(activePanel === 'privacy' ? null : 'privacy')}
            onOcr={() => setActivePanel(activePanel === 'ocr' ? null : 'ocr')}
            onCompare={() => setActivePanel(activePanel === 'compare' ? null : 'compare')}
            onMarks={() => setMarksOpen(true)}
            onHelp={() => setActivePanel(activePanel === 'help' ? null : 'help')}
          />
        </div>
        <PdfSaveMenu
          disabled={loaded.features.isEncrypted}
          disabledReason={loaded.features.isEncrypted ? 'Encrypted PDFs cannot be exported.' : undefined}
          exporting={exporting}
          primaryLabel={pdfCopyCurrent ? 'Save again' : 'Save PDF'}
          progressLabel={exportProgress
            ? `Saving PDF… ${exportProgress.completedPages}/${exportProgress.totalPages}`
            : 'Saving PDF…'}
          onSave={requestPdfSave}
        />
      </header>

      {loaded.features.isEncrypted && (
        <p className="signature-warning" role="status">
          This PDF is encrypted — even a permissions-only lock with no password counts. LeafPDF can
          display it, but cannot decrypt it to write an edited copy, so exporting is disabled.
        </p>
      )}
      {loaded.features.hasDigitalSignatures && (
        <p className="signature-warning" role="status">
          Editing this PDF invalidates its existing digital signature. LeafPDF cannot re-sign a PDF,
          and a drawn signature is a picture, not a digital signature.
        </p>
      )}

      <div className={`workbench-grid ${selectedAnnotations.length > 0 ? 'has-item-properties' : 'is-paper-focused'}`}>
        {pagesOpen && (
          <>
            <div className="page-organizer-backdrop" aria-hidden="true" onPointerDown={() => setPagesOpen(false)} />
            <PageRail
              pdf={loaded.document}
              pages={state.present.pages}
              selectedPageId={state.selectedPageId}
              externalDocuments={externalDocuments}
              onInsertBlankPage={() => void insertBlankPage()}
              onInsertPdf={(file) => void insertPdf(file)}
              onSelectPage={(pageId) => {
                navigateToPage(pageId)
                setPagesOpen(false)
              }}
              onClose={() => setPagesOpen(false)}
              dispatch={dispatch}
            />
          </>
        )}
        <ToolRail
          activeTool={state.activeTool}
          detailsOpen={activePanel === 'details'}
          onTool={(tool) => {
            setFormGuideOpen(false)
            setPendingMedia(null)
            setPendingDetail(null)
            setActivePanel(null)
            changeTool(tool)
          }}
          onImage={(file) => {
            void placeImage(file)
          }}
          onSignature={() => {
            setFormGuideOpen(false)
            setPendingMedia(null)
            setPendingDetail(null)
            setActivePanel(null)
            changeTool('select')
            setSignatureOpen(true)
          }}
          onDetails={() => {
            const nextOpen = activePanel !== 'details'
            setFormGuideOpen(false)
            setPendingMedia(null)
            setPendingDetail(null)
            changeTool('select')
            setActivePanel(nextOpen ? 'details' : null)
          }}
        />
        <section id="pdf-document" className="document-stage" tabIndex={-1} aria-labelledby="pdf-document-title">
          <h2 id="pdf-document-title" className="visually-hidden">PDF document</h2>
          <div className="stage-ruler" aria-hidden="true">
            {Array.from({ length: 19 }, (_, index) => <i key={index} className={index % 5 === 0 ? 'major' : ''} />)}
          </div>
          <div className="stage-toolbar">
            <button
              type="button"
              className="page-organizer-trigger"
              aria-label={`Open page organizer, page ${pageNumberById.get(selectedPage.id)} of ${state.present.pages.length}`}
              aria-haspopup="dialog"
              aria-expanded={pagesOpen}
              aria-controls="document-pages"
              onClick={() => {
                setReplaceOpen(false)
                setFormGuideOpen(false)
                setActivePanel(null)
                setPagesOpen(true)
              }}
            >
              <span aria-hidden="true">▤</span>
              Pages {pageNumberById.get(selectedPage.id)} / {state.present.pages.length}
            </button>
            <div className="search-cluster">
              <form className="search-control" role="search" aria-label="Find text in document" onSubmit={(event) => void runSearch(event)}>
                <input
                  ref={searchInputRef}
                  type="search"
                  placeholder="Find in PDF or OCR"
                  aria-label="Find text in document"
                  value={searchQuery}
                  disabled={replacementBusy}
                  onChange={(event) => {
                    setSearchQuery(event.target.value)
                    setSearchResults(null)
                    setReplaceOpen(false)
                    setReplacementText('')
                  }}
                />
                <button type="submit" aria-label="Search" disabled={replacementBusy}>Find</button>
                {liveSearchEntries.length > 0 && (
                  <button
                    type="button"
                    className="search-replace-trigger"
                    aria-expanded={replaceOpen}
                    aria-controls="search-replace-popover"
                    disabled={replacementBusy}
                    onClick={() => setReplaceOpen((open) => !open)}
                  >
                    Replace
                  </button>
                )}
                {searchResults !== null && (
                  <span className="search-status" role="status" aria-label={searchStatus}>
                    {liveSearchEntries.length === 0
                      ? searchStatus
                      : (
                        <>
                          <span className="search-status-full">{searchStatus}</span>
                          <span className="search-status-compact" aria-hidden="true">{compactSearchStatus}</span>
                        </>
                      )}
                  </span>
                )}
                {liveSearchEntries.length > 1 && (
                  <>
                    <button type="button" className="search-nav-button" aria-label="Previous match" disabled={replacementBusy} onClick={() => stepSearch(-1)}>‹</button>
                    <button type="button" className="search-nav-button" aria-label="Next match" disabled={replacementBusy} onClick={() => stepSearch(1)}>›</button>
                  </>
                )}
              </form>
              {replaceOpen && liveSearchEntries.length > 0 && (
                <SearchReplacePopover
                  query={searchQuery.trim()}
                  replacementText={replacementText}
                  onReplacementTextChange={setReplacementText}
                  sourceMatches={sourceSearchMatches.length}
                  totalMatches={liveSearchEntries.length}
                  currentIsSource={activeSearchEntry?.occurrence != null}
                  busy={replacementBusy}
                  progress={replacementRequest
                    ? { index: replacementRequest.index, total: replacementRequest.total }
                    : null}
                  onReplaceThis={(value) => {
                    if (activeSearchEntry?.occurrence) startSearchReplacement([activeSearchEntry], value)
                  }}
                  onReplaceAll={(value) => startSearchReplacement(liveSearchEntries, value)}
                  onStop={() => stopSearchReplacement()}
                  onClose={() => setReplaceOpen(false)}
                />
              )}
            </div>
            {loaded.features.hasAcroForm && (
              <button
                type="button"
                className="form-guide-trigger"
                aria-expanded={formGuideOpen}
                aria-controls="form-field-guide"
                onClick={() => {
                  const nextOpen = !formGuideOpen
                  setFormGuideOpen(nextOpen)
                  if (nextOpen) {
                    setPendingMedia(null)
                    setPendingDetail(null)
                    changeTool('select')
                  }
                }}
              >
                <span aria-hidden="true">▣</span>
                Fields
              </button>
            )}
            <ZoomControl
              zoom={state.zoom}
              mode={zoomMode}
              onZoom={setManualZoom}
              onFitWidth={fitPageWidth}
            />
          </div>
          <ToolPlacementHint tool={state.activeTool} preparedDetail={pendingDetail} />
          <FormFieldGuide
            open={loaded.features.hasAcroForm && formGuideOpen}
            busy={formNavigationBusy}
            target={formFieldTarget}
            pageNumber={formFieldTarget
              ? pageNumberById.get(formFieldTarget.pageId) ?? null
              : null}
            onStart={() => void startFormNavigation()}
            onPrevious={() => void moveFormNavigation('previous')}
            onNext={() => void moveFormNavigation('next')}
            onClose={() => setFormGuideOpen(false)}
          />
          <PageStrip
            pdf={loaded.document}
            pages={state.present.pages}
            externalDocuments={externalDocuments}
            annotations={state.present.annotations}
            activeTool={state.activeTool}
            selectedPageId={state.selectedPageId}
            selectedAnnotationIds={state.selectedAnnotationIds}
            multiSelectMode={multiSelectMode}
            onMultiSelectComplete={() => setMultiSelectMode(false)}
            zoom={state.zoom}
            fitWidth={zoomMode === 'fit-width'}
            fitWidthRequest={fitWidthRequest}
            onFitZoom={applyFitZoom}
            formValues={state.present.formValues}
            loadFormWidgets={loadFormWidgets}
            formFieldFocusRequest={formFieldFocusRequest}
            onFormFieldFocus={handleFormFieldFocus}
            onFormFocusRequestHandled={handleFormFocusRequestHandled}
            searchResults={liveResults}
            activeSearchEntry={activeSearchEntry}
            searchReplacementRequest={replacementRequest}
            onSearchReplacementHandled={handleSearchReplacementHandled}
            onSearchReplacementUnavailable={handleSearchReplacementUnavailable}
            pendingMedia={pendingMedia}
            onPlaceMedia={commitPendingMedia}
            preparedDetail={pendingDetail}
            onPlacePreparedDetail={finishPreparedDetailPlacement}
            announce={setNotice}
            onPageMeasured={(pageId, size) => pageSurfaceSizesRef.current.set(pageId, size)}
            scrollTargetPageId={scrollTargetPageId}
            onScrolledToTarget={() => setScrollTargetPageId(null)}
            dispatch={dispatch}
          />
        </section>
        {selectedAnnotations.length > 1 ? (
          <MultiSelectionInspector
            key={selectedAnnotations.map(({ id }) => id).join('\u0000')}
            annotations={selectedAnnotations}
            dispatch={dispatch}
            onAddMore={() => setMultiSelectMode(true)}
            onDone={() => {
              setMultiSelectMode(false)
              dispatch({ type: 'selectAnnotation', annotationId: null })
            }}
            announce={setNotice}
          />
        ) : (
          <Inspector
            key={selectedAnnotation?.id ?? 'empty'}
            annotation={selectedAnnotation}
            annotations={state.present.annotations}
            canPaste={state.clipboard !== null}
            multiSelectMode={multiSelectMode}
            onSelectMore={selectedAnnotation ? () => setMultiSelectMode(true) : undefined}
            dispatch={dispatch}
            announce={setNotice}
            onReplaceImage={replaceImage}
          />
        )}
      </div>

      <ReviewPanel
        open={activePanel === 'review'}
        comments={comments}
        currentPageId={selectedPage.id}
        pageNumberById={pageNumberById}
        onClose={() => setActivePanel(null)}
        onCreate={createComment}
        onSelect={(comment) => navigateToPage(comment.pageId)}
        onToggleResolved={(id) => {
          setComments((current) => current.map((comment) => comment.id === id
            ? { ...comment, resolved: !comment.resolved, updatedAt: Date.now() }
            : comment))
          setProjectOnlyDirty(true)
        }}
        onDelete={(id) => {
          setComments((current) => current.filter((comment) => comment.id !== id))
          setProjectOnlyDirty(true)
        }}
        onImport={() => void importComments()}
      />
      <PrivacyPanel
        open={activePanel === 'privacy'}
        report={privacyReport}
        sanitizing={sanitizing}
        onClose={() => setActivePanel(null)}
        onExportSanitized={() => void exportSanitized()}
      />
      <OcrPanel
        open={activePanel === 'ocr'}
        pageNumber={pageNumberById.get(selectedPage.id) ?? 1}
        available={nativeOcrAvailable()}
        running={ocrRunning}
        result={selectedOcr}
        onClose={() => setActivePanel(null)}
        onRun={() => void runOcr()}
        onChangeWord={(index, text) => {
          setOcr((current) => current.map((result) => result.pageId === selectedPage.id
            ? { ...result, words: result.words.map((word, wordIndex) => wordIndex === index ? { ...word, text } : word) }
            : result))
          setProjectOnlyDirty(true)
        }}
        onClear={() => {
          setOcr((current) => current.filter((result) => result.pageId !== selectedPage.id))
          setProjectOnlyDirty(true)
        }}
      />
      <ComparisonPanel
        open={activePanel === 'compare'}
        comparing={comparing}
        comparisonName={comparisonName}
        result={comparison}
        onClose={() => setActivePanel(null)}
        onCompare={(file) => void compareWith(file)}
        onNavigate={(pageNumber) => {
          const page = state.present.pages[pageNumber - 1]
          if (page) navigateToPage(page.id)
        }}
      />
      <HelpPanel open={activePanel === 'help'} onClose={() => setActivePanel(null)} />
      <DetailsPanel
        open={activePanel === 'details'}
        saved={savedDetails}
        saving={savingDetails}
        onClose={() => setActivePanel(null)}
        onSave={saveDetailsOnDevice}
        onClear={clearDetailsFromDevice}
        onPlace={prepareDetailPlacement}
      />

      <div className="toast-region" role="status" aria-live="polite">
        {visibleNotice && (
          <div className="toast">
            <span>{visibleNotice}</span>
            <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
      </div>
      <SignatureDialog
        open={signatureOpen}
        onClose={() => setSignatureOpen(false)}
        onApply={placeSignature}
        savedSignatures={savedSignatures}
        onDeleteSavedSignature={removeSavedSignature}
      />
      <DocumentMarksDialog open={marksOpen} onClose={() => setMarksOpen(false)} onApply={addDocumentMarks} />
      <RecoveryDialog
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        onRestore={() => void restoreRecovery()}
        onDiscard={() => {
          void recoveryQueue.current.clear(recoveryKey).then(() => {
            setRecoveryProject(null)
            setRecoveryOpen(false)
          }).catch(() => setNotice('The local recovery project could not be deleted.'))
        }}
      />
      <DiscardChangesDialog
        open={discardOpen}
        onContinue={() => setDiscardOpen(false)}
        onDiscard={() => {
          void recoveryQueue.current.clear(recoveryKey).then(() => {
            setDiscardOpen(false)
            onClose()
          }).catch(() => setNotice('The local recovery project could not be deleted. Save the project before closing.'))
        }}
      />
      <UnfinishedTextDialog
        count={unfinishedText.length}
        onCancel={() => setUnfinishedText([])}
        onReview={reviewUnfinishedText}
        onSaveAnyway={saveWithUnfinishedText}
      />
      <ExportCompatibilityDialog
        features={compatibilityFeatures}
        onCancel={() => setCompatibilityFeatures(null)}
        onAccept={() => {
          setCompatibilityFeatures(null)
          void exportFile(pendingFormOutput, true)
        }}
      />
    </main>
  )
}
