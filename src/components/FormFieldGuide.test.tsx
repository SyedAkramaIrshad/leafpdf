import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormFieldGuide } from './FormFieldGuide'

describe('FormFieldGuide', () => {
  it('starts at the first real field without calling optional fields required', () => {
    const onStart = vi.fn()
    const onClose = vi.fn()
    render(
      <FormFieldGuide
        open
        busy={false}
        target={null}
        pageNumber={null}
        onStart={onStart}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onClose={onClose}
      />,
    )

    expect(screen.getByRole('region', { name: 'Fillable field guide' })).toBeInTheDocument()
    expect(screen.getByText('TAB')).toBeInTheDocument()
    expect(screen.getByText('Optional fields stay optional.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start at first field' }))
    expect(onStart).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Close fillable field guide' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('moves around an active page-aware target', () => {
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    render(
      <FormFieldGuide
        open
        busy={false}
        target={{ pageId: 'page-2', widgetId: 'field-3', index: 3, total: 7 }}
        pageNumber={2}
        onStart={vi.fn()}
        onPrevious={onPrevious}
        onNext={onNext}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Page 2 · Field 3 of 7')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous field' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next field' }))
    expect(onPrevious).toHaveBeenCalledOnce()
    expect(onNext).toHaveBeenCalledOnce()
  })

  it('disables movement while finding a field', () => {
    render(
      <FormFieldGuide
        open
        busy
        target={{ pageId: 'page-1', widgetId: 'field-1', index: 1, total: 2 }}
        pageNumber={1}
        onStart={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Finding field…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous field' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next field' })).toBeDisabled()
  })

  it('renders nothing while closed', () => {
    render(
      <FormFieldGuide
        open={false}
        busy={false}
        target={null}
        pageNumber={null}
        onStart={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('region', { name: 'Fillable field guide' })).not.toBeInTheDocument()
  })
})
