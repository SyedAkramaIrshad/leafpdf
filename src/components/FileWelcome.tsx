import { useRef, useState, type DragEvent } from 'react'
import { chooseLocalDocument, supportsNativeOpen } from '../pwa/fileAccess'

interface FileWelcomeProps {
  busy: boolean
  error: string | null
  onFile: (file: File) => void
}

export function FileWelcome({ busy, error, onFile }: FileWelcomeProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const acceptDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onFile(file)
  }

  const chooseNative = async () => {
    try {
      const file = await chooseLocalDocument()
      if (file) onFile(file)
    } catch {
      inputRef.current?.click()
    }
  }

  return (
    <main className="welcome-shell">
      <header className="welcome-brand" aria-label="LeafPDF">
        <span className="brand-mark" aria-hidden="true">L</span>
        <span>LeafPDF</span>
        <span className="mvp-chip">LOCAL</span>
      </header>
      <section className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">A private PDF project workbench</p>
          <h1 aria-label="Annotate and sign PDFs.">Annotate.<br />Review. Keep.</h1>
          <p className="welcome-lead">
            Edit PDFs, save a portable project, review comments, inspect privacy, run local OCR,
            and compare documents without sending their contents to a server.
          </p>
          <div className="privacy-note">
            <span className="status-dot" aria-hidden="true" />
            Your document stays on this device. Editable projects do too.
          </div>
        </div>
        <div
          className={`drop-sheet ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={acceptDrop}
        >
          <div className="sheet-fold" aria-hidden="true" />
          <span className="drop-index">01 / OPEN</span>
          <div className="drop-glyph" aria-hidden="true">PDF</div>
          <h2>{busy ? 'Opening document...' : 'Drop a PDF or project here'}</h2>
          <p>Open a PDF or resume a .leafpdf project</p>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => supportsNativeOpen() ? void chooseNative() : inputRef.current?.click()}
          >
            {busy ? 'Reading project' : 'Choose PDF or project'}
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,application/x-leafpdf+json,.pdf,.leafpdf"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onFile(file)
              event.currentTarget.value = ''
            }}
          />
          {error && <p className="error-message" role="alert">{error}</p>}
          <span className="file-limit">PDF up to 100 MB · portable .leafpdf projects</span>
        </div>
      </section>
    </main>
  )
}
