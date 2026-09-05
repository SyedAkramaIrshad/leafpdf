import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from 'react'
import type { LoadedPdf } from '../pdf/types'
import type { SourcePdfFeatures } from '../pdf/sourceFeatures'
import type { ExportProgress } from '../pdf/exportWorkerProtocol'
import { formatFileSize, MAX_PDF_BYTES } from '../pdf/loadPdf'
import {
  searchCursorEntries,
  searchDocument,
  type PageMatches,
  type SearchCursorEntry,
} from '../pdf/textSearch'
import { annotationId, createEditorState, editorReducer, type EditorDocument, type EditorPage, type ExternalPage, type ImageAnnotation } from '../model/editor'
import { validatePlacedImage } from '../model/imageValidation'
import {
  deleteSignature,
  loadSession,
  loadSignatures,
  saveSignature,
  sessionKey,
  type SavedSignature,
} from '../persistence/localStore'
import { RecoveryQueue } from '../persistence/recoveryQueue'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { DocumentMarksDialog, type DocumentMarkRequest } from './DocumentMarksDialog'
import { ExportCompatibilityDialog } from './ExportCompatibilityDialog'
import { Inspector } from './Inspector'
import { PageRail } from './PageRail'
import { PageStrip } from './PageStrip'
import { RecoveryDialog } from './RecoveryDialog'
import { SignatureDialog } from './SignatureDialog'
import { SkipNavigation } from './SkipNavigation'
import { ToolPlacementHint } from './ToolPlacementHint'
import { ToolRail } from './ToolRail'

interface WorkbenchProps {
  loaded: LoadedPdf
  closing?: boolean
  onClose: () => void
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The image could not be read.'))
    reader.readAsDataURL(file)
  })
}

