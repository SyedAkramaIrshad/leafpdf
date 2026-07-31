import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_LIMITS } from '../model/imageValidation'
import { normalizeSignatureUpload, SignatureDialog, type SavedSignature } from './SignatureDialog'

const drawingContext = {
  arc: vi.fn(), beginPath: vi.fn(), clearRect: vi.fn(), fill: vi.fn(), fillText: vi.fn(), lineTo: vi.fn(),
  measureText: vi.fn(() => ({ width: 180 })), moveTo: vi.fn(), stroke: vi.fn(),
  set fillStyle(_: string) {}, set font(_: string) {}, set lineCap(_: CanvasLineCap) {},
  set lineJoin(_: CanvasLineJoin) {}, set lineWidth(_: number) {}, set strokeStyle(_: string) {},
  set textBaseline(_: CanvasTextBaseline) {},
}

describe('SignatureDialog signature methods', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawingContext as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,signature')
    Object.defineProperty(HTMLCanvasElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
    Object.defineProperty(HTMLCanvasElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) })
    Object.defineProperty(HTMLCanvasElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() })
  })

  it('makes a typed signature into the PNG placed by the parent', () => {
    const onApply = vi.fn()
    render(<SignatureDialog open onClose={vi.fn()} onApply={onApply} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Type' }))
    fireEvent.change(screen.getByLabelText('Name for signature'), { target: { value: 'Syed Akram' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place signature' }))

    expect(onApply).toHaveBeenCalledWith('data:image/png;base64,signature', false)
  })

  it('exposes the restricted upload control and lets a drawn mark be placed', () => {
    const onApply = vi.fn()
    render(<SignatureDialog open onClose={vi.fn()} onApply={onApply} />)

    expect(screen.getByRole('tab', { name: 'Upload' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Upload' }))
    expect(screen.getByLabelText('Upload signature image')).toHaveAttribute('accept', 'image/png,image/jpeg')

    fireEvent.click(screen.getByRole('tab', { name: 'Draw' }))
    fireEvent.pointerDown(screen.getByLabelText('Signature drawing area'), { clientX: 12, clientY: 12, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Place signature' }))
    expect(onApply).toHaveBeenCalledWith('data:image/png;base64,signature', false)
  })

  it('places a reusable signature directly and forwards deletion to the store owner', () => {
    const saved: SavedSignature = { id: 'saved-1', name: 'My formal signature', dataUrl: 'data:image/png;base64,saved', createdAt: 1 }
    const onApply = vi.fn()
    const onDelete = vi.fn()
    render(<SignatureDialog open onClose={vi.fn()} onApply={onApply} savedSignatures={[saved]} onDeleteSavedSignature={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Place saved signature My formal signature' }))
    expect(onApply).toHaveBeenCalledWith(saved.dataUrl, false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved signature My formal signature' }))
    expect(onDelete).toHaveBeenCalledWith('saved-1')
  })

  it('rejects oversized uploads before asking the browser to decode them', async () => {
    const canvas = document.createElement('canvas')
    const file = new File(
      [new Uint8Array(IMAGE_LIMITS.maxBytes + 1)],
      'huge.png',
      { type: 'image/png' },
    )
    await expect(normalizeSignatureUpload(file, canvas)).rejects.toThrow(/larger than/i)
  })
})
