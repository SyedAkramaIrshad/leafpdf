import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ShapeTool, StampTool, Tool } from '../model/editor'

interface ToolRailProps {
  activeTool: Tool
  detailsOpen?: boolean
  onTool: (tool: Tool) => void
  onImage: (file: File) => void
  onSignature: () => void
  onDetails?: () => void
}

interface ToolButtonDefinition {
  tool: Tool
  label: string
  shortLabel: string
  glyph: string
}

const selectionTools: ToolButtonDefinition[] = [
  { tool: 'select', label: 'Select', shortLabel: 'Select', glyph: '↖' },
]

const finishingTools: ToolButtonDefinition[] = [
  { tool: 'text', label: 'Add text', shortLabel: 'Text', glyph: 'T' },
  { tool: 'date', label: 'Add date', shortLabel: 'Date', glyph: '31' },
  { tool: 'check', label: 'Add checkmark', shortLabel: 'Check', glyph: '✓' },
]

const markupTools: ToolButtonDefinition[] = [
  { tool: 'pen', label: 'Draw', shortLabel: 'Draw', glyph: '⌁' },
  { tool: 'link', label: 'Add link', shortLabel: 'Link', glyph: '↗' },
  { tool: 'whiteout', label: 'Whiteout', shortLabel: 'Whiteout', glyph: '▱' },
]

const textMarkTools: Array<{ tool: Tool; label: string; glyph: string }> = [
  { tool: 'highlight', label: 'Highlight', glyph: '▰' },
  { tool: 'underline', label: 'Underline', glyph: 'U̲' },
  { tool: 'strikeout', label: 'Strikeout', glyph: 'S̶' },
]

const ADVANCED_TOOLS = new Set<Tool>([
  'form-text', 'form-checkbox', 'form-radio', 'form-dropdown',
  'highlight', 'underline', 'strikeout',
  'pen', 'link', 'whiteout',
  'rectangle', 'ellipse', 'line', 'arrow',
  'cross', 'dot', 'redact',
])

function isAdvancedTool(tool: Tool) {
  return ADVANCED_TOOLS.has(tool)
}

