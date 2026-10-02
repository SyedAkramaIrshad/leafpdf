import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { FileWelcome } from './components/FileWelcome'
import type { LoadedPdf } from './pdf/types'
import type { OpenedLeafProject } from './project/projectTypes'
import { registerFileLaunchConsumer } from './pwa/fileAccess'

const Workbench = lazy(() => import('./components/NextLevelWorkbench').then((module) => ({
  default: module.NextLevelWorkbench,
})))

export default function App() {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null)
  const [openedProject, setOpenedProject] = useState<OpenedLeafProject | null>(null)
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const leaveGuard = useRef<((proceed: () => void) => void) | null>(null)
  const registerLeaveGuard = useCallback((guard: ((proceed: () => void) => void) | null) => {
    leaveGuard.current = guard
  }, [])

  const openFile = useCallback(async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const { loadPdf } = await import('./pdf/loadPdf')
      const projectFile = file.name.toLowerCase().endsWith('.leafpdf')
        || file.type === 'application/x-leafpdf+json'
      if (projectFile) {
        const { openLeafProject } = await import('./project/projectFormat')
        const project = await openLeafProject(file)
        const primary = await loadPdf(project.primaryFile)
        const validOriginalPages = project.project.document.pages.every((page) =>
          page.kind !== 'original' || page.sourceIndex < primary.pageCount)
        if (!validOriginalPages) {
          await primary.document.loadingTask.destroy()
          throw new Error('This project references an original page that is missing from its primary PDF.')
        }
        setOpenedProject(project)
        setLoaded(primary)
      } else {
        setOpenedProject(null)
        setLoaded(await loadPdf(file))
      }
    } catch (problem) {
      setOpenedProject(null)
      setError(problem instanceof Error ? problem.message : 'This document could not be opened.')
    } finally {
      setBusy(false)
    }
  }, [])

  // `destroy()` tears down the PDF.js worker and releases its page and font caches;
  // the document leaves state before the await so a quick close-then-open cannot
  // be wiped by the old worker finishing its shutdown later.
  const closeFile = useCallback(async () => {
    const closingDocument = loaded
    setLoaded(null)
    setOpenedProject(null)
    setClosing(true)
    try {
      await closingDocument?.document.loadingTask.destroy()
    } finally {
      setClosing(false)
    }
  }, [loaded])

  useEffect(() => registerFileLaunchConsumer((file) => {
    const proceed = () => {
      // Unmount the previous editor before opening even the same file again.
      // The guard has already preserved or explicitly discarded its recovery.
      void (async () => {
        if (loaded) await closeFile()
        await openFile(file)
      })().catch(() => setError('The previous document could not be closed. Please open your file again.'))
    }
    if (leaveGuard.current) leaveGuard.current(proceed)
    else proceed()
  }), [closeFile, loaded, openFile])

  return loaded
    ? (
      <Suspense fallback={<div className="editor-loading" role="status">Preparing the document workbench...</div>}>
        <Workbench
          key={`${loaded.fileName}:${loaded.sourceFile.size}:${openedProject?.project.updatedAt ?? 0}`}
          loaded={loaded}
          initialProject={openedProject}
          closing={closing}
          onClose={closeFile}
          registerLeaveGuard={registerLeaveGuard}
        />
      </Suspense>
    )
    : <FileWelcome busy={busy} error={error} onFile={openFile} />
}
