import type { OcrPageResult } from '../project/projectTypes'

interface OcrPanelProps {
  open: boolean
  pageNumber: number
  available: boolean
  running: boolean
  result: OcrPageResult | null
  onClose: () => void
  onRun: () => void
  onChangeWord: (index: number, text: string) => void
  onClear: () => void
}

export function OcrPanel({
  open,
  pageNumber,
  available,
  running,
  result,
  onClose,
  onRun,
  onChangeWord,
  onClear,
}: OcrPanelProps) {
  if (!open) return null
  return (
    <aside className="next-panel ocr-panel" aria-labelledby="ocr-panel-title">
      <header className="next-panel-header">
        <div>
          <span className="inspector-label">LOCAL OCR</span>
          <h2 id="ocr-panel-title">Page {pageNumber}</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close OCR panel">×</button>
      </header>

      <p>
        LeafPDF renders this page locally and uses the browser's on-device TextDetector.
        No page image is uploaded.
      </p>
      {!available && (
        <p className="dialog-note">
          This browser does not expose TextDetector. OCR remains unavailable here; project, review,
          privacy, and comparison features continue to work.
        </p>
      )}
      <div className="panel-button-row">
        <button type="button" className="primary-button" disabled={!available || running} onClick={onRun}>
          {running ? 'Recognizing…' : result ? 'Run OCR again' : 'Recognize this page'}
        </button>
        {result && <button type="button" className="text-button danger-text" onClick={onClear}>Clear OCR</button>}
      </div>

      {result && (
        <>
          <p className="dialog-note">
            TextDetector does not provide calibrated confidence, so every result is presented for review.
          </p>
          <ol className="ocr-word-list">
            {result.words.map((word, index) => (
              <li key={`${index}:${word.x}:${word.y}`}>
                <input
                  aria-label={`OCR word ${index + 1}`}
                  value={word.text}
                  onChange={(event) => onChangeWord(index, event.target.value)}
                />
                <small>{Math.round(word.x * 100)}%, {Math.round(word.y * 100)}%</small>
              </li>
            ))}
          </ol>
          {result.words.length === 0 && <p className="empty-panel">No text was detected on this page.</p>}
        </>
      )}
    </aside>
  )
}
