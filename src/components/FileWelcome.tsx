import { useRef, useState, type DragEvent } from 'react'

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

  return (
    <main className="welcome-shell">
      <header className="welcome-brand" aria-label="LeafPDF">
        <span className="brand-mark" aria-hidden="true">L</span>
        <span>LeafPDF</span>
        <span className="mvp-chip">MVP</span>
      </header>
      <section className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">A private PDF annotation workbench</p>
          <h1 aria-label="Annotate and sign PDFs.">Annotate.<br />Sign. Done.</h1>
          <p className="welcome-lead">
            Add text, images, signatures, highlights, and drawings. Arrange pages and export without sending the PDF to a server.
          </p>
          <div className="privacy-note">
            <span className="status-dot" aria-hidden="true" />
            Your document stays on this device.
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
          <h2>{busy ? 'Opening document...' : 'Drop a PDF here'}</h2>
          <p>or choose one from your Mac</p>
          <button type="button" className="primary-button" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? 'Reading pages' : 'Choose a PDF'}
          </button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onFile(file)
            }}
          />
          {error && <p className="error-message" role="alert">{error}</p>}
          <span className="file-limit">PDF only - up to 100 MB</span>
        </div>
      </section>
    </main>
  )
}
