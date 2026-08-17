import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ShapeTool, StampTool, Tool } from '../model/editor'

interface ToolRailProps {
  activeTool: Tool
  onTool: (tool: Tool) => void
  onImage: (file: File) => void
  onSignature: () => void
}

const toolButtons: Array<{ tool: Tool; label: string; glyph: string }> = [
  { tool: 'select', label: 'Select', glyph: '↖' },
  { tool: 'text', label: 'Add text', glyph: 'T' },
  { tool: 'highlight', label: 'Highlight', glyph: '▰' },
  { tool: 'redact', label: 'Redact', glyph: '█' },
  { tool: 'pen', label: 'Draw', glyph: '⌁' },
]

export function ToolRail({ activeTool, onTool, onImage, onSignature }: ToolRailProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const shapesButtonRef = useRef<HTMLButtonElement>(null)
  const stampsButtonRef = useRef<HTMLButtonElement>(null)
  const shapesMenuRef = useRef<HTMLDivElement>(null)
  const stampsMenuRef = useRef<HTMLDivElement>(null)
  const [palette, setPalette] = useState<'shapes' | 'stamps' | null>(null)
  const choose = (tool: Tool) => {
    onTool(tool)
    setPalette(null)
  }
  const shapeTools: Array<{ tool: ShapeTool; label: string; glyph: string }> = [
    { tool: 'rectangle', label: 'Add rectangle', glyph: '□' },
    { tool: 'ellipse', label: 'Add ellipse', glyph: '○' },
    { tool: 'line', label: 'Add line', glyph: '╱' },
    { tool: 'arrow', label: 'Add arrow', glyph: '↗' },
  ]
  const stampTools: Array<{ tool: StampTool; label: string; glyph: string }> = [
    { tool: 'check', label: 'Add checkmark', glyph: '✓' },
    { tool: 'cross', label: 'Add cross', glyph: '×' },
    { tool: 'dot', label: 'Add dot', glyph: '●' },
    { tool: 'date', label: 'Add date', glyph: '31' },
  ]
  useEffect(() => {
    const menu = palette === 'shapes' ? shapesMenuRef.current : palette === 'stamps' ? stampsMenuRef.current : null
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [palette])

  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>, kind: 'shapes' | 'stamps') => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      setPalette(null)
      queueMicrotask(() => (kind === 'shapes' ? shapesButtonRef : stampsButtonRef).current?.focus())
      return
    } else return
    event.preventDefault()
    items[next]?.focus()
  }

  return (
    <nav className="tool-rail" aria-label="Editing tools">
      <span className="rail-label">TOOLS</span>
      {toolButtons.map(({ tool, label, glyph }) => (
        <button
          key={tool}
          type="button"
          className={`tool-button ${activeTool === tool ? 'is-active' : ''}`}
          aria-label={label}
          aria-pressed={activeTool === tool}
          title={label}
          onClick={() => onTool(tool)}
        >
          <span aria-hidden="true">{glyph}</span>
        </button>
      ))}
      <div className="tool-palette-anchor">
        <button
          ref={shapesButtonRef}
          type="button"
          className={`tool-button ${shapeTools.some(({ tool }) => tool === activeTool) ? 'is-active' : ''}`}
          aria-label="Shapes"
          aria-haspopup="menu"
          aria-controls="shape-tools-menu"
          aria-expanded={palette === 'shapes'}
          onClick={() => setPalette((current) => current === 'shapes' ? null : 'shapes')}
        >
          <span aria-hidden="true">◇</span>
        </button>
        {palette === 'shapes' && (
          <div id="shape-tools-menu" ref={shapesMenuRef} className="tool-palette" role="menu" aria-label="Shape tools" onKeyDown={(event) => navigateMenu(event, 'shapes')}>
            {shapeTools.map(({ tool, label, glyph }) => (
              <button key={tool} type="button" role="menuitem" aria-label={label} onClick={() => choose(tool)}>
                <span aria-hidden="true">{glyph}</span><span>{label.replace('Add ', '')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="tool-palette-anchor">
        <button
          ref={stampsButtonRef}
          type="button"
          className={`tool-button ${stampTools.some(({ tool }) => tool === activeTool) ? 'is-active' : ''}`}
          aria-label="Fill symbols"
          aria-haspopup="menu"
          aria-controls="fill-symbol-tools-menu"
          aria-expanded={palette === 'stamps'}
          onClick={() => setPalette((current) => current === 'stamps' ? null : 'stamps')}
        >
          <span aria-hidden="true">✓</span>
        </button>
        {palette === 'stamps' && (
          <div id="fill-symbol-tools-menu" ref={stampsMenuRef} className="tool-palette" role="menu" aria-label="Fill symbol tools" onKeyDown={(event) => navigateMenu(event, 'stamps')}>
            {stampTools.map(({ tool, label, glyph }) => (
              <button key={tool} type="button" role="menuitem" aria-label={label} onClick={() => choose(tool)}>
                <span aria-hidden="true">{glyph}</span><span>{label.replace('Add ', '')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="tool-divider" />
      <button type="button" className="tool-button" aria-label="Add image" title="Add image" onClick={() => inputRef.current?.click()}>
        <span aria-hidden="true">▧</span>
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/png,image/jpeg"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImage(file)
          event.target.value = ''
        }}
      />
      <button type="button" className="tool-button" aria-label="Add signature" title="Add signature" onClick={onSignature}>
        <span className="signature-glyph" aria-hidden="true">S</span>
      </button>
    </nav>
  )
}
