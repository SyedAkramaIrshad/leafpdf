import { lazy, Suspense, useState } from 'react'
import { FileWelcome } from './components/FileWelcome'
import type { LoadedPdf } from './pdf/types'

const Workbench = lazy(() => import('./components/Workbench').then((module) => ({ default: module.Workbench })))

export default function App() {
  const [loaded, setLoaded] = useState<LoadedPdf | null>(null)
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const { loadPdf } = await import('./pdf/loadPdf')
      setLoaded(await loadPdf(file))
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'This PDF could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  // `destroy()` tears down the PDF.js worker and releases its page and font caches;
  // `cleanup()` only trims transient render data and leaves the document allocated.
  // In PDF.js 6 `destroy()` lives on the loading task, reached from the document.
  //
  // The document leaves state *before* the await: clearing it afterwards raced a
  // quick close-then-open, wiping the newly opened document once the old worker
  // finally shut down.
  const closeFile = async () => {
    const closingDocument = loaded
    setLoaded(null)
    setClosing(true)
    try {
      await closingDocument?.document.loadingTask.destroy()
    } finally {
      setClosing(false)
    }
  }

  return loaded
    ? (
      <Suspense fallback={<div className="editor-loading" role="status">Preparing the document workbench...</div>}>
        <Workbench
          key={`${loaded.fileName}:${loaded.sourceFile.size}`}
          loaded={loaded}
          closing={closing}
          onClose={closeFile}
        />
      </Suspense>
    )
    : <FileWelcome busy={busy} error={error} onFile={openFile} />
}
