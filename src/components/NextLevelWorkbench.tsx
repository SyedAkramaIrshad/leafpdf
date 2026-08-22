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
  type EditorDocument,
  type EditorPage,
  type ExternalPage,
  type ImageAnnotation,
} from '../model/editor'
import { validatePlacedImage } from '../model/imageValidation'
import { nativeOcrAvailable, runNativeOcr } from '../ocr/nativeOcr'
import { addStandardTextComments, importStandardTextComments } from '../pdf/standardAnnotationInterop'
import { sanitizeInWorker } from '../pdf/sanitizeClient'
import { formatFileSize, MAX_PDF_BYTES } from '../pdf/loadPdf'
import { searchDocument, type PageMatches } from '../pdf/textSearch'
import type { ExportProgress } from '../pdf/exportWorkerProtocol'
import type { SourcePdfFeatures } from '../pdf/sourceFeatures'
import type { LoadedPdf } from '../pdf/types'
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
  deleteSignature,
  loadSignatures,
  saveSignature,
  type SavedSignature,
} from '../persistence/localStore'
import { RecoveryQueue } from '../persistence/recoveryQueue'
import { ComparisonPanel } from './ComparisonPanel'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { DocumentMarksDialog, type DocumentMarkRequest } from './DocumentMarksDialog'
import { ExportCompatibilityDialog } from './ExportCompatibilityDialog'
import { Inspector } from './Inspector'
import { OcrPanel } from './OcrPanel'
import { PageRail } from './PageRail'
import { PageStrip } from './PageStrip'
import { PrivacyPanel } from './PrivacyPanel'
import { RecoveryDialog } from './RecoveryDialog'
import { ReviewPanel } from './ReviewPanel'
import { SignatureDialog } from './SignatureDialog'
import { ToolRail } from './ToolRail'

interface NextLevelWorkbenchProps {
  loaded: LoadedPdf
  initialProject?: OpenedLeafProject | null
  closing?: boolean
  onClose: () => void
}

