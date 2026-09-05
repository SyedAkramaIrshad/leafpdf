import type { Tool } from '../model/editor'
import type { PreparedDetailPlacement } from '../model/personalDetails'

const INSTRUCTIONS: Partial<Record<Tool, { glyph: string; text: string; centre?: boolean }>> = {
  text: { glyph: 'T', text: 'Click where you want to add text' },
  'form-text': { glyph: 'T□', text: 'Drag where people should type' },
  'form-checkbox': { glyph: '☑', text: 'Drag where the checkbox should go' },
  'form-radio': { glyph: '◉', text: 'Drag where this radio choice should go' },
  'form-dropdown': { glyph: '▾', text: 'Drag where the dropdown should go' },
  check: { glyph: '✓', text: 'Click where the checkmark should go' },
  cross: { glyph: '×', text: 'Click where the cross should go' },
  dot: { glyph: '●', text: 'Click where the dot should go' },
  date: { glyph: '31', text: 'Click where the date should go' },
  highlight: { glyph: '▰', text: 'Drag across the area to highlight' },
  underline: { glyph: 'U̲', text: 'Drag across the area to underline' },
  strikeout: { glyph: 'S̶', text: 'Drag across the area to strike out' },
  link: { glyph: '↗', text: 'Drag over the area that should open a link' },
  whiteout: { glyph: '▱', text: 'Drag over content to cover it visually' },
  redact: { glyph: '█', text: 'Drag over content to remove on export' },
  pen: { glyph: '⌁', text: 'Draw directly on the page' },
  rectangle: { glyph: '□', text: 'Drag to draw a rectangle' },
  ellipse: { glyph: '○', text: 'Drag to draw an ellipse' },
  line: { glyph: '╱', text: 'Drag to draw a line' },
  arrow: { glyph: '↗', text: 'Drag to draw an arrow' },
  image: { glyph: '▧', text: 'Click where the image should go', centre: true },
  signature: { glyph: 'S', text: 'Click where the signature should go', centre: true },
}

export function toolPlacementInstruction(tool: Tool) {
  return INSTRUCTIONS[tool] ?? null
}

export function ToolPlacementHint({
  tool,
  preparedDetail = null,
}: {
  tool: Tool
  preparedDetail?: PreparedDetailPlacement | null
}) {
  const instruction = tool === 'text' && preparedDetail
    ? { glyph: 'ID', text: `Click where ${preparedDetail.label} should go` }
    : toolPlacementInstruction(tool)
  if (!instruction) return null

  return (
    <div className="tool-placement-hint" role="status" aria-live="polite">
      <span className="tool-placement-glyph" aria-hidden="true">{instruction.glyph}</span>
      <strong>{instruction.text}</strong>
      <span className="tool-placement-actions">
        {instruction.centre && <span><kbd>Enter</kbd> center</span>}
        <span className="tool-placement-cancel"><kbd>Esc</kbd> cancel</span>
      </span>
    </div>
  )
}
