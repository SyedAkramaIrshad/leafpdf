import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_PERSONAL_DETAILS, type PersonalDetails } from '../model/personalDetails'
import { DetailsPanel } from './DetailsPanel'

const savedDetails: PersonalDetails = {
  fullName: 'Syed Akrama Irshad',
  email: 'syed@example.com',
  phone: '+91 98765 43210',
  company: 'LeafPDF',
  address: '42 Paper Street\nBengaluru',
}

function props(overrides: Partial<ComponentProps<typeof DetailsPanel>> = {}) {
  return {
    open: true,
    saved: null,
    saving: false,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onClear: vi.fn(),
    onPlace: vi.fn(),
    ...overrides,
  }
}

describe('DetailsPanel', () => {
  it('renders nothing while closed', () => {
    render(<DetailsPanel {...props({ open: false })} />)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('shows the exact saved values and local-only boundary', () => {
    render(<DetailsPanel {...props({ saved: savedDetails })} />)

    expect(screen.getByRole('heading', { name: 'Fill without retyping' })).toBeInTheDocument()
    expect(screen.getByText('LOCAL ONLY · Never added to a PDF until you choose Place')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('Syed Akrama Irshad')
    expect(screen.getByLabelText('Email')).toHaveValue('syed@example.com')
    expect(screen.getByLabelText('Phone')).toHaveValue('+91 98765 43210')
    expect(screen.getByLabelText('Company')).toHaveValue('LeafPDF')
    expect(screen.getByLabelText('Address')).toHaveValue('42 Paper Street\nBengaluru')
    expect(screen.getByRole('button', { name: 'Close personal details' })).toBeInTheDocument()
  })

  it('places an unsaved draft without saving it', () => {
    const onPlace = vi.fn()
    const onSave = vi.fn()
    render(<DetailsPanel {...props({ onPlace, onSave })} />)

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  Alex Morgan  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Place Full name' }))

    expect(onPlace).toHaveBeenCalledWith({
      id: 'fullName', label: 'Full name', text: 'Alex Morgan', width: 0.32, height: 0.07, fontSize: 14,
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves only a normalized non-empty draft', () => {
    const onSave = vi.fn()
    const view = render(<DetailsPanel {...props({ onSave })} />)
    expect(screen.getByRole('button', { name: 'Save on this device' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: '  alex@example.com  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save on this device' }))
    expect(onSave).toHaveBeenCalledWith({
      ...EMPTY_PERSONAL_DETAILS,
      email: 'alex@example.com',
    })

    view.rerender(<DetailsPanel {...props({ onSave, saving: true })} />)
    expect(screen.getByRole('button', { name: 'Saving details' })).toBeDisabled()
  })

  it('requires a second explicit action before clearing saved details', () => {
    const onClear = vi.fn()
    render(<DetailsPanel {...props({ saved: savedDetails, onClear })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear saved details' }))
    expect(screen.getByText('Clear these reusable details from this browser?')).toBeInTheDocument()
    expect(onClear).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel clear' }))
    expect(screen.queryByText('Clear these reusable details from this browser?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear saved details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm clear' }))
    expect(onClear).toHaveBeenCalledOnce()
  })
})
