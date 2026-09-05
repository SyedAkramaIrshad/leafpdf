import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { IMAGE_LIMITS } from '../model/imageValidation'
import {
  SIGNATURE_STYLES,
  signatureTextForName,
  suggestedSignatureName,
  type SignatureStyle,
  type SignatureStyleId,
  type SignatureTextMode,
} from '../model/typedSignature'
import type { SavedSignature } from '../persistence/localStore'
import { useModalDialog } from './useModalDialog'
export type { SavedSignature } from '../persistence/localStore'

type SignatureMode = 'draw' | 'type' | 'upload'

export interface SignatureDialogProps {
  open: boolean
  onClose: () => void
  /**
   * `saveForReuse` is a user choice. The parent is responsible for persisting
   * the data URL only when it is true, then placing the returned PNG in the PDF.
   */
  onApply: (dataUrl: string, saveForReuse: boolean, suggestedName?: string) => void
  /** Entries supplied by the parent's local-only signature store. */
  savedSignatures?: readonly SavedSignature[]
  /** Deletes the selected reusable entry from the parent's local-only store. */
  onDeleteSavedSignature?: (signatureId: string) => void
}

const CANVAS_WIDTH = 1120
const CANVAS_HEIGHT = 380
export const SIGNATURE_ASPECT_RATIO = CANVAS_WIDTH / CANVAS_HEIGHT

function clearCanvas(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext('2d')
  if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
}

function drawTypedName(
  canvas: HTMLCanvasElement | null,
  signatureText: string,
  style: SignatureStyle,
) {
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  if (!signatureText) return

  // The browser selects the best locally installed face in each stack. The result
  // is rasterised here, avoiding an external font request or persistence change.
  const emphasis = style.id === 'clean' ? '500' : 'italic'
  let size = style.size
  context.font = `${emphasis} ${size}px ${style.canvasFamily}`
  while (size > 42 && context.measureText(signatureText).width > canvas.width - 110) {
    size -= 4
    context.font = `${emphasis} ${size}px ${style.canvasFamily}`
  }
  context.fillStyle = '#182026'
  context.textBaseline = 'middle'
  context.fillText(signatureText, 56, canvas.height / 2 + 10)
}

function paintImage(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  const scale = Math.min((canvas.width - 64) / image.naturalWidth, (canvas.height - 48) / image.naturalHeight)
  const width = Math.max(1, image.naturalWidth * scale)
  const height = Math.max(1, image.naturalHeight * scale)
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
}

/**
 * Decode an uploaded image and produce a well-bounded PNG data URL. Kept exported
 * so it can be exercised without opening the dialog in browser-level tests.
 */
export async function normalizeSignatureUpload(file: File, canvas: HTMLCanvasElement): Promise<string> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    throw new Error('Choose a PNG or JPEG image for the signature.')
  }
  if (file.size > IMAGE_LIMITS.maxBytes) {
    throw new Error(`This signature image is larger than ${IMAGE_LIMITS.maxBytes / (1024 * 1024)} MB. Choose a smaller file.`)
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image()
      candidate.onload = () => resolve(candidate)
      candidate.onerror = () => reject(new Error('The signature image could not be decoded.'))
      candidate.src = objectUrl
    })
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('The signature image is empty.')
    if (
      image.naturalWidth > IMAGE_LIMITS.maxDimension
      || image.naturalHeight > IMAGE_LIMITS.maxDimension
      || image.naturalWidth * image.naturalHeight > IMAGE_LIMITS.maxPixels
    ) {
      throw new Error('The signature image dimensions are too large. Choose a smaller image.')
    }
    paintImage(canvas, image)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function SignatureDialog({ open, ...rest }: SignatureDialogProps) {
  // Mounted only while open: each open starts on a fresh Type tab, and
  // `useModalDialog` arms and disarms with the dialog itself.
  if (!open) return null
  return <SignatureDialogContent {...rest} />
}

