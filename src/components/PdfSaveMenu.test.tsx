import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PdfSaveMenu } from './PdfSaveMenu'

function renderMenu(overrides: Partial<ComponentProps<typeof PdfSaveMenu>> = {}) {
  const onSave = vi.fn()
  render(
    <PdfSaveMenu
      disabled={false}
      exporting={false}
      primaryLabel="Save PDF"
      progressLabel="Saving PDF…"
      onSave={onSave}
      {...overrides}
    />,
  )
  return { onSave }
}

describe('PdfSaveMenu', () => {
  it('keeps one-click save fillable and exposes two plainly described outputs', async () => {
    const { onSave } = renderMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Save PDF' }))
    expect(onSave).toHaveBeenLastCalledWith('fillable')

    fireEvent.click(screen.getByRole('button', { name: 'Choose PDF output' }))
    const fillable = screen.getByRole('menuitem', { name: 'Save fillable PDF' })
    await waitFor(() => expect(fillable).toHaveFocus())
    expect(fillable).toHaveTextContent('Keep form fields editable')
    expect(screen.getByRole('menuitem', { name: 'Save flattened PDF' }))
      .toHaveTextContent('Fix current form values into the pages')
    expect(screen.getByRole('menu', { name: 'PDF output' }))
      .toHaveTextContent('Flattening removes form controls. It is not encryption.')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Save flattened PDF' }))
    expect(onSave).toHaveBeenLastCalledWith('flattened')
    expect(screen.queryByRole('menu', { name: 'PDF output' })).not.toBeInTheDocument()
  })

  it('supports roving keyboard focus and returns focus to the disclosure on Escape', async () => {
    renderMenu()
    const disclosure = screen.getByRole('button', { name: 'Choose PDF output' })
    fireEvent.click(disclosure)
    const fillable = screen.getByRole('menuitem', { name: 'Save fillable PDF' })
    const flattened = screen.getByRole('menuitem', { name: 'Save flattened PDF' })
    await waitFor(() => expect(fillable).toHaveFocus())

    fireEvent.keyDown(fillable, { key: 'ArrowDown' })
    expect(flattened).toHaveFocus()
    fireEvent.keyDown(flattened, { key: 'Home' })
    expect(fillable).toHaveFocus()
    fireEvent.keyDown(fillable, { key: 'End' })
    expect(flattened).toHaveFocus()
    fireEvent.keyDown(flattened, { key: 'ArrowDown' })
    expect(fillable).toHaveFocus()
    fireEvent.keyDown(fillable, { key: 'ArrowUp' })
    expect(flattened).toHaveFocus()

    fireEvent.keyDown(flattened, { key: 'Escape' })
    await waitFor(() => expect(disclosure).toHaveFocus())
    expect(screen.queryByRole('menu', { name: 'PDF output' })).not.toBeInTheDocument()
  })

  it('dismisses on an outside pointer and disables both controls while unavailable', async () => {
    const { rerender } = render(
      <div>
        <PdfSaveMenu
          disabled={false}
          exporting={false}
          primaryLabel="Save PDF"
          progressLabel="Saving PDF…"
          onSave={vi.fn()}
        />
        <button type="button">Outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose PDF output' }))
    await waitFor(() => expect(screen.getByRole('menu', { name: 'PDF output' })).toBeVisible())
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('menu', { name: 'PDF output' })).not.toBeInTheDocument()

    rerender(
      <PdfSaveMenu
        disabled
        exporting
        primaryLabel="Save PDF"
        progressLabel="Saving PDF… 1/4"
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Saving PDF… 1/4' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Choose PDF output' })).toBeDisabled()
  })
})