type InsertedPdfEntry = { file: File; pdf: PDFDocumentProxy }
type NextPanel = 'review' | 'privacy' | 'ocr' | 'compare' | null

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
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [savingProject, setSavingProject] = useState(false)
  const [sanitizing, setSanitizing] = useState(false)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [comparisonName, setComparisonName] = useState<string | null>(null)
  const [comparison, setComparison] = useState<PdfComparisonResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [compatibilityFeatures, setCompatibilityFeatures] = useState<SourcePdfFeatures | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [marksOpen, setMarksOpen] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryProject, setRecoveryProject] = useState<LeafProject | null>(null)
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PageMatches[] | null>(null)
  const [searchCursor, setSearchCursor] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const nudgeTimerRef = useRef<number | null>(null)
  const [scrollTargetPageId, setScrollTargetPageId] = useState<string | null>(null)

  const latestDocument = useRef(state.present)
  const latestComments = useRef(comments)
  const latestOcr = useRef(ocr)
  const insertedPdfsRef = useRef(insertedPdfs)
  const projectSourceCache = useRef<{ signature: string; project: LeafProject } | null>(
    initialProject ? { signature: '', project: structuredClone(initialProject.project) } : null,
  )
  const recoveryQueue = useRef(new RecoveryQueue<LeafProject>(saveProjectRecovery, deleteProjectRecovery))

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
  const selectedAnnotation = state.present.annotations.find((annotation) => annotation.id === state.selectedAnnotationId) ?? null
  const pageNumberById = useMemo(
    () => new Map(state.present.pages.map((page, index) => [page.id, index + 1])),
    [state.present.pages],
  )
  const projectDirty = state.present !== projectSavedDocument || projectOnlyDirty
  const modalOpen = signatureOpen || discardOpen || marksOpen || recoveryOpen || compatibilityFeatures !== null
  const recoveryKey = useMemo(
    () => projectRecoveryKey(loaded.sourceFile, loaded.documentFingerprint),
    [loaded.documentFingerprint, loaded.sourceFile],
  )
  const privacyReport = useMemo(
    () => buildPrivacyReport(loaded.features, state.present, comments, ocr),
    [loaded.features, state.present, comments, ocr],
  )
  const selectedOcr = ocr.find((result) => result.pageId === selectedPage.id) ?? null

  const navigateToPage = useCallback((pageId: string) => {
    dispatch({ type: 'selectPage', pageId })
    setScrollTargetPageId(pageId)
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
      const annotationControl = target instanceof Element && target.closest('.annotation, .move-handle')
      if (!isEditing && annotationControl && NUDGE_KEYS.has(event.key)) {
        if (nudgeTimerRef.current !== null) window.clearTimeout(nudgeTimerRef.current)
        nudgeTimerRef.current = window.setTimeout(() => {
          dispatch({ type: 'endHistoryGroup' })
          nudgeTimerRef.current = null
        }, 400)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      } else if (!isEditing && (event.key === 'Delete' || event.key === 'Backspace') && state.selectedAnnotationId) {
        dispatch({ type: 'removeAnnotation', annotationId: state.selectedAnnotationId })
      } else if (!isEditing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && state.selectedAnnotationId) {
        event.preventDefault()
        dispatch({ type: 'copyAnnotation', annotationId: state.selectedAnnotationId })
      } else if (!isEditing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v' && state.clipboard) {
        event.preventDefault()
        dispatch({ type: 'pasteAnnotation', pageId: selectedPage.id, newId: annotationId() })
      } else if (!isEditing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd' && state.selectedAnnotationId) {
        event.preventDefault()
        dispatch({ type: 'duplicateAnnotation', annotationId: state.selectedAnnotationId, newId: annotationId() })
      } else if (!isEditing && event.key === ']' && state.selectedAnnotationId) {
        dispatch({ type: 'bringForward', annotationId: state.selectedAnnotationId })
      } else if (!isEditing && event.key === '[' && state.selectedAnnotationId) {
        dispatch({ type: 'sendBackward', annotationId: state.selectedAnnotationId })
      } else if (!isEditing && event.key === 'Escape') {
        dispatch({ type: 'selectAnnotation', annotationId: null })
        dispatch({ type: 'setTool', tool: 'select' })
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
  }, [modalOpen, selectedPage.id, state.clipboard, state.selectedAnnotationId])

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
      const { width, height } = await validatePlacedImage(file)
      const dataUrl = await readDataUrl(file)
      const placedWidth = 0.42
      const aspect = height / width
      const annotation: ImageAnnotation = {
        id: annotationId(), pageId: selectedPage.id, kind: 'image', x: 0.2, y: 0.2,
        width: placedWidth,
        height: Math.min(0.8, Math.max(0.04, placedWidth * aspect)),
        dataUrl,
        mimeType: file.type as ImageAnnotation['mimeType'],
      }
      dispatch({ type: 'addAnnotation', annotation })
      setNotice('Image placed. Drag it to reposition.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The image could not be read.')
    }
  }

  const placeSignature = (dataUrl: string, saveForReuse = false) => {
    dispatch({
      type: 'addAnnotation',
      annotation: {
        id: annotationId(), pageId: selectedPage.id, kind: 'image', x: 0.25, y: 0.65,
        width: 0.38, height: 0.13, dataUrl, mimeType: 'image/png', role: 'signature',
      },
    })
    if (saveForReuse) {
      const signature: SavedSignature = {
        id: `signature-${crypto.randomUUID()}`,
        name: `Signature ${savedSignatures.length + 1}`,
        dataUrl,
        createdAt: Date.now(),
      }
      void saveSignature(signature)
        .then(() => setSavedSignatures((current) => [signature, ...current]))
        .catch(() => setNotice('The signature was placed, but this browser could not save it for reuse.'))
    }
    setSignatureOpen(false)
    setNotice('Signature placed. Drag it to reposition.')
  }

  const removeSavedSignature = (id: string) => {
    void deleteSignature(id)
      .then(() => setSavedSignatures((current) => current.filter((signature) => signature.id !== id)))
      .catch(() => setNotice('That saved signature could not be deleted.'))
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
          })
        }
      }
      const allResults = Array.from(merged.values()).sort((left, right) => left.pageNumber - right.pageNumber)
      setSearchResults(allResults)
      setSearchCursor(0)
      if (allResults.length > 0) navigateToPage(allResults[0].pageId)
    } catch {
      setNotice('The document text could not be searched.')
    }
  }

  const liveResults = (searchResults ?? []).filter((result) =>
    state.present.pages.some((page) => page.id === result.pageId))
  const stepSearch = (direction: 1 | -1) => {
    if (liveResults.length === 0) return
    const next = ((searchCursor + direction) % liveResults.length + liveResults.length) % liveResults.length
    setSearchCursor(next)
    navigateToPage(liveResults[next].pageId)
  }
  const totalMatches = liveResults.reduce((sum, result) => sum + result.matches, 0)

  const buildEditedBytes = async (
    documentSnapshot: EditorDocument,
    allowCompatibilityCopy: boolean,
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
      { allowCompatibilityCopy, insertedFiles, rasterizedPages },
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

  const exportFile = async (allowCompatibilityCopy = false) => {
    setExporting(true)
    setExportProgress(null)
    setNotice(null)
    const documentSnapshot = state.present
    const commentsSnapshot = comments
    try {
      let bytes: Uint8Array
      try {
        bytes = await buildEditedBytes(documentSnapshot, allowCompatibilityCopy, true, commentsSnapshot)
      } catch (error) {
        if (error instanceof Error && error.name === 'CompatibilityConfirmationRequired') {
          const { features } = error as Error & { features?: SourcePdfFeatures }
          setCompatibilityFeatures(features ?? loaded.features)
          return
        }
        throw error
      }
      const { exportedFileName } = await import('../pdf/exportNaming')
      const fileName = exportedFileName(loaded.fileName)
      const result = await saveLocalBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), fileName, PDF_SAVE_TYPE)
      if (result === 'cancelled') {
        setNotice('PDF export cancelled.')
        return
      }
      setCompatibilityFeatures(null)
      dispatch({ type: 'markSaved', document: documentSnapshot })
      const projectOnlyStateSaved = latestComments.current === commentsSnapshot
        && latestOcr.current.length === 0
      if (latestDocument.current === documentSnapshot && projectOnlyStateSaved) {
        setProjectSavedDocument(documentSnapshot)
        setProjectOnlyDirty(false)
        await recoveryQueue.current.clear(recoveryKey)
      }
      setNotice(
        latestDocument.current === documentSnapshot
          ? `Exported ${fileName}${commentsSnapshot.length ? ' with standard PDF comments' : ''}.`
          : `Exported ${fileName}. Edits made while it was building are not in that file.`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed.')
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
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
      const edited = await buildEditedBytes(state.present, true, false, comments)
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
        const currentBytes = await buildEditedBytes(state.present, true, false, comments)
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
      <header className="topbar">
        <button type="button" className="brand-button" disabled={closing} onClick={requestClose} aria-label="Close document and return home">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span>LeafPDF</span>
        </button>
        <div className="document-identity">
          <strong title={loaded.fileName}>{loaded.fileName}</strong>
          <span>
            <i className="status-dot" /> {state.present.pages.length} page{state.present.pages.length === 1 ? '' : 's'}
            {' · '}{formatFileSize(loaded.sourceFile.size)} · {projectDirty ? 'Project unsaved' : 'Project saved'}
          </span>
        </div>
        <div className="history-controls" aria-label="Edit history">
          <button type="button" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })} aria-label="Undo">↶</button>
          <button type="button" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })} aria-label="Redo">↷</button>
        </div>
        <div className="next-actions" aria-label="Project and review tools">
          <button type="button" className="mobile-document-marks" aria-label="Marks" onClick={() => setMarksOpen(true)}>Marks</button>
          <button type="button" onClick={() => void saveProject()} disabled={savingProject}>{savingProject ? 'Saving…' : 'Save project'}</button>
          <button type="button" onClick={() => setActivePanel(activePanel === 'review' ? null : 'review')}>Review{comments.length ? ` ${comments.length}` : ''}</button>
          <button type="button" onClick={() => setActivePanel(activePanel === 'privacy' ? null : 'privacy')}>Privacy</button>
          <button type="button" onClick={() => setActivePanel(activePanel === 'ocr' ? null : 'ocr')}>OCR</button>
          <button type="button" onClick={() => setActivePanel(activePanel === 'compare' ? null : 'compare')}>Compare</button>
          <button type="button" className="desktop-document-marks" aria-label="Document marks" onClick={() => setMarksOpen(true)}>Marks</button>
        </div>
        <button
          type="button"
          className="export-button"
          disabled={exporting || loaded.features.isEncrypted}
          title={loaded.features.isEncrypted ? 'Encrypted PDFs cannot be exported.' : undefined}
          onClick={() => void exportFile()}
        >
          {exporting
            ? exportProgress
              ? `Building PDF… ${exportProgress.completedPages}/${exportProgress.totalPages}`
              : 'Building PDF…'
            : 'Export PDF'}
          {' '}<span aria-hidden="true">↓</span>
        </button>
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

      <div className="workbench-grid">
        <PageRail
          pdf={loaded.document}
          pages={state.present.pages}
          selectedPageId={state.selectedPageId}
          externalDocuments={externalDocuments}
          onInsertBlankPage={() => void insertBlankPage()}
          onInsertPdf={(file) => void insertPdf(file)}
          onSelectPage={navigateToPage}
          dispatch={dispatch}
        />
        <ToolRail
          activeTool={state.activeTool}
          onTool={(tool) => dispatch({ type: 'setTool', tool })}
          onImage={placeImage}
          onSignature={() => setSignatureOpen(true)}
        />
        <section className="document-stage">
          <div className="stage-ruler" aria-hidden="true">
            {Array.from({ length: 19 }, (_, index) => <i key={index} className={index % 5 === 0 ? 'major' : ''} />)}
          </div>
          <div className="stage-toolbar">
            <span>PAGE {pageNumberById.get(selectedPage.id)} / {state.present.pages.length}</span>
            <form className="search-control" role="search" aria-label="Find text in document" onSubmit={(event) => void runSearch(event)}>
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Find in PDF or OCR"
                aria-label="Find text in document"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value)
                  setSearchResults(null)
                }}
              />
              <button type="submit" aria-label="Search">Find</button>
              {searchResults !== null && (
                <span className="search-status" role="status">
                  {liveResults.length === 0
                    ? 'No matches'
                    : `${totalMatches} match${totalMatches === 1 ? '' : 'es'} · page ${liveResults[Math.min(searchCursor, liveResults.length - 1)]?.pageNumber}`}
                </span>
              )}
              {liveResults.length > 1 && (
                <>
                  <button type="button" aria-label="Previous matching page" onClick={() => stepSearch(-1)}>‹</button>
                  <button type="button" aria-label="Next matching page" onClick={() => stepSearch(1)}>›</button>
                </>
              )}
            </form>
            <span className="source-boundary" role="note">Original protected · Project stays editable</span>
            <button type="button" className="marks-mobile-button" onClick={() => setMarksOpen(true)}>Marks</button>
            <div className="zoom-control">
              <button type="button" aria-label="Zoom out" onClick={() => dispatch({ type: 'setZoom', zoom: state.zoom - 0.15 })}>−</button>
              <output>{Math.round(state.zoom * 100)}%</output>
              <button type="button" aria-label="Zoom in" onClick={() => dispatch({ type: 'setZoom', zoom: state.zoom + 0.15 })}>+</button>
            </div>
          </div>
          <PageStrip
            pdf={loaded.document}
            pages={state.present.pages}
            externalDocuments={externalDocuments}
            annotations={state.present.annotations}
            activeTool={state.activeTool}
            selectedAnnotationId={state.selectedAnnotationId}
            zoom={state.zoom}
            formValues={state.present.formValues}
            scrollTargetPageId={scrollTargetPageId}
            onScrolledToTarget={() => setScrollTargetPageId(null)}
            dispatch={dispatch}
          />
        </section>
        <Inspector annotation={selectedAnnotation} canPaste={state.clipboard !== null} dispatch={dispatch} />
      </div>

      <footer className="statusbar">
        <span>{state.activeTool === 'select' ? 'Select, move, and resize added items' : `${state.activeTool} tool active`}</span>
        <span>{state.present.annotations.length} item{state.present.annotations.length === 1 ? '' : 's'} added</span>
        <span className="privacy-footer">Local project · {comments.length} comment{comments.length === 1 ? '' : 's'} · No upload · No tracking</span>
      </footer>

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

      <div className="toast-region" role="status" aria-live="polite">
        {notice && (
          <div className="toast">
            <span>{notice}</span>
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
      <ExportCompatibilityDialog
        features={compatibilityFeatures}
        onCancel={() => setCompatibilityFeatures(null)}
        onAccept={() => {
          setCompatibilityFeatures(null)
          void exportFile(true)
        }}
      />
    </main>
  )
}