function SignatureDialogContent({
  onClose,
  onApply,
  savedSignatures = [],
  onDeleteSavedSignature,
}: Omit<SignatureDialogProps, 'open'>) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const typedNameRef = useRef<HTMLInputElement>(null)
  const dialogRef = useModalDialog<HTMLElement>({ onEscape: onClose, initialFocusRef: typedNameRef })
  const [mode, setMode] = useState<SignatureMode>('type')
  const [hasDrawnInk, setHasDrawnInk] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [typedTextMode, setTypedTextMode] = useState<SignatureTextMode>('full')
  const [typedStyleId, setTypedStyleId] = useState<SignatureStyleId>('script')
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saveForReuse, setSaveForReuse] = useState(false)
  const typedSignatureText = signatureTextForName(typedName, typedTextMode)
  const typedStyle = SIGNATURE_STYLES.find((style) => style.id === typedStyleId) ?? SIGNATURE_STYLES[0]

  // Whether "Place signature" has something real to place is derived per mode,
  // so no effect has to mirror it into state.
  const placeable = mode === 'draw'
    ? hasDrawnInk
    : mode === 'type'
      ? typedSignatureText.length > 0
      : uploadedDataUrl !== null

  // The canvas is an external system: keep its pixels in sync with all typed choices.
  useEffect(() => {
    if (mode === 'type') drawTypedName(canvasRef.current, typedSignatureText, typedStyle)
  }, [mode, typedSignatureText, typedStyle])

  const resetForMode = (nextMode: SignatureMode) => {
    setMode(nextMode)
    setUploadError(null)
    // Every method switch starts with pixels belonging to that method only.
    setUploadedDataUrl(null)
    if (nextMode === 'draw') {
      setHasDrawnInk(false)
      clearCanvas(canvasRef.current)
    } else if (nextMode === 'upload') {
      clearCanvas(canvasRef.current)
    }
  }

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * event.currentTarget.width / bounds.width,
      y: (event.clientY - bounds.top) * event.currentTarget.height / bounds.height,
    }
  }
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw') return
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const p = point(event)
    context.beginPath()
    context.arc(p.x, p.y, 1.5, 0, Math.PI * 2)
    context.fillStyle = '#182026'
    context.fill()
    context.beginPath(); context.moveTo(p.x, p.y)
    context.strokeStyle = '#182026'; context.lineWidth = 6; context.lineCap = 'round'; context.lineJoin = 'round'
    setHasDrawnInk(true)
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'draw' || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const context = event.currentTarget.getContext('2d')
    if (!context) return
    const p = point(event); context.lineTo(p.x, p.y); context.stroke()
  }
  const release = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const clear = () => {
    setUploadError(null)
    if (mode === 'type') setTypedName('')
    else if (mode === 'upload') {
      setUploadedDataUrl(null); clearCanvas(canvasRef.current)
    } else {
      clearCanvas(canvasRef.current)
      setHasDrawnInk(false)
    }
  }
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    // Reset allows the same chosen file to be picked again after Clear.
    event.currentTarget.value = ''
    if (!file || !canvasRef.current) return
    setUploadError(null)
    try {
      const normalized = await normalizeSignatureUpload(file, canvasRef.current)
      setUploadedDataUrl(normalized)
    } catch (error) {
      setUploadedDataUrl(null)
      clearCanvas(canvasRef.current)
      setUploadError(error instanceof Error ? error.message : 'The signature image could not be read.')
    }
  }
  const apply = () => {
    const canvas = canvasRef.current
    const dataUrl = mode === 'upload' ? uploadedDataUrl : canvas?.toDataURL('image/png')
    if (!dataUrl || !placeable) return
    onApply(
      dataUrl,
      saveForReuse,
      mode === 'type' ? suggestedSignatureName(typedName, typedTextMode) : undefined,
    )
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="signature-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-title" aria-describedby="signature-instructions">
        <span className="inspector-label">SIGNATURE</span>
        <h2 id="signature-title">Add your signature</h2>
        <p id="signature-instructions">
          Type, draw, or upload a signature. It is a picture of a signature, not a digital signature. It is not certificate-backed and stays on this device.
        </p>

        {savedSignatures.length > 0 && (
          <section className="saved-signatures" aria-label="Saved signatures">
            <div className="saved-signatures-heading"><strong>Use saved</strong><span>Local only</span></div>
            <div className="saved-signature-list">
              {savedSignatures.map((signature) => (
                <article className="saved-signature" key={signature.id}>
                  <button type="button" className="saved-signature-place" aria-label={`Place saved signature ${signature.name}`}
                    onClick={() => onApply(signature.dataUrl, false)}>
                    <img src={signature.dataUrl} alt="" />
                    <span>{signature.name}</span>
                  </button>
                  {onDeleteSavedSignature && (
                    <button type="button" className="saved-signature-delete" aria-label={`Delete saved signature ${signature.name}`}
                      onClick={() => onDeleteSavedSignature(signature.id)}>×</button>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="signature-tabs" role="tablist" aria-label="Signature method">
          {(['type', 'draw', 'upload'] as const).map((entry) => (
            <button key={entry} id={`signature-tab-${entry}`} type="button" role="tab" aria-selected={mode === entry}
              aria-controls={`signature-panel-${entry}`} onClick={() => resetForMode(entry)}>
              {entry === 'draw' ? 'Draw' : entry === 'type' ? 'Type' : 'Upload'}
            </button>
          ))}
        </div>

        <div id={`signature-panel-${mode}`} role="tabpanel" aria-labelledby={`signature-tab-${mode}`}>
          {mode === 'type' && (
            <div className="signature-type-desk">
              <label className="signature-field">
                Name for signature
                <input ref={typedNameRef} type="text" value={typedName} maxLength={100} placeholder="Type your name" onChange={(event) => setTypedName(event.target.value)} />
              </label>
              <div className="signature-text-modes" role="group" aria-label="Signature text">
                <button type="button" aria-pressed={typedTextMode === 'full'} onClick={() => setTypedTextMode('full')}>Full name</button>
                <button type="button" aria-pressed={typedTextMode === 'initials'} onClick={() => setTypedTextMode('initials')}>Initials</button>
              </div>
              <div className="signature-style-picker" role="radiogroup" aria-label="Signature style">
                {SIGNATURE_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    role="radio"
                    data-signature-style={style.id}
                    aria-label={`${style.label} signature style`}
                    aria-checked={typedStyleId === style.id}
                    onClick={() => setTypedStyleId(style.id)}
                  >
                    <span className="signature-style-sample" style={{ fontFamily: style.cssFamily }}>
                      {typedSignatureText || 'Aa'}
                    </span>
                    <span>{style.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode === 'upload' && (
            <label className="signature-file-field">
              <span>Signature image</span>
              <input type="file" accept="image/png,image/jpeg" aria-label="Upload signature image" onChange={upload} />
              <small>PNG or JPEG only. It is converted to a local PNG before placement.</small>
            </label>
          )}
          <canvas
            ref={canvasRef}
            tabIndex={mode === 'draw' ? 0 : -1}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className={mode === 'draw' ? 'is-drawable' : undefined}
            aria-label={mode === 'draw' ? 'Signature drawing area' : 'Signature preview'}
            aria-describedby={mode === 'draw' ? 'signature-canvas-help' : undefined}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={release}
            onPointerCancel={release}
          />
          {mode === 'draw' && <small id="signature-canvas-help" className="signature-canvas-help">Draw with a mouse, trackpad, or touch screen. Keyboard users can use the Type tab.</small>}
          {uploadError && <p className="signature-upload-error" role="alert">{uploadError}</p>}
        </div>

        <label className="signature-reuse-toggle">
          <input type="checkbox" checked={saveForReuse} onChange={(event) => setSaveForReuse(event.target.checked)} />
          Save this signature for reuse on this device
        </label>

        <div className="dialog-actions">
          <button type="button" className="text-button" onClick={clear}>Clear</button>
          <button type="button" className="text-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" disabled={!placeable} onClick={apply}>Place signature</button>
        </div>
      </section>
    </div>
  )
}
