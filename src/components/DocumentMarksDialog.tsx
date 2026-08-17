import { useRef, useState } from 'react'
import { useModalDialog } from './useModalDialog'

export type MarkScope = 'current' | 'all'
export type PageNumberFormat = 'number' | 'page-number' | 'page-of-total'
export type PageNumberPosition = 'bottom-left' | 'bottom-center' | 'bottom-right'

export type DocumentMarkRequest =
  | { kind: 'watermark'; text: string; scope: MarkScope; opacity: number }
  | { kind: 'pageNumbers'; format: PageNumberFormat; position: PageNumberPosition }

interface DocumentMarksDialogProps {
  open: boolean
  onClose: () => void
  onApply: (request: DocumentMarkRequest) => void
}

/** Generates new, editable text overlays. It never alters existing PDF content. */
export function DocumentMarksDialog({ open, ...handlers }: DocumentMarksDialogProps) {
  // Mounted only while open: every open starts from a fresh watermark tab, and
  // `useModalDialog` arms and disarms with the dialog itself.
  if (!open) return null
  return <DocumentMarksDialogContent {...handlers} />
}

function DocumentMarksDialogContent({ onClose, onApply }: Omit<DocumentMarksDialogProps, 'open'>) {
  const watermarkInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useModalDialog<HTMLElement>({ onEscape: onClose, initialFocusRef: watermarkInputRef })
  const [mode, setMode] = useState<'watermark' | 'pageNumbers'>('watermark')
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL')
  const [scope, setScope] = useState<MarkScope>('all')
  const [opacity, setOpacity] = useState(0.18)
  const [format, setFormat] = useState<PageNumberFormat>('page-number')
  const [position, setPosition] = useState<PageNumberPosition>('bottom-center')

  const cleanWatermark = watermarkText.trim()
  const watermarkValid = cleanWatermark.length > 0 && cleanWatermark.length <= 80
  const apply = () => {
    if (mode === 'watermark') {
      if (!watermarkValid) return
      onApply({ kind: 'watermark', text: cleanWatermark, scope, opacity })
    } else {
      onApply({ kind: 'pageNumbers', format, position })
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        ref={dialogRef}
        className="document-marks-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-marks-title"
        aria-describedby="document-marks-description"
      >
        <span className="inspector-label">DOCUMENT MARKS</span>
        <h2 id="document-marks-title">Add marks to this PDF</h2>
        <p id="document-marks-description">
          These are editable LeafPDF overlays. They do not alter the original PDF text or graphics.
        </p>

        <div className="marks-tabs" role="tablist" aria-label="Document mark type">
          <button
            type="button"
            role="tab"
            id="watermark-tab"
            aria-selected={mode === 'watermark'}
            aria-controls="watermark-panel"
            onClick={() => setMode('watermark')}
          >Watermark</button>
          <button
            type="button"
            role="tab"
            id="page-numbers-tab"
            aria-selected={mode === 'pageNumbers'}
            aria-controls="page-numbers-panel"
            onClick={() => setMode('pageNumbers')}
          >Page numbers</button>
        </div>

        {mode === 'watermark' ? (
          <div id="watermark-panel" role="tabpanel" aria-labelledby="watermark-tab" className="marks-panel">
            <label htmlFor="watermark-text">Watermark text</label>
            <input
              ref={watermarkInputRef}
              id="watermark-text"
              value={watermarkText}
              maxLength={80}
              aria-invalid={!watermarkValid}
              aria-describedby="watermark-help"
              onChange={(event) => setWatermarkText(event.target.value)}
            />
            <span id="watermark-help" className="field-help">Up to 80 characters. It is added as a centred, rotated text overlay.</span>
            <fieldset>
              <legend>Apply to</legend>
              <label><input type="radio" name="watermark-scope" checked={scope === 'current'} onChange={() => setScope('current')} /> Current page</label>
              <label><input type="radio" name="watermark-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All pages</label>
            </fieldset>
            <label htmlFor="watermark-opacity">Opacity <output htmlFor="watermark-opacity">{Math.round(opacity * 100)}%</output></label>
            <input
              id="watermark-opacity"
              type="range"
              min="0.05"
              max="0.8"
              step="0.01"
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
            />
          </div>
        ) : (
          <div id="page-numbers-panel" role="tabpanel" aria-labelledby="page-numbers-tab" className="marks-panel">
            <label htmlFor="page-number-format">Number format</label>
            <select id="page-number-format" value={format} onChange={(event) => setFormat(event.target.value as PageNumberFormat)}>
              <option value="number">1</option>
              <option value="page-number">Page 1</option>
              <option value="page-of-total">Page 1 of 12</option>
            </select>
            <fieldset>
              <legend>Position</legend>
              <label><input type="radio" name="page-number-position" checked={position === 'bottom-left'} onChange={() => setPosition('bottom-left')} /> Bottom left</label>
              <label><input type="radio" name="page-number-position" checked={position === 'bottom-center'} onChange={() => setPosition('bottom-center')} /> Bottom centre</label>
              <label><input type="radio" name="page-number-position" checked={position === 'bottom-right'} onChange={() => setPosition('bottom-right')} /> Bottom right</label>
            </fieldset>
          </div>
        )}

        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" disabled={mode === 'watermark' && !watermarkValid} onClick={apply}>
            Add {mode === 'watermark' ? 'watermark' : 'page numbers'}
          </button>
        </div>
      </section>
    </div>
  )
}
