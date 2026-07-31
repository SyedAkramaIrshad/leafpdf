import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DocumentMarksDialog, type DocumentMarkRequest } from './DocumentMarksDialog'
import { RecoveryDialog } from './RecoveryDialog'

describe('RecoveryDialog', () => {
  it('explains local browser limits and requires an explicit restore or discard', () => {
    const onRestore = vi.fn()
    const onDiscard = vi.fn()
    const onClose = vi.fn()
    render(<RecoveryDialog open onRestore={onRestore} onDiscard={onDiscard} onClose={onClose} />)

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText(/only on this device and browser/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore edits' })).toHaveFocus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onRestore).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('wires explicit recovery choices', () => {
    const onRestore = vi.fn()
    const onDiscard = vi.fn()
    render(<RecoveryDialog open onRestore={onRestore} onDiscard={onDiscard} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore edits' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard recovery' }))
    expect(onRestore).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })
})

describe('DocumentMarksDialog', () => {
  it('returns a validated watermark request with scope and opacity', () => {
    const onApply = vi.fn<(request: DocumentMarkRequest) => void>()
    render(<DocumentMarksDialog open onClose={vi.fn()} onApply={onApply} />)

    fireEvent.change(screen.getByLabelText('Watermark text'), { target: { value: 'INTERNAL' } })
    fireEvent.click(screen.getByLabelText('Current page'))
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.33' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add watermark' }))
    expect(onApply).toHaveBeenCalledWith({ kind: 'watermark', text: 'INTERNAL', scope: 'current', opacity: 0.33 })
  })

  it('does not submit an empty watermark and returns page-number format and position', () => {
    const onApply = vi.fn<(request: DocumentMarkRequest) => void>()
    render(<DocumentMarksDialog open onClose={vi.fn()} onApply={onApply} />)

    fireEvent.change(screen.getByLabelText('Watermark text'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Add watermark' })).toBeDisabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Page numbers' }))
    fireEvent.change(screen.getByLabelText('Number format'), { target: { value: 'page-of-total' } })
    fireEvent.click(screen.getByLabelText('Bottom right'))
    fireEvent.click(screen.getByRole('button', { name: 'Add page numbers' }))
    expect(onApply).toHaveBeenCalledWith({ kind: 'pageNumbers', format: 'page-of-total', position: 'bottom-right' })
  })

  it('closes safely with Escape', () => {
    const onClose = vi.fn()
    render(<DocumentMarksDialog open onClose={onClose} onApply={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