export function Workbench({ loaded, closing = false, onClose }: WorkbenchProps) {
  const [state, dispatch] = useReducer(editorReducer, createEditorState(loaded.fileName, loaded.pageCount))
  const [pagesOpen, setPagesOpen] = useState(false)
  const [signatureOpen, setSignatureOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [compatibilityFeatures, setCompatibilityFeatures] = useState<SourcePdfFeatures | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [marksOpen, setMarksOpen] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryDocument, setRecoveryDocument] = useState<EditorDocument | null>(null)
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PageMatches[] | null>(null)
  const [searchCursor, setSearchCursor] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  /** Set by explicit navigation; the page strip scrolls there and clears it. */
  const [scrollTargetPageId, setScrollTargetPageId] = useState<string | null>(null)
  const pageOrderSignature = state.present.pages.map(({ id }) => id).join('\u0000')
  const previousPageOrderSignatureRef = useRef(pageOrderSignature)
  const navigateToPage = (pageId: string) => {
    dispatch({ type: 'selectPage', pageId })
    setScrollTargetPageId(pageId)
  }
  useEffect(() => {
    if (previousPageOrderSignatureRef.current === pageOrderSignature) return
    previousPageOrderSignatureRef.current = pageOrderSignature
    setScrollTargetPageId(state.selectedPageId)
  }, [pageOrderSignature, state.selectedPageId])
  /**
   * PDFs inserted into this document during the session, keyed by the id their
   * pages carry. Files are needed again at export; proxies render previews.
   * Never persisted: recovery restores original and blank pages only.
   */
  const [insertedPdfs, setInsertedPdfs] = useState<Map<string, { file: File; pdf: import('pdfjs-dist').PDFDocumentProxy }>>(new Map())
  const externalDocuments = useMemo(
    () => new Map(Array.from(insertedPdfs, ([id, entry]) => [id, entry.pdf])),
    [insertedPdfs],
  )
  const insertedPdfsRef = useRef(insertedPdfs)
  useEffect(() => {
    insertedPdfsRef.current = insertedPdfs
  }, [insertedPdfs])
  // Closing the workbench tears down every inserted document's pdf.js worker.
  useEffect(() => () => {
    for (const entry of insertedPdfsRef.current.values()) {
      void entry.pdf.loadingTask.destroy().catch(() => undefined)
    }
  }, [])
  const recoveryKey = useMemo(
    () => sessionKey(loaded.sourceFile, loaded.documentFingerprint),
    [loaded.documentFingerprint, loaded.sourceFile],
  )
  const selectedPage = state.present.pages.find((page) => page.id === state.selectedPageId) ?? state.present.pages[0]
  const selectedAnnotations = state.present.annotations.filter(({ id }) => state.selectedAnnotationIds.includes(id))
  const selectedAnnotation = selectedAnnotations.length === 1 ? selectedAnnotations[0] : null
  const modalOpen = pagesOpen || signatureOpen || discardOpen || marksOpen || recoveryOpen || compatibilityFeatures !== null

  // `state` inside an async export closure is the value from that render, so the
  // current document has to be read through a ref to detect edits made meanwhile.
  // Synced in an effect (render must stay side-effect-free); every reader runs
  // after the commit, so the ref is never stale where it is used.
  const latestDocument = useRef(state.present)
  useEffect(() => {
    latestDocument.current = state.present
  }, [state.present])
  const recoveryQueue = useRef(new RecoveryQueue())

  useEffect(() => {
    let active = true
    const initialDocument = latestDocument.current
    void Promise.all([loadSignatures(), loadSession(recoveryKey)]).then(([signatures, recovered]) => {
      if (!active) return
      setSavedSignatures(signatures)
      // A record is offered when every original page it references exists in
      // the opened file. Blank pages restore as data; inserted-PDF pages are
      // never persisted, so they cannot appear here.
      const restorable = recovered
        && recovered.fileName === loaded.fileName
        && recovered.pages.length > 0
        && recovered.pages.every((page) => page.kind !== 'original' || page.sourceIndex < loaded.pageCount)
      if (latestDocument.current === initialDocument && restorable) {
        setRecoveryDocument(recovered)
        setRecoveryOpen(true)
      }
    }).catch(() => {
      // Storage can be blocked in private/restricted browsers; editing still works.
    })
    return () => { active = false }
  }, [loaded.fileName, loaded.pageCount, recoveryKey])

  useEffect(() => {
    if (!state.dirty) return
    const timer = window.setTimeout(() => {
      void recoveryQueue.current.save(recoveryKey, state.present).catch(() => {
        setNotice('Local recovery is unavailable in this browser. Export to keep your work.')
      })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [recoveryKey, state.dirty, state.present])

  useEffect(() => {
    // While a modal is open it owns the keyboard: the document-level shortcuts must
    // not also fire, or Escape would both dismiss the modal and reset the toolbar.
    if (modalOpen) return
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target
      // `matches` exists only on Elements; the target can be the document or window.
      const isEditing = target instanceof Element && target.matches('input, textarea, select')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        // Take over the browser's find: it cannot see into the PDF's pages.
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        const historyAction = event.shiftKey ? 'redo' : 'undo'
        dispatch({ type: historyAction })
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
      } else if (!isEditing && event.key === 'Escape') {
        dispatch({ type: 'selectAnnotation', annotationId: null })
        dispatch({ type: 'setTool', tool: 'select' })
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [modalOpen, selectedAnnotation, selectedPage.id, state.clipboard, state.selectedAnnotationIds])

  // Registered only while there is something to lose, so a clean session never
  // triggers the browser's leave-site prompt.
  useEffect(() => {
    if (!state.dirty) return
    const confirmLeave = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', confirmLeave)
    return () => window.removeEventListener('beforeunload', confirmLeave)
  }, [state.dirty])

  const requestClose = () => {
    if (state.dirty) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }

  const placeImage = async (file: File) => {
    try {
      // Decode first: nothing is added to the document unless the file is a real,
      // placeable image, and its true dimensions set the placed aspect ratio.
      const { width, height } = await validatePlacedImage(file)
      const dataUrl = await readDataUrl(file)
      const placedWidth = 0.42
      const aspect = height / width
      const annotation: ImageAnnotation = {
        id: annotationId(), pageId: selectedPage.id, kind: 'image', x: 0.2, y: 0.2,
        width: placedWidth,
        // Page height differs from page width, so this is approximate, but it beats
        // a fixed box that squashes every image to the same shape.
        height: Math.min(0.8, Math.max(0.04, placedWidth * aspect)),
        dataUrl,
        mimeType: file.type as ImageAnnotation['mimeType'],
      }
      dispatch({ type: 'addAnnotation', annotation })
      setNotice('Image added. Drag it into place, resize with the blue handles, then choose Done.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The image could not be read.')
    }
  }

  const placeSignature = (dataUrl: string, saveForReuse = false, suggestedName?: string) => {
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
        name: suggestedName?.trim() || `Signature ${savedSignatures.length + 1}`,
        dataUrl,
        createdAt: Date.now(),
      }
      void saveSignature(signature)
        .then(() => setSavedSignatures((current) => [signature, ...current]))
        .catch(() => setNotice('The signature was placed, but this browser could not save it for reuse.'))
    }
    setSignatureOpen(false)
    setNotice('Signature added. Drag it onto the signature line, then choose Done.')
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
      // Page numbers always map over every document page in order, so the map
      // index is the document index; no lookup is needed.
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
      // Size the new sheet like the currently selected page, so a Letter
      // document grows Letter pages and an A4 document grows A4 pages.
      let width = 595.28
      let height = 841.89
      if (selectedPage.kind === 'blank') {
        width = selectedPage.width
        height = selectedPage.height
      } else {
        const proxy = selectedPage.kind === 'original' ? loaded.document : insertedPdfs.get(selectedPage.documentId)?.pdf
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
      setInsertedPdfs((current) => new Map(current).set(documentId, { file, pdf }))
      dispatch({ type: 'insertPages', afterPageId: selectedPage.id, pages })
      setScrollTargetPageId(pages[0].id)
      setNotice(`Inserted ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} from ${file.name}. `
        + 'Bookmarks and form fields of the inserted PDF are not carried over.')
    } catch {
      setNotice('That PDF could not be inserted.')
    }
  }

  const runSearch = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const results = await searchDocument(loaded.document, externalDocuments, state.present.pages, searchQuery)
      setSearchResults(results)
      setSearchCursor(0)
      const firstEntry = searchCursorEntries(results)[0]
      if (firstEntry) navigateToPage(firstEntry.pageId)
    } catch {
      setNotice('The document text could not be searched.')
    }
  }

  // Results can go stale when a page is deleted after a search; navigation
  // simply skips pages that no longer exist.
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

  const exportFile = async (allowCompatibilityCopy = false) => {
    setExporting(true)
    setExportProgress(null)
    setNotice(null)
    try {
      const [{ exportInWorker }, { exportedFileName }] = await Promise.all([
        import('../pdf/exportClient'),
        import('../pdf/exportNaming'),
      ])
      // Capture exactly what is being written. The user can keep editing while the
      // worker runs, and those later edits are not in this file.
      const exportedDocument = state.present
      // Only the inserted PDFs this document still references travel to the worker.
      const referencedIds = new Set(
        exportedDocument.pages.flatMap((page) => page.kind === 'external' ? [page.documentId] : []),
      )
      const insertedFiles = Array.from(insertedPdfs)
        .filter(([id]) => referencedIds.has(id))
        .map(([id, entry]) => ({ id, file: entry.file }))
      // Redacted pages are burned to bitmaps here on the main thread — the
      // worker has no canvas — and the worker replaces those pages outright.
      const { rasterizeRedactedPages } = await import('../pdf/redactionRaster')
      const rasterizedPages = await rasterizeRedactedPages(loaded.document, externalDocuments, exportedDocument)
      let bytes: Uint8Array
      try {
        bytes = await exportInWorker(
          loaded.sourceFile,
          exportedDocument,
          (progress) => setExportProgress(progress),
          { allowCompatibilityCopy, insertedFiles, rasterizedPages },
        )
      } catch (error) {
        if (error instanceof Error && error.name === 'CompatibilityConfirmationRequired') {
          const { features } = error as Error & { features?: SourcePdfFeatures }
          setCompatibilityFeatures(features ?? loaded.features)
          return
        }
        throw error
      }
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = exportedFileName(loaded.fileName)
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setCompatibilityFeatures(null)
      // Only now, with the download actually created, are those edits safely out.
      // The reducer ignores this if the document moved on while the export ran.
      dispatch({ type: 'markSaved', document: exportedDocument })
      if (latestDocument.current === exportedDocument) {
        await recoveryQueue.current.clear(recoveryKey)
      } else {
        // Preserve edits made while the worker was building the exported snapshot.
        await recoveryQueue.current.save(recoveryKey, latestDocument.current)
      }
      setNotice(
        latestDocument.current === exportedDocument
          ? `Exported ${link.download}`
          : `Exported ${link.download}. Edits you made while it was building are not in that file — export again to include them.`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? `Export failed: ${error.message}` : 'Export failed.')
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }

  return (
    <main className="workbench-shell">
      <SkipNavigation hasItemProperties={selectedAnnotation !== null} />
      <header className="topbar">
        <button type="button" className="brand-button" disabled={closing} onClick={requestClose} aria-label="Close document and return home">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span>LeafPDF</span>
        </button>
        <div className="document-identity">
          <h1 title={loaded.fileName}>{loaded.fileName}</h1>
          <span>
            <i className="status-dot" /> {state.present.pages.length} page{state.present.pages.length === 1 ? '' : 's'}
            {' · '}{formatFileSize(loaded.sourceFile.size)} · Local session
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
        <button type="button" className="marks-button" onClick={() => setMarksOpen(true)}>
          Document marks
        </button>
        <button
          type="button"
          className="export-button"
          disabled={exporting || loaded.features.isEncrypted}
          title={loaded.features.isEncrypted ? 'Encrypted PDFs cannot be exported.' : undefined}
          onClick={() => void exportFile()}
        >
          {exporting
            ? exportProgress
              ? `Building PDF... ${exportProgress.completedPages}/${exportProgress.totalPages}`
              : 'Building PDF...'
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

      <div className={`workbench-grid ${selectedAnnotation ? 'has-item-properties' : 'is-paper-focused'}`}>
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
        <ToolRail activeTool={state.activeTool} onTool={(tool) => dispatch({ type: 'setTool', tool })} onImage={placeImage} onSignature={() => setSignatureOpen(true)} />
        <section id="pdf-document" className="document-stage" tabIndex={-1} aria-labelledby="pdf-document-title">
          <h2 id="pdf-document-title" className="visually-hidden">PDF document</h2>
          <div className="stage-ruler" aria-hidden="true">
            {Array.from({ length: 19 }, (_, index) => <i key={index} className={index % 5 === 0 ? 'major' : ''} />)}
          </div>
          <div className="stage-toolbar">
            <button
              type="button"
              className="page-organizer-trigger"
              aria-label={`Open page organizer, page ${state.present.pages.findIndex((page) => page.id === selectedPage.id) + 1} of ${state.present.pages.length}`}
              aria-haspopup="dialog"
              aria-expanded={pagesOpen}
              aria-controls="document-pages"
              onClick={() => setPagesOpen(true)}
            >
              <span aria-hidden="true">▤</span>
              Pages {state.present.pages.findIndex((page) => page.id === selectedPage.id) + 1} / {state.present.pages.length}
            </button>
            <form className="search-control" role="search" aria-label="Find text in document" onSubmit={(event) => void runSearch(event)}>
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Find in document"
                aria-label="Find text in document"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value)
                  setSearchResults(null)
                }}
              />
              <button type="submit" aria-label="Search">Find</button>
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
                  <button type="button" className="search-nav-button" aria-label="Previous match" onClick={() => stepSearch(-1)}>‹</button>
                  <button type="button" className="search-nav-button" aria-label="Next match" onClick={() => stepSearch(1)}>›</button>
                </>
              )}
            </form>
            <span className={`source-boundary ${loaded.features.hasAcroForm ? 'is-form-document' : ''}`} role="note">
              {loaded.features.hasAcroForm
                ? 'Fillable fields detected · Click the highlighted fields'
                : 'Original page protected · Added content stays editable'}
            </span>
            <div className="zoom-control">
              <button type="button" aria-label="Zoom out" onClick={() => dispatch({ type: 'setZoom', zoom: state.zoom - 0.15 })}>−</button>
              <output>{Math.round(state.zoom * 100)}%</output>
              <button type="button" aria-label="Zoom in" onClick={() => dispatch({ type: 'setZoom', zoom: state.zoom + 0.15 })}>+</button>
            </div>
          </div>
          <ToolPlacementHint tool={state.activeTool} />
          <PageStrip
            pdf={loaded.document}
            pages={state.present.pages}
            externalDocuments={externalDocuments}
            annotations={state.present.annotations}
            activeTool={state.activeTool}
            selectedPageId={state.selectedPageId}
            selectedAnnotationIds={state.selectedAnnotationIds}
            zoom={state.zoom}
            fitWidth={false}
            fitWidthRequest={0}
            onFitZoom={(zoom) => dispatch({ type: 'setZoom', zoom })}
            formValues={state.present.formValues}
            searchResults={liveResults}
            activeSearchEntry={activeSearchEntry}
            announce={setNotice}
            scrollTargetPageId={scrollTargetPageId}
            onScrolledToTarget={() => setScrollTargetPageId(null)}
            dispatch={dispatch}
          />
        </section>
        <Inspector key={selectedAnnotation?.id ?? 'empty'} annotation={selectedAnnotation} canPaste={state.clipboard !== null} dispatch={dispatch} announce={setNotice} />
      </div>

      {/*
        A live region rather than a button: the text is an announcement, not a
        control, and only the dismiss affordance should be focusable.
      */}
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
        onRestore={() => {
          if (recoveryDocument) dispatch({ type: 'restoreDocument', document: recoveryDocument })
          setRecoveryDocument(null)
          setRecoveryOpen(false)
          setNotice('Local edits restored.')
        }}
        onDiscard={() => {
          void recoveryQueue.current.clear(recoveryKey).then(() => {
            setRecoveryDocument(null)
            setRecoveryOpen(false)
          }).catch(() => setNotice('The local recovery copy could not be deleted.'))
        }}
      />
      <DiscardChangesDialog
        open={discardOpen}
        onContinue={() => setDiscardOpen(false)}
        onDiscard={() => {
          void recoveryQueue.current.clear(recoveryKey).then(() => {
            setDiscardOpen(false)
            onClose()
          }).catch(() => setNotice('The local recovery copy could not be deleted. Export before closing.'))
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
