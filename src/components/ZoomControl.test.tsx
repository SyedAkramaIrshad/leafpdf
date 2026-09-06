import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ZoomControl } from './ZoomControl'

describe('ZoomControl', () => {
  it('shows the fitted percentage and exposes active Fit width state', () => {
    const onFitWidth = vi.fn()
    render(
      <ZoomControl
        zoom={0.332}
        mode="fit-width"
        onZoom={vi.fn()}
        onFitWidth={onFitWidth}
      />,
    )

    expect(screen.getByRole('group', { name: 'Page zoom' })).toBeInTheDocument()
    const fit = screen.getByRole('button', { name: 'Fit page width' })
    expect(fit).toHaveTextContent('Fit 33%')
    expect(fit).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(fit)
    expect(onFitWidth).toHaveBeenCalledTimes(1)
  })

  it('sends manual zoom steps and reflects inactive Fit width mode', () => {
    const onZoom = vi.fn()
    render(
      <ZoomControl
        zoom={1}
        mode="manual"
        onZoom={onZoom}
        onFitWidth={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Fit page width' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(onZoom).toHaveBeenNthCalledWith(1, 0.85)
    expect(onZoom).toHaveBeenNthCalledWith(2, 1.15)
  })
})