export function ToolRail({ activeTool, detailsOpen = false, onTool, onImage, onSignature, onDetails }: ToolRailProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const advancedButtonRef = useRef<HTMLButtonElement>(null)
  const textMarksButtonRef = useRef<HTMLButtonElement>(null)
  const shapesButtonRef = useRef<HTMLButtonElement>(null)
  const marksButtonRef = useRef<HTMLButtonElement>(null)
  const formsButtonRef = useRef<HTMLButtonElement>(null)
  const textMarksMenuRef = useRef<HTMLDivElement>(null)
  const shapesMenuRef = useRef<HTMLDivElement>(null)
  const marksMenuRef = useRef<HTMLDivElement>(null)
  const formsMenuRef = useRef<HTMLDivElement>(null)
  const [palette, setPalette] = useState<'annotate' | 'shapes' | 'marks' | 'forms' | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(() => isAdvancedTool(activeTool))
  const finishChoice = (tool: Tool) => {
    onTool(tool)
    setPalette(null)
    setAdvancedOpen(false)
  }
  const shapeTools: Array<{ tool: ShapeTool; label: string; glyph: string }> = [
    { tool: 'rectangle', label: 'Add rectangle', glyph: '□' },
    { tool: 'ellipse', label: 'Add ellipse', glyph: '○' },
    { tool: 'line', label: 'Add line', glyph: '╱' },
    { tool: 'arrow', label: 'Add arrow', glyph: '↗' },
  ]
  const secondaryMarks: Array<{ tool: StampTool; label: string; glyph: string }> = [
    { tool: 'cross', label: 'Add cross', glyph: '×' },
    { tool: 'dot', label: 'Add dot', glyph: '●' },
  ]
  const formTools: Array<{ tool: Tool; label: string; glyph: string }> = [
    { tool: 'form-text', label: 'Add text field', glyph: 'T□' },
    { tool: 'form-checkbox', label: 'Add checkbox field', glyph: '☑' },
    { tool: 'form-radio', label: 'Add radio choice', glyph: '◉' },
    { tool: 'form-dropdown', label: 'Add dropdown field', glyph: '▾' },
  ]
  useEffect(() => {
    const menu = palette === 'annotate'
      ? textMarksMenuRef.current
      : palette === 'shapes'
      ? shapesMenuRef.current
      : palette === 'marks' ? marksMenuRef.current : palette === 'forms' ? formsMenuRef.current : null
    menu?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [palette])

  const navigateMenu = (event: KeyboardEvent<HTMLDivElement>, kind: 'annotate' | 'shapes' | 'marks' | 'forms') => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setPalette(null)
      queueMicrotask(() => (
        kind === 'annotate'
          ? textMarksButtonRef
          : kind === 'shapes' ? shapesButtonRef : kind === 'marks' ? marksButtonRef : formsButtonRef
      ).current?.focus())
      return
    } else return
    event.preventDefault()
    event.stopPropagation()
    items[next]?.focus()
  }

  const renderToolButton = ({ tool, label, shortLabel, glyph }: ToolButtonDefinition) => (
    <button
      key={tool}
      type="button"
      className={`tool-button ${activeTool === tool ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={activeTool === tool}
      title={label}
      onClick={() => {
        setPalette(null)
        setAdvancedOpen(false)
        onTool(tool)
      }}
    >
      <span className="tool-button-glyph" aria-hidden="true">{glyph}</span>
      <span className="tool-button-label" aria-hidden="true">{shortLabel}</span>
    </button>
  )

  const renderAdvancedToolButton = ({ tool, label, shortLabel, glyph }: ToolButtonDefinition) => (
    <button
      key={tool}
      type="button"
      className={`tool-button ${activeTool === tool ? 'is-active' : ''}`}
      aria-label={label}
      aria-pressed={activeTool === tool}
      title={label}
      onClick={() => finishChoice(tool)}
    >
      <span className="tool-button-glyph" aria-hidden="true">{glyph}</span>
      <span className="tool-button-label" aria-hidden="true">{shortLabel}</span>
    </button>
  )

  return (
    <nav className="tool-rail" aria-label="Editing tools">
      <span className="rail-label" aria-hidden="true">SELECT</span>
      <div className="tool-group tool-group-select" role="group" aria-label="Selection tool">
        {selectionTools.map(renderToolButton)}
      </div>
      <span className="tool-group-label finish-group-label" aria-hidden="true">FILL &amp; SIGN</span>
      <div className="tool-group tool-group-finish" role="group" aria-label="Fill and sign tools">
        {finishingTools.slice(0, 1).map(renderToolButton)}
        {onDetails && (
          <button
            type="button"
            className={`tool-button ${detailsOpen ? 'is-active' : ''}`}
            aria-label="My details"
            aria-expanded={detailsOpen}
            aria-controls="details-panel"
            title="My details"
            onClick={() => {
              setPalette(null)
              setAdvancedOpen(false)
              onDetails()
            }}
          >
            <span className="tool-button-glyph details-glyph" aria-hidden="true">ID</span>
            <span className="tool-button-label" aria-hidden="true">Details</span>
          </button>
        )}
        {finishingTools.slice(1).map(renderToolButton)}
        <button
          type="button"
          className={`tool-button ${activeTool === 'signature' ? 'is-active' : ''}`}
          aria-label="Add signature"
          aria-pressed={activeTool === 'signature'}
          title="Add signature"
          onClick={() => {
            setPalette(null)
            setAdvancedOpen(false)
            onSignature()
          }}
        >
          <span className="tool-button-glyph signature-glyph" aria-hidden="true">S</span>
          <span className="tool-button-label" aria-hidden="true">Sign</span>
        </button>
        <button
          type="button"
          className={`tool-button ${activeTool === 'image' ? 'is-active' : ''}`}
          aria-label="Add image"
          aria-pressed={activeTool === 'image'}
          title="Add image"
          onClick={() => {
            setPalette(null)
            setAdvancedOpen(false)
            onTool('select')
            inputRef.current?.click()
          }}
        >
          <span className="tool-button-glyph" aria-hidden="true">▧</span>
          <span className="tool-button-label" aria-hidden="true">Image</span>
        </button>
        <input
          ref={inputRef}
          className="visually-hidden"
          hidden
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Choose an image to add"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImage(file)
            event.target.value = ''
          }}
        />
      </div>
      <span className="tool-group-label more-tools-label" aria-hidden="true">MORE</span>
      <div className="tool-group tool-group-more" role="group" aria-label="More editing tools disclosure">
        <button
          ref={advancedButtonRef}
          type="button"
          className={`tool-button more-editing-tools-button ${isAdvancedTool(activeTool) ? 'has-active-tool' : ''}`}
          aria-label="More editing tools"
          aria-expanded={advancedOpen}
          aria-controls="advanced-editing-tools"
          title={isAdvancedTool(activeTool) ? 'More editing tools - an advanced tool is active' : 'More editing tools'}
          onClick={() => {
            setPalette(null)
            setAdvancedOpen((current) => !current)
          }}
        >
          <span className="tool-button-glyph" aria-hidden="true">•••</span>
          <span className="tool-button-label" aria-hidden="true">More</span>
        </button>
      </div>
      <div
        id="advanced-editing-tools"
        className="advanced-tool-groups"
        role="group"
        aria-label="Advanced editing tools"
        hidden={!advancedOpen}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || palette !== null) return
          event.preventDefault()
          setAdvancedOpen(false)
          advancedButtonRef.current?.focus()
        }}
      >
      <span className="tool-group-label" aria-hidden="true">FORMS</span>
      <div className="tool-group tool-group-forms" role="group" aria-label="Form creation tools">
        <div className="tool-palette-anchor">
          <button
            ref={formsButtonRef}
            type="button"
            className={`tool-button ${formTools.some(({ tool }) => tool === activeTool) ? 'is-active' : ''}`}
            aria-label="Forms"
            aria-haspopup="menu"
            aria-controls="form-creation-tools-menu"
            aria-expanded={palette === 'forms'}
            onClick={() => setPalette((current) => current === 'forms' ? null : 'forms')}
          >
            <span className="tool-button-glyph forms-glyph" aria-hidden="true">T□</span>
            <span className="tool-button-label" aria-hidden="true">Forms</span>
          </button>
          {palette === 'forms' && (
            <div
              id="form-creation-tools-menu"
              ref={formsMenuRef}
              className="tool-palette form-tools-palette"
              role="menu"
              aria-label="Form creation tools"
              onKeyDown={(event) => navigateMenu(event, 'forms')}
            >
              {formTools.map(({ tool, label, glyph }) => (
                <button key={tool} type="button" role="menuitem" aria-label={label} onClick={() => finishChoice(tool)}>
                  <span aria-hidden="true">{glyph}</span><span>{label.replace('Add ', '')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <span className="tool-group-label" aria-hidden="true">MARK UP</span>
      <div className="tool-group tool-group-markup" role="group" aria-label="Markup tools">
        <div className="tool-palette-anchor">
          <button
            ref={textMarksButtonRef}
            type="button"
            className={`tool-button ${textMarkTools.some(({ tool }) => tool === activeTool) ? 'is-active' : ''}`}
            aria-label="Text marks"
            aria-haspopup="menu"
            aria-controls="text-mark-tools-menu"
            aria-expanded={palette === 'annotate'}
            title="Highlight, underline, or strike out"
            onClick={() => setPalette((current) => current === 'annotate' ? null : 'annotate')}
          >
            <span className="tool-button-glyph text-marks-glyph" aria-hidden="true">A̲</span>
            <span className="tool-button-label" aria-hidden="true">Annotate</span>
          </button>
          {palette === 'annotate' && (
            <div
              id="text-mark-tools-menu"
              ref={textMarksMenuRef}
              className="tool-palette text-mark-tools-palette"
              role="menu"
              aria-label="Text review marks"
              onKeyDown={(event) => navigateMenu(event, 'annotate')}
            >
              {textMarkTools.map(({ tool, label, glyph }) => (
                <button key={tool} type="button" role="menuitem" aria-label={label} onClick={() => finishChoice(tool)}>
                  <span aria-hidden="true">{glyph}</span><span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {markupTools.map(renderAdvancedToolButton)}
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
            <span className="tool-button-glyph" aria-hidden="true">◇</span>
            <span className="tool-button-label" aria-hidden="true">Shapes</span>
          </button>
          {palette === 'shapes' && (
            <div id="shape-tools-menu" ref={shapesMenuRef} className="tool-palette" role="menu" aria-label="Shape tools" onKeyDown={(event) => navigateMenu(event, 'shapes')}>
              {shapeTools.map(({ tool, label, glyph }) => (
                <button key={tool} type="button" role="menuitem" aria-label={label} onClick={() => finishChoice(tool)}>
                  <span aria-hidden="true">{glyph}</span><span>{label.replace('Add ', '')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="tool-palette-anchor">
          <button
            ref={marksButtonRef}
            type="button"
            className={`tool-button ${secondaryMarks.some(({ tool }) => tool === activeTool) ? 'is-active' : ''}`}
            aria-label="More marks"
            aria-haspopup="menu"
            aria-controls="more-mark-tools-menu"
            aria-expanded={palette === 'marks'}
            onClick={() => setPalette((current) => current === 'marks' ? null : 'marks')}
          >
            <span className="tool-button-glyph" aria-hidden="true">×·</span>
            <span className="tool-button-label" aria-hidden="true">Marks</span>
          </button>
          {palette === 'marks' && (
            <div id="more-mark-tools-menu" ref={marksMenuRef} className="tool-palette" role="menu" aria-label="Additional mark tools" onKeyDown={(event) => navigateMenu(event, 'marks')}>
              {secondaryMarks.map(({ tool, label, glyph }) => (
                <button key={tool} type="button" role="menuitem" aria-label={label} onClick={() => finishChoice(tool)}>
                  <span aria-hidden="true">{glyph}</span><span>{label.replace('Add ', '')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`tool-button tool-button-redact ${activeTool === 'redact' ? 'is-active' : ''}`}
          aria-label="Redact"
          aria-pressed={activeTool === 'redact'}
          title="Redact"
          onClick={() => finishChoice('redact')}
        >
          <span className="tool-button-glyph" aria-hidden="true">█</span>
          <span className="tool-button-label" aria-hidden="true">Redact</span>
        </button>
      </div>
      </div>
    </nav>
  )
}
