import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { IMAGE_LIMITS } from '../model/imageValidation'
import type { SavedSignature } from '../persistence/localStore'
export type { SavedSignature } from '../persistence/localStore'

type SignatureMode = 'draw' | 'type' | 'upload'

export interface SignatureDialogProps {
  open: boolean
  onClose: () => void
  /**
   * `saveForReuse` is a user choice. The parent is responsible for persisting
   * the data URL only when it is true, then placing the returned PNG in the PDF.
   */
  onApply: (dataUrl: string, saveForReuse: boolean) => void
  /** Entries supplied by the parent's local-only signature store. */
  savedSignatures?: readonly SavedSignature[]
  /** Deletes the selected reusable entry from the parent's local-only store. */
  onDeleteSavedSignature?: (signatureId: string) => void
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, canvas[tabindex], [tabindex]:not([tabindex="-1"])'
const CANVAS_WIDTH = 1120
const CANVAS_HEIGHT = 380

function clearCanvas(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext('2d')
  if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
}

function drawTypedName(canvas: HTMLCanvasElement | null, name: string) {
  const context = canvas?.getContext('2d')
  if (!canvas || !context) return false
  context.clearRect(0, 0, canvas.width, canvas.height)
  const trimmed = name.trim()
  if (!trimmed) return false

  // The browser selects the best locally-installed cursive face. It is rasterised
  // before leaving this dialog, avoiding an external font request or dependency.
  let size = 136
  context.font = `italic ${size}px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive`
  while (size > 42 && context.measureText(trimmed).width > canvas.width - 110) {
    size -= 4
    context.font = `italic ${size}px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive`
  }
  context.fillStyle = '#182026'
  context.textBaseline = 'middle'
  context.fillText(trimmed, 56, canvas.height / 2 + 10)
  return true
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

export function SignatureDialog({
  open,
  onClose,
  onApply,
  savedSignatures = [],
  onDeleteSavedSignature,
}: SignatureDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const clearRef = useRef<HTMLButtonElement>(null)
  const [mode, setMode] = useState<SignatureMode>('draw')
  const [hasInk, setHasInk] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saveForReuse, setSaveForReuse] = useState(false)

  const resetForMode = useCallback((nextMode: SignatureMode) => {
    setMode(nextMode)
    setUploadError(null)
    // Switching away from an upload starts a fresh source on return. Keeping an
    // invisible stale PNG would make the preview and placed result disagree.
    if (nextMode !== 'upload') setUploadedDataUrl(null)
    setHasInk(nextMode === 'type' ? Boolean(typedName.trim()) : false)
    if (nextMode === 'draw') clearCanvas(canvasRef.current)
  }, [typedName])

  useEffect(() => {
    if (!open) return
    setMode('draw')
    setHasInk(false)
    setTypedName('')
    setUploadedDataUrl(null)
    setUploadError(null)
    setSaveForReuse(false)
    clearCanvas(canvasRef.current)
  }, [open])

  useEffect(() => {
    if (!open || mode !== 'type') return
    setHasInk(drawTypedName(canvasRef.current, typedName))
  }, [open, mode, typedName])

  // Return focus to the opener so keyboard users are not dropped at page top.
  const openerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement as HTMLElement | null
    clearRef.current?.focus()
    return () => openerRef.current?.focus()
  }, [open])

  // The callbacks can be inline parent functions. Refs keep the window listener
  // stable even if a parent renders during the same key event.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const trapTab = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCloseRef.current()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => element.offsetParent !== null || element === document.activeElement)
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus()
    }
  }, [])
  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', trapTab)
    return () => window.removeEventListener('keydown', trapTab)
  }, [open, trapTab])

  if (!open) return null

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
    setHasInk(true)
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
    } else clearCanvas(canvasRef.current)
    setHasInk(false)
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
      setHasInk(true)
    } catch (error) {
      setUploadedDataUrl(null)
      setHasInk(false)
      clearCanvas(canvasRef.current)
      setUploadError(error instanceof Error ? error.message : 'The signature image could not be read.')
    }
  }
  const apply = () => {
    const canvas = canvasRef.current
    const dataUrl = mode === 'upload' ? uploadedDataUrl : canvas?.toDataURL('image/png')
    if (!dataUrl || !hasInk) return
    onApply(dataUrl, saveForReuse)
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="signature-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-title" aria-describedby="signature-instructions">
        <span className="inspector-label">SIGNATURE</span>
        <h2 id="signature-title">Add your signature</h2>
        <p id="signature-instructions">
          Draw, type, or upload a signature. It is a picture of a signature, not a digital signature, and stays on this device.
        </p>

        <div className="signature-tabs" role="tablist" aria-label="Signature method">
          {(['draw', 'type', 'upload'] as const).map((entry) => (
            <button key={entry} id={`signature-tab-${entry}`} type="button" role="tab" aria-selected={mode === entry}
              aria-controls={`signature-panel-${entry}`} onClick={() => resetForMode(entry)}>
              {entry === 'draw' ? 'Draw' : entry === 'type' ? 'Type' : 'Upload'}
            </button>
          ))}
        </div>

        <div id={`signature-panel-${mode}`} role="tabpanel" aria-labelledby={`signature-tab-${mode}`}>
          {mode === 'type' && (
            <label className="signature-field">
              Name for signature
              <input autoFocus type="text" value={typedName} maxLength={100} placeholder="Type your name" onChange={(event) => setTypedName(event.target.value)} />
            </label>
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
            aria-label="Signature drawing area"
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

        {savedSignatures.length > 0 && (
          <section className="saved-signatures" aria-label="Saved signatures">
            <div className="saved-signatures-heading"><strong>Saved signatures</strong><span>Local only</span></div>
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

        <div className="dialog-actions">
          <button type="button" ref={clearRef} className="text-button" onClick={clear}>Clear</button>
          <button type="button" className="text-button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary-button" disabled={!hasInk} onClick={apply}>Place signature</button>
        </div>
      </section>
    </div>
  )
}
