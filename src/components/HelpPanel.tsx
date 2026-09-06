const SOURCE_URL = 'https://github.com/SyedAkramaIrshad/leafpdf'

const finishSteps = [
  {
    title: 'Add what is missing',
    body: 'Choose Text, Details, Date, Check, Sign, or Image on the left, then place it on the page. Tools opens the extra editing tools.',
  },
  {
    title: 'Choose Done',
    body: 'Press Enter or click Done to finish text; Shift+Enter adds a line. Use Select to move an item, Shift-click to select several, or Delete to remove them. Undo and Redo are always in the top bar.',
  },
  {
    title: 'Save PDF',
    body: 'Choose Save PDF at the top right to download your finished copy. Your original stays untouched. Use the arrow beside Save PDF for a flattened copy, or Document → Save project to keep editing later.',
  },
]

const toolGuides = [
  {
    title: 'Fill forms and reuse your details',
    paragraphs: [
      'When Fields appears for a fillable PDF, open its guide and choose Start, Previous, or Next to move through the real editable controls; Tab still works, and optional blank fields never block saving. Fields navigates controls already in the PDF; Forms creates new Text, Checkbox, Radio, or Dropdown controls that stay fillable after export.',
      'Open My details to place Full name, Email, Phone, Company, or Address without retyping. Draft details work without saving; Save on this device is explicit and browser-only, and only text you choose to Place enters a project or PDF.',
    ],
  },
  {
    title: 'Dates, signatures, and images',
    paragraphs: [
      'Date stays one-click; select it to choose a calendar date and one of four exact printed formats, or type any wording in Date text.',
      'Sign opens on Type with full-name or initials styles and saved local signatures first; Draw and Upload remain available. Signatures are visual marks, not certificate-backed signatures. For Sign or Image, preview it, then click where it belongs.',
      'For Image, preview and place it once; then select it and use Adjust for opacity, precise orientation, or Replace image. Replacement stays local and is one Undo.',
    ],
  },
  {
    title: 'Correct text and mark up the page',
    paragraphs: [
      'To correct repeated source words, Find the phrase, choose Replace, type the correction, then use Replace this or Replace all; the complete Replace all batch is one Undo. OCR-only matches stay searchable but cannot be replaced automatically.',
      'For manual placement, drag Whiteout over the old content, then choose Add replacement text and type directly on the page. Whiteout does not remove what is underneath; use Redact for permanent removal.',
      'Text marks groups Highlight, Underline, and Strikeout for review notes: Highlight fills the dragged area, while Underline and Strikeout draw precise lines. Select any mark to adjust it before Save PDF. Cross and Dot stay under More marks.',
    ],
  },
  {
    title: 'Arrange items, pages, and zoom',
    paragraphs: [
      'Selecting an item keeps the paper in place and opens a compact proofing slip. Adjust reveals its controls, Hide returns to the paper-first view, and Done clears the selection. Select several items to move or align them together.',
      'Documents open at 100%. The percentage shows the current zoom. Use − or + to change it, or Fit width to fit the page to the workspace. While Fit width is active, the page follows the available workspace width.',
      'Pages current / total opens thumbnails plus add, insert, reorder, rotate, and delete controls. Drag a thumbnail grip to reorder; the arrows move one step, and the complete drop is one Undo.',
    ],
  },
  {
    title: 'Saving and editable copies',
    paragraphs: [
      'The main Save PDF action keeps real form fields fillable. Open its adjacent output menu and choose Save flattened PDF when the current values should stay visible without editable form controls. Flattening is not encryption.',
      'If a text box is empty or still says “Type here”, LeafPDF pauses so you can review it or save anyway. Your original file is never overwritten.',
    ],
  },
]

const shortcuts = [
  { keys: 'Ctrl/Cmd+Z', action: 'Undo' },
  { keys: 'Ctrl/Cmd+Shift+Z', action: 'Redo' },
  { keys: 'Ctrl/Cmd+F', action: 'Find text' },
  { keys: 'Ctrl/Cmd+C / V / D', action: 'Copy / paste / duplicate selected item' },
  { keys: 'Arrow / Shift+Arrow', action: 'Move selected item / move faster' },
  { keys: 'Option/Alt+drag', action: 'Move without alignment guides' },
  { keys: 'Delete / Backspace', action: 'Delete selected item' },
  { keys: 'Enter', action: 'Finish text / center a prepared image or signature' },
  { keys: 'Shift+Enter', action: 'Add a new line inside text' },
  { keys: 'Escape', action: 'Cancel tool or close panel' },
  { keys: '?', action: 'Open this help' },
]

interface HelpPanelProps {
  open: boolean
  onClose: () => void
}

export function HelpPanel({ open, onClose }: HelpPanelProps) {
  if (!open) return null

  return (
    <aside className="next-panel help-panel" aria-labelledby="help-panel-title">
      <header className="next-panel-header">
        <div>
          <span className="inspector-label">FINISHING GUIDE</span>
          <h2 id="help-panel-title">Finish and save</h2>
        </div>
        <button type="button" className="text-button" onClick={onClose} aria-label="Close finishing help">×</button>
      </header>

      <p className="help-intro">
        Three steps from an open PDF to a finished copy.
      </p>

      <ol className="help-steps">
        {finishSteps.map((step, index) => (
          <li key={step.title}>
            <span className="help-step-number" aria-hidden="true">{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <span className="help-section-label">CHOOSE THE RIGHT OUTPUT</span>
      <div className="help-output-grid">
        <article className="help-output-card is-project">
          <span>.leafpdf</span>
          <h3>Save project</h3>
          <p>A portable editable project with the source PDF, added items, comments, and OCR so you can continue later.</p>
        </article>
        <article className="help-output-card is-pdf">
          <span>.pdf · FILLABLE</span>
          <h3>Save fillable PDF</h3>
          <p>Keeps text, signatures, images, and current form values while leaving real form controls editable.</p>
        </article>
        <article className="help-output-card is-flattened">
          <span>.pdf · FLATTENED</span>
          <h3>Save flattened PDF</h3>
          <p>Fixes current form appearances into the pages and removes form controls. It is not encrypted or tamper-proof.</p>
        </article>
      </div>

      <details className="help-details help-shortcuts">
        <summary>Keyboard shortcuts</summary>
        <dl className="shortcut-list">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.keys}>
              <dt><kbd>{shortcut.keys}</kbd></dt>
              <dd>{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </details>

      {toolGuides.map((guide) => (
        <details className="help-details" key={guide.title}>
          <summary>{guide.title}</summary>
          {guide.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </details>
      ))}

      <div className="help-source">
        <p>PDF work stays in this browser. LeafPDF has no account, upload, or tracking.</p>
        <a href={SOURCE_URL} target="_blank" rel="noreferrer" aria-label="View LeafPDF source on GitHub">
          View source on GitHub <span aria-hidden="true">↗</span>
        </a>
      </div>
    </aside>
  )
}
