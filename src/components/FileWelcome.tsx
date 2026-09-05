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
      <header className="welcome-header">
        <div className="welcome-brand" aria-label="LeafPDF">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span>LeafPDF</span>
          <span className="local-chip">LOCAL ONLY</span>
        </div>
        <div className="open-source-note">
          <a
            href="https://github.com/SyedAkramaIrshad/leafpdf"
            target="_blank"
            rel="noreferrer"
            aria-label="View LeafPDF source on GitHub"
          >
            VIEW SOURCE <span aria-hidden="true">↗</span>
          </a>
          <span aria-hidden="true">·</span>
          <span>NO ACCOUNT</span>
        </div>
      </header>
      <section className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">PRIVATE PDF FINISHING</p>
          <h1 aria-label="Finish your PDF. Keep it yours.">
            <span>Finish your PDF.</span>
            <span>Keep it yours.</span>
          </h1>
          <p className="welcome-lead">
            Add your name, date, checkmarks, signature, or an image. Arrange pages, review, then
            export a clean copy—all in your browser.
          </p>
          <div className="welcome-open-action">
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              aria-label={busy ? 'Opening a PDF or project' : 'Choose a PDF'}
              onClick={() => supportsNativeOpen() ? void chooseNative() : inputRef.current?.click()}
            >
              {busy ? 'Reading project' : 'Open PDF or project'}
            </button>
            <span className="file-limit">PDF up to 100 MB · portable .leafpdf projects</span>
          </div>
          <input
            ref={inputRef}
            className="visually-hidden"
            hidden
            type="file"
            accept="application/pdf,application/x-leafpdf+json,.pdf,.leafpdf"
            aria-label="Choose a PDF or LeafPDF project"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onFile(file)
              event.currentTarget.value = ''
            }}
          />
          {error && <p className="error-message" role="alert">{error}</p>}
          <ul className="finish-task-list" aria-label="Common PDF tasks">
            <li><span aria-hidden="true">T</span><strong>Add text</strong></li>
            <li><span aria-hidden="true">✓</span><strong>Fill details</strong></li>
            <li><span className="signature-glyph" aria-hidden="true">S</span><strong>Sign</strong></li>
            <li><span aria-hidden="true">▧</span><strong>Add image</strong></li>
          </ul>
          <div className="privacy-note">
            <span className="status-dot" aria-hidden="true" />
            Your document never leaves this device. No upload, account, or tracking.
          </div>
        </div>
        <div
          className={`drop-sheet ${dragging ? 'is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={acceptDrop}
        >
          <div className="document-demo" aria-hidden="true">
            <div className="demo-document-heading">
              <strong>Offer acceptance</strong>
              <span>READY TO FINISH</span>
            </div>
            <div className="demo-field-row">
              <span>Name</span>
              <strong>Alex Morgan</strong>
            </div>
            <div className="demo-field-row">
              <span>Date</span>
              <strong>DD / MM / YYYY</strong>
            </div>
            <div className="demo-check-row">
              <span>✓</span>
              <strong>I accept the offer</strong>
            </div>
            <div className="demo-document-footer">
              <div className="demo-signature">
                <span>Signature</span>
                <strong>Alex Morgan</strong>
              </div>
              <div className="demo-image-slot">IMAGE</div>
            </div>
          </div>
          <div className="drop-action">
            <span className="drop-index">OPEN LOCALLY</span>
            <h2>{busy ? 'Opening document…' : 'Drop a PDF or project here'}</h2>
            <p>Drag in a PDF / .leafpdf project from this device</p>
          </div>
        </div>
      </section>
    </main>
  )
}
