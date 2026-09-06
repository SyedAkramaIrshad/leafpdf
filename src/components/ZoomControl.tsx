export type ZoomMode = 'manual' | 'fit-width'

interface ZoomControlProps {
  zoom: number
  mode: ZoomMode
  onZoom: (zoom: number) => void
  onFitWidth: () => void
}

export function ZoomControl({ zoom, mode, onZoom, onFitWidth }: ZoomControlProps) {
  return (
    <div className="zoom-control" role="group" aria-label="Page zoom">
      <button type="button" aria-label="Zoom out" onClick={() => onZoom(zoom - 0.15)}>−</button>
      <output aria-label="Current zoom" aria-live="off">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="Zoom in" onClick={() => onZoom(zoom + 0.15)}>+</button>
      <button
        type="button"
        className="zoom-fit-button"
        aria-label="Fit page width"
        aria-pressed={mode === 'fit-width'}
        onClick={onFitWidth}
      >
        Fit width
      </button>
    </div>
  )
}
