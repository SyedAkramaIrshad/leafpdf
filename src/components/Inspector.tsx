import { useRef, useState } from 'react'
import { annotationId as createAnnotationId, imageOpacityOf, replacementTextForWhiteout, textMarkStrokeWidthOf, textMarkStyleOf, type Annotation, type EditorAction, type ImageAnnotation, type LinkTargetType } from '../model/editor'
import {
  CREATED_FORM_FIELD_NAME_MAX_LENGTH,
  CREATED_FORM_OPTION_MAX_LENGTH,
  createdFormFieldNameIssue,
  dropdownOptionsIssue,
  radioOptionValueIssue,
} from '../model/createdFormFields'
import { DATE_FORMATS, formatDateValue, type DatePresetFormat } from '../model/dateStamp'
import { LINK_TARGET_MAX_LENGTH, externalLinkDestination, linkTargetMessage } from '../model/linkTarget'
import { annotationBounds, moveAnnotation } from '../model/annotationMovement'
import { FontSizeControl } from './FontSizeControl'

interface InspectorProps {
  annotation: Annotation | null
  annotations?: Annotation[]
  dispatch: (action: EditorAction) => void
  canPaste?: boolean
  multiSelectMode?: boolean
  onSelectMore?: () => void
  announce?: (message: string) => void
  onReplaceImage?: (annotation: ImageAnnotation, file: File) => void | Promise<void>
}

function normalizedRotation(rotation: number | undefined, change = 0) {
  const current = Number.isFinite(rotation) ? rotation ?? 0 : 0
  return ((current + change) % 360 + 360) % 360
}

function annotationDisplayName(annotation: Annotation) {
  if (annotation.kind === 'text') return annotation.sourceReplacement ? 'Replacement text' : 'Text box'
  if (annotation.kind === 'highlight') {
    const mark = textMarkStyleOf(annotation)
    return mark === 'highlight' ? 'Highlight' : mark === 'underline' ? 'Underline' : 'Strikeout'
  }
  if (annotation.kind === 'link') return 'Clickable link'
  if (annotation.kind === 'form-field') {
    return {
      text: 'Text field',
      checkbox: 'Checkbox field',
      radio: 'Radio choice',
      dropdown: 'Dropdown field',
    }[annotation.fieldType]
  }
  if (annotation.kind === 'image') return annotation.role === 'signature' ? 'Signature' : 'Image'
  if (annotation.kind === 'stamp') {
    return {
      check: 'Checkmark',
      cross: 'Cross',
      dot: 'Dot',
      date: 'Date',
    }[annotation.stamp]
  }
  if (annotation.kind === 'shape') {
    return `${annotation.shape.charAt(0).toUpperCase()}${annotation.shape.slice(1)}`
  }
  return `${annotation.kind.charAt(0).toUpperCase()}${annotation.kind.slice(1)}`
}

type PageAlignment = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom'

const PAGE_ALIGNMENTS: Array<{
  alignment: PageAlignment
  label: string
  glyph: string
}> = [
  { alignment: 'left', label: 'Left', glyph: '▥' },
  { alignment: 'center-x', label: 'Center', glyph: '↔' },
  { alignment: 'right', label: 'Right', glyph: '▤' },
  { alignment: 'top', label: 'Top', glyph: '▔' },
  { alignment: 'center-y', label: 'Middle', glyph: '↕' },
  { alignment: 'bottom', label: 'Bottom', glyph: '▁' },
]

export function Inspector({
  annotation,
  annotations,
  dispatch,
  canPaste = false,
  multiSelectMode = false,
  onSelectMore,
  announce,
  onReplaceImage,
}: InspectorProps) {
  const replacementImageInputRef = useRef<HTMLInputElement>(null)
  const [collapsed, setCollapsed] = useState(() => annotation?.kind !== 'link' && annotation?.kind !== 'form-field')
  const [replacingImage, setReplacingImage] = useState(false)
  const [fieldNameDraft, setFieldNameDraft] = useState(
    () => annotation?.kind === 'form-field' ? annotation.fieldName : '',
  )
  const [dropdownOptionsDraft, setDropdownOptionsDraft] = useState(
    () => annotation?.kind === 'form-field' && annotation.fieldType === 'dropdown'
      ? annotation.options.join('\n')
      : '',
  )

  if (!annotation) return null

  const update = (patch: Partial<Annotation>, historyGroup?: string) =>
    dispatch({ type: 'updateAnnotation', annotationId: annotation.id, patch, historyGroup })
  const endGroup = () => dispatch({ type: 'endHistoryGroup' })
  const finishEditing = () => {
    dispatch({ type: 'endHistoryGroup' })
    dispatch({ type: 'selectAnnotation', annotationId: null })
  }
  const itemName = annotationDisplayName(annotation)
  const controlsId = `item-properties-controls-${annotation.id}`
  const alignToPage = (alignment: PageAlignment, label: string) => {
    endGroup()
    const box = annotationBounds(annotation)
    const dx = alignment === 'left'
      ? -box.x
      : alignment === 'center-x'
        ? 0.5 - (box.x + box.width / 2)
        : alignment === 'right'
          ? 1 - (box.x + box.width)
          : 0
    const dy = alignment === 'top'
      ? -box.y
      : alignment === 'center-y'
        ? 0.5 - (box.y + box.height / 2)
        : alignment === 'bottom'
          ? 1 - (box.y + box.height)
          : 0
    const moved = moveAnnotation(annotation, dx, dy)
    if (moved === annotation) {
      announce?.(`${itemName} is already aligned ${label.toLowerCase()} on the page.`)
      return
    }
    dispatch({ type: 'updateAnnotation', annotationId: annotation.id, patch: moved })
    announce?.(`Aligned ${itemName.toLowerCase()} ${label.toLowerCase()} on the page. Undo restores its position.`)
  }
  const deleteItem = () => {
    endGroup()
    dispatch({ type: 'removeAnnotation', annotationId: annotation.id })
    announce?.(`${itemName} deleted. Undo restores it.`)
  }
  const fieldNameIssue = annotation.kind === 'form-field'
    ? createdFormFieldNameIssue(
        fieldNameDraft,
        annotations ?? [annotation],
        annotation.id,
        [],
        annotation.fieldType,
      )
    : null
  const radioOptionIssue = annotation.kind === 'form-field' && annotation.fieldType === 'radio'
    ? radioOptionValueIssue(
        annotation.optionValue,
        annotation.fieldName,
        annotations ?? [annotation],
        annotation.id,
      )
    : null
  const draftDropdownOptions = dropdownOptionsDraft.split(/\r?\n/).map((option) => option.trim())
  const dropdownIssue = annotation.kind === 'form-field' && annotation.fieldType === 'dropdown'
    ? dropdownOptionsIssue(
        draftDropdownOptions,
        draftDropdownOptions.includes(annotation.defaultOption) ? annotation.defaultOption : '',
      )
    : null
  const radioSiblings = annotation.kind === 'form-field' && annotation.fieldType === 'radio'
    ? (annotations ?? [annotation]).filter((candidate) =>
        candidate.kind === 'form-field'
          && candidate.fieldType === 'radio'
          && candidate.fieldName === annotation.fieldName)
    : []
  const updateRadioGroup = (patch: Partial<Annotation>, property: string) => {
    if (annotation.kind !== 'form-field' || annotation.fieldType !== 'radio') return
    const historyGroup = `radio-${annotation.fieldName}-${property}`
    for (const sibling of radioSiblings) {
      dispatch({ type: 'updateAnnotation', annotationId: sibling.id, patch, historyGroup })
    }
  }

  // One key per control, so typing groups separately from dragging a slider.
  const group = (property: string) => `annotation-${annotation.id}-${property}`

  return (
    <aside
      id="item-properties"
      className={`inspector ${collapsed ? 'is-collapsed' : ''}`}
      tabIndex={-1}
      aria-labelledby="item-properties-title"
    >
      <div className="inspector-header">
        <div>
          <span className="inspector-label">SELECTED ITEM</span>
          <h2 id="item-properties-title">{itemName}</h2>
        </div>
        <div className="inspector-header-actions">
          <button
            type="button"
            className="inspector-toggle-button"
            aria-label={multiSelectMode
              ? 'Choose another item on the page'
              : collapsed ? 'Show item properties' : 'Hide item properties'}
            aria-expanded={!collapsed}
            aria-controls={controlsId}
            onClick={() => setCollapsed((current) => !current)}
          >
            {multiSelectMode ? 'Choosing…' : collapsed ? 'Adjust' : 'Hide'}
          </button>
          <button type="button" className="inspector-done-button" onClick={finishEditing}>Done</button>
        </div>
      </div>
      <section className="inspector-essentials" aria-label="Selected item essentials">
        <div className="inspector-move-row">
          <span className="inspector-move-hint"><span aria-hidden="true">✥</span> Drag on page to move</span>
          <button type="button" className="inspector-quick-delete" onClick={deleteItem}>Delete</button>
        </div>
        <div className="page-alignment" aria-label="Align selected item on page">
          <span>Align to page</span>
          <div className="page-alignment-grid">
            {PAGE_ALIGNMENTS.map(({ alignment, label, glyph }) => (
              <button
                key={alignment}
                type="button"
                aria-label={`Align selected item ${label.toLowerCase()} on page`}
                title={label}
                onClick={() => alignToPage(alignment, label)}
              >
                <span aria-hidden="true">{glyph}</span>
                <small>{label}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
      <div id={controlsId} className="inspector-body">
      {onSelectMore && (
        <button
          type="button"
          className="select-more-button"
          aria-pressed={multiSelectMode}
          onClick={() => {
            setCollapsed(true)
            onSelectMore()
          }}
        >
          <span aria-hidden="true">＋</span>
          <span>{multiSelectMode ? 'Choose another item…' : 'Select more items'}</span>
        </button>
      )}
      {annotation.kind === 'text' && (
        <>
          {annotation.sourceReplacement && (
            <section className="source-replacement-copy" aria-label="Visual replacement safety">
              <p className="inspector-copy">
                <strong>Visual correction.</strong> The source text remains underneath these white covers
                and may still be searchable, selectable, or recoverable. Use Redact when the original
                content must be removed.
              </p>
            </section>
          )}
          <p className="inspector-copy inline-edit-hint">
            Edit the words directly on the page. Enter finishes · Shift+Enter adds a new line. Use the blue grip to move the text.
          </p>
          <label>Font family
            <select
              value={annotation.fontFamily ?? 'sans'}
              onChange={(event) => update({ fontFamily: event.target.value as 'sans' | 'serif' | 'mono' })}
            >
              <option value="sans">Sans serif</option>
              <option value="serif">Serif</option>
              <option value="mono">Monospace</option>
            </select>
          </label>
          <div className="format-buttons" aria-label="Text emphasis">
            <button
              type="button"
              aria-label="Bold"
              aria-pressed={(annotation.fontWeight ?? 400) === 700}
              onClick={() => update({ fontWeight: (annotation.fontWeight ?? 400) === 700 ? 400 : 700 })}
            >
              B
            </button>
            <button
              type="button"
              aria-label="Italic"
              aria-pressed={(annotation.fontStyle ?? 'normal') === 'italic'}
              onClick={() => update({ fontStyle: (annotation.fontStyle ?? 'normal') === 'italic' ? 'normal' : 'italic' })}
            >
              I
            </button>
          </div>
          <label>Size
            <FontSizeControl
              value={annotation.fontSize}
              onChange={(fontSize) => update({ fontSize }, group('size'))}
              onCommit={endGroup}
            />
          </label>
          <label>Color
            <input
              type="color" value={annotation.color}
              onChange={(event) => update({ color: event.target.value }, group('color'))}
              onBlur={endGroup}
            />
          </label>
        </>
      )}
      {annotation.kind === 'highlight' && (
        <>
          <label>Color
            <input
              type="color" value={annotation.color}
              onChange={(event) => update({ color: event.target.value }, group('color'))}
              onBlur={endGroup}
            />
          </label>
          <label>Opacity
            <input
              type="range" min="0.1" max={textMarkStyleOf(annotation) === 'highlight' ? '0.8' : '1'} step="0.05" value={annotation.opacity}
              onChange={(event) => update({ opacity: Number(event.target.value) }, group('opacity'))}
              onPointerUp={endGroup}
              onBlur={endGroup}
            />
          </label>
          {textMarkStyleOf(annotation) !== 'highlight' && (
            <label>Weight
              <input
                type="range" min="1" max="9" step="0.5" value={textMarkStrokeWidthOf(annotation)}
                onChange={(event) => update({ strokeWidth: Number(event.target.value) }, group('strokeWidth'))}
                onPointerUp={endGroup}
                onBlur={endGroup}
              />
            </label>
          )}
        </>
      )}
      {annotation.kind === 'link' && (
        <section className="link-properties" aria-label="Link destination">
          <label>Link type
            <select
              value={annotation.targetType}
              onChange={(event) => update(
                { targetType: event.target.value as LinkTargetType },
                group('targetType'),
              )}
              onBlur={endGroup}
            >
              <option value="url">Web address</option>
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </select>
          </label>
          <label>Destination
            <input
              type="text"
              maxLength={LINK_TARGET_MAX_LENGTH}
              value={annotation.target}
              placeholder={annotation.targetType === 'url'
                ? 'example.com'
                : annotation.targetType === 'email' ? 'name@example.com' : '+91 98765 43210'}
              inputMode={annotation.targetType === 'email' ? 'email' : annotation.targetType === 'phone' ? 'tel' : 'url'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => update({ target: event.target.value }, group('target'))}
              onBlur={endGroup}
            />
          </label>
          <p
            className={`link-target-status ${externalLinkDestination(annotation) ? 'is-valid' : 'is-invalid'}`}
            role="status"
          >
            {linkTargetMessage(annotation)}
          </p>
          <p className="inspector-copy link-proof-copy">
            This blue area is only an editing guide. The saved PDF gets an invisible clickable area.
          </p>
        </section>
      )}
      {annotation.kind === 'form-field' && (
        <section className="created-form-field-properties" aria-label="Created form field properties">
          <div className="created-form-field-kind" aria-hidden="true">
            <span>{{ text: 'T□', checkbox: '☑', radio: '◉', dropdown: '▾' }[annotation.fieldType]}</span>
            <strong>{{
              text: 'TEXT FIELD', checkbox: 'CHECKBOX', radio: 'RADIO CHOICE', dropdown: 'DROPDOWN',
            }[annotation.fieldType]}</strong>
          </div>
          <label>{annotation.fieldType === 'radio' ? 'Group name' : 'Field name'}
            <input
              type="text"
              maxLength={CREATED_FORM_FIELD_NAME_MAX_LENGTH}
              value={fieldNameDraft}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={fieldNameIssue ? 'true' : undefined}
              onChange={(event) => {
                const fieldName = event.target.value
                setFieldNameDraft(fieldName)
                if (annotation.fieldType === 'radio') updateRadioGroup({ fieldName }, 'fieldName')
                else update({ fieldName }, group('fieldName'))
              }}
              onBlur={endGroup}
            />
          </label>
          <p className={`created-form-field-name-status ${fieldNameIssue ? 'is-invalid' : 'is-valid'}`} role="status">
            {fieldNameIssue ?? (annotation.fieldType === 'radio' ? 'Unique group name ready.' : 'Unique field name ready.')}
          </p>
          {annotation.fieldType === 'text' && (
            <>
              <label>Default text
                <textarea
                  maxLength={20_000}
                  value={annotation.defaultText}
                  placeholder="Optional text shown before someone fills the field"
                  onChange={(event) => update({ defaultText: event.target.value }, group('defaultText'))}
                  onBlur={endGroup}
                />
              </label>
              <label className="created-form-field-toggle">
                <input
                  type="checkbox"
                  aria-label="Required field"
                  checked={annotation.required}
                  onChange={(event) => update({ required: event.target.checked })}
                />
                <span><strong>Required</strong><small>Mark this field as required in PDF readers.</small></span>
              </label>
              <label className="created-form-field-toggle">
                <input
                  type="checkbox"
                  aria-label="Multiline field"
                  checked={annotation.multiline}
                  onChange={(event) => update({ multiline: event.target.checked })}
                />
                <span><strong>Multiline</strong><small>Allow paragraphs instead of one line.</small></span>
              </label>
            </>
          )}
          {annotation.fieldType === 'checkbox' && (
            <>
              <label className="created-form-field-toggle">
                <input
                  type="checkbox"
                  aria-label="Required field"
                  checked={annotation.required}
                  onChange={(event) => update({ required: event.target.checked })}
                />
                <span><strong>Required</strong><small>Mark this checkbox as required in PDF readers.</small></span>
              </label>
              <label className="created-form-field-toggle">
                <input
                  type="checkbox"
                  aria-label="Checked by default"
                  checked={annotation.checkedByDefault}
                  onChange={(event) => update({ checkedByDefault: event.target.checked })}
                />
                <span><strong>Checked by default</strong><small>Start the exported checkbox checked.</small></span>
              </label>
            </>
          )}
          {annotation.fieldType === 'radio' && (
            <>
              <label>Option value
                <input
                  type="text"
                  maxLength={CREATED_FORM_OPTION_MAX_LENGTH}
                  value={annotation.optionValue}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={radioOptionIssue ? 'true' : undefined}
                  onChange={(event) => update({ optionValue: event.target.value }, group('optionValue'))}
                  onBlur={endGroup}
                />
              </label>
              <p className={`created-form-options-status ${radioOptionIssue ? 'is-invalid' : 'is-valid'}`} role="status">
                {radioOptionIssue ?? 'Unique option value ready.'}
              </p>
              <p className="created-form-radio-note">
                Choices with this group name act together. Add another choice, then drag it beside the printed answer.
              </p>
              <label className="created-form-field-toggle">
                <input
                  type="checkbox"
                  aria-label="Required group"
                  checked={annotation.required}
                  onChange={(event) => updateRadioGroup({ required: event.target.checked }, 'required')}
                />
                <span><strong>Required group</strong><small>Require one choice in PDF readers.</small></span>
              </label>
              <label className="created-form-field-toggle">
                <input
                  type="checkbox"
                  aria-label="Selected by default"
                  checked={annotation.selectedByDefault}
                  onChange={(event) => {
                    const selectedByDefault = event.target.checked
                    const historyGroup = `radio-${annotation.fieldName}-selectedByDefault`
                    for (const sibling of radioSiblings) {
                      if (sibling.id !== annotation.id && !selectedByDefault) continue
                      dispatch({
                        type: 'updateAnnotation',
                        annotationId: sibling.id,
                        patch: { selectedByDefault: sibling.id === annotation.id ? selectedByDefault : false },
                        historyGroup,
                      })
                    }
                  }}
                />
                <span><strong>Selected by default</strong><small>Start this choice selected and clear the group's other default.</small></span>
              </label>
            </>
          )}
          {annotation.fieldType === 'dropdown' && (
            <>
              <label>Choices, one per line
                <textarea
                  value={dropdownOptionsDraft}
                  aria-invalid={dropdownIssue ? 'true' : undefined}
                  placeholder={'Option 1\nOption 2'}
                  onChange={(event) => {
                    const draft = event.target.value
                    const options = draft.split(/\r?\n/).map((option) => option.trim())
                    const defaultOption = options.includes(annotation.defaultOption)
                      ? annotation.defaultOption
                      : ''
                    setDropdownOptionsDraft(draft)
                    update({ options, defaultOption }, group('options'))
                  }}
                  onBlur={endGroup}
                />
              </label>
              <p className={`created-form-options-status ${dropdownIssue ? 'is-invalid' : 'is-valid'}`} role="status">
                {dropdownIssue ?? `${draftDropdownOptions.length} unique ${draftDropdownOptions.length === 1 ? 'choice' : 'choices'} ready.`}
              </p>
              <label>Default choice
                <select
                  value={annotation.defaultOption}
                  onChange={(event) => update({ defaultOption: event.target.value })}
                >
                  <option value="">No default</option>
                  {Array.from(new Set(annotation.options.filter((option) => option.trim().length > 0))).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="created-form-field-toggle">
                <input
                  type="checkbox"
                  aria-label="Required field"
                  checked={annotation.required}
                  onChange={(event) => update({ required: event.target.checked })}
                />
                <span><strong>Required</strong><small>Require one listed choice in PDF readers.</small></span>
              </label>
            </>
          )}
          <p className="inspector-copy created-form-field-export-proof">
            The cobalt guide is editing-only. The saved PDF gets a real control that stays fillable after export.
          </p>
        </section>
      )}
      {annotation.kind === 'ink' && (
        <>
          <label>Color
            <input
              type="color" value={annotation.color}
              onChange={(event) => update({ color: event.target.value }, group('color'))}
              onBlur={endGroup}
            />
          </label>
          <label>Weight
            <input
              type="range" min="1" max="9" step="0.5" value={annotation.strokeWidth}
              onChange={(event) => update({ strokeWidth: Number(event.target.value) }, group('strokeWidth'))}
              onPointerUp={endGroup}
              onBlur={endGroup}
            />
          </label>
        </>
      )}
      {annotation.kind === 'shape' && (
        <>
          <label>Stroke
            <input type="color" value={annotation.strokeColor} onChange={(event) => update({ strokeColor: event.target.value }, group('strokeColor'))} onBlur={endGroup} />
          </label>
          {(annotation.shape === 'rectangle' || annotation.shape === 'ellipse') && (
            <label>Fill
              <input type="color" value={annotation.fillColor ?? '#ffffff'} onChange={(event) => update({ fillColor: event.target.value }, group('fillColor'))} onBlur={endGroup} />
            </label>
          )}
          <label>Weight
            <input type="range" min="1" max="10" step="0.5" value={annotation.strokeWidth} onChange={(event) => update({ strokeWidth: Number(event.target.value) }, group('strokeWidth'))} onPointerUp={endGroup} onBlur={endGroup} />
          </label>
        </>
      )}
      {annotation.kind === 'stamp' && (
        <>
          {annotation.stamp === 'date' && (
            <>
              <label className="date-calendar-field">Calendar date
                <input
                  type="date"
                  value={annotation.dateValue ?? ''}
                  onChange={(event) => {
                    const dateValue = event.target.value
                    if (!dateValue) {
                      update({ dateValue: undefined, dateFormat: 'custom' }, group('dateValue'))
                      return
                    }
                    const dateFormat: DatePresetFormat = annotation.dateFormat
                      && annotation.dateFormat !== 'custom'
                      ? annotation.dateFormat
                      : 'day-month'
                    const label = formatDateValue(dateValue, dateFormat)
                    if (label) update({ dateValue, dateFormat, label }, group('dateValue'))
                  }}
                  onBlur={endGroup}
                />
              </label>
              <fieldset className="date-format-picker">
                <legend>Printed date format</legend>
                {DATE_FORMATS.map((format) => {
                  const printed = annotation.dateValue
                    ? formatDateValue(annotation.dateValue, format.id)
                    : null
                  const sample = printed ?? formatDateValue('2026-08-30', format.id)
                  return (
                    <button
                      key={format.id}
                      type="button"
                      aria-label={`${format.label} date format`}
                      aria-pressed={annotation.dateFormat === format.id}
                      disabled={!printed}
                      onClick={() => {
                        if (printed) update({ label: printed, dateFormat: format.id })
                      }}
                    >
                      <span>{sample}</span>
                      <small>{format.label}</small>
                    </button>
                  )
                })}
              </fieldset>
              <label className="date-text-field">Date text
                <input
                  type="text"
                  maxLength={80}
                  value={annotation.label ?? ''}
                  onChange={(event) => update({ label: event.target.value, dateFormat: 'custom' }, group('label'))}
                  onBlur={endGroup}
                />
              </label>
              <p className="inspector-copy stamp-edit-hint">
                Choose a date and format, or type exactly what the PDF should print.
              </p>
            </>
          )}
          <label>Color
            <input type="color" value={annotation.color} onChange={(event) => update({ color: event.target.value }, group('color'))} onBlur={endGroup} />
          </label>
          {(annotation.stamp === 'check' || annotation.stamp === 'cross') && (
            <label>Weight
              <input
                type="range" min="1" max="9" step="0.5" value={annotation.strokeWidth}
                onChange={(event) => update({ strokeWidth: Number(event.target.value) }, group('strokeWidth'))}
                onPointerUp={endGroup}
                onBlur={endGroup}
              />
            </label>
          )}
        </>
      )}
      {annotation.kind === 'image' && (
        <section className="media-proofing" aria-label={annotation.role === 'signature' ? 'Visual signature adjustments' : 'Placed image adjustments'}>
          <div className="media-proofing-heading" aria-hidden="true">
            <span>{annotation.role === 'signature' ? 'S' : '▧'}</span>
            <strong>{annotation.role === 'signature' ? 'VISUAL SIGNATURE' : 'PLACED IMAGE'}</strong>
          </div>
          <p className="inspector-copy">
            {annotation.role === 'signature'
              ? 'Drag to move; resize with blue corners. Proportions stay locked. Choose Done.'
              : 'Drag to move; resize with blue corners. Proportions stay locked. Replace keeps placement.'}
          </p>
          <label>Opacity
            <input
              type="range" min="0.1" max="1" step="0.05" value={imageOpacityOf(annotation)}
              onChange={(event) => update({ opacity: Number(event.target.value) }, group('opacity'))}
              onPointerUp={endGroup}
              onBlur={endGroup}
            />
          </label>
          <div
            className="media-orientation-actions"
            role="group"
            aria-label={`${annotation.role === 'signature' ? 'Signature' : 'Image'} orientation`}
          >
            <button
              type="button"
              aria-label={`Turn ${annotation.role === 'signature' ? 'signature' : 'image'} left`}
              onClick={() => update({ rotation: normalizedRotation(annotation.rotation, -90) })}
            >
              <span aria-hidden="true">↶</span><small>Left</small>
            </button>
            <button
              type="button"
              aria-label={`Straighten ${annotation.role === 'signature' ? 'signature' : 'image'}`}
              disabled={normalizedRotation(annotation.rotation) === 0}
              onClick={() => update({ rotation: 0 })}
            >
              <span aria-hidden="true">0°</span><small>Straight</small>
            </button>
            <button
              type="button"
              aria-label={`Turn ${annotation.role === 'signature' ? 'signature' : 'image'} right`}
              onClick={() => update({ rotation: normalizedRotation(annotation.rotation, 90) })}
            >
              <span aria-hidden="true">↷</span><small>Right</small>
            </button>
          </div>
          {annotation.role !== 'signature' && onReplaceImage && (
            <>
              <button
                type="button"
                className="replace-image-button"
                disabled={replacingImage}
                onClick={() => replacementImageInputRef.current?.click()}
              >
                {replacingImage ? 'Replacing…' : 'Replace image'}
              </button>
              <input
                ref={replacementImageInputRef}
                className="visually-hidden"
                hidden
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Choose replacement image"
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  setReplacingImage(true)
                  void Promise.resolve(onReplaceImage(annotation, file))
                    .catch((error) => announce?.(error instanceof Error ? error.message : 'The image could not be replaced.'))
                    .finally(() => setReplacingImage(false))
                }}
              />
            </>
          )}
        </section>
      )}
      {annotation.kind === 'whiteout' && (
        <section className="whiteout-copy" aria-label="Whiteout safety">
          <p className="inspector-copy">
            <strong>Visual cover only.</strong> This covers content visually in the saved PDF.
            The original text or image remains underneath and may still be searchable, selectable, or recoverable.
            The faint editing outline is not saved. Use Redact when content must be removed permanently.
          </p>
          <button
            type="button"
            className="whiteout-replacement-button"
            onClick={() => {
              dispatch({
                type: 'addAnnotation',
                annotation: replacementTextForWhiteout(annotation, createAnnotationId()),
              })
              announce?.('Replacement text added. Type on the page, then press Enter.')
            }}
          >
            Add replacement text
          </button>
        </section>
      )}
      {annotation.kind === 'redaction' && (
        <p className="inspector-copy redaction-copy">
          On export, this page is converted to a picture with the covered area removed for good.
          The area is not recoverable from the exported file. Text on that page will no longer be selectable.
        </p>
      )}
      <div className="object-actions" aria-label="Object actions">
        <button type="button" onClick={() => {
          dispatch({ type: 'duplicateAnnotation', annotationId: annotation.id, newId: createAnnotationId() })
          announce?.(annotation.kind === 'form-field' && annotation.fieldType === 'radio'
            ? 'Added another choice to this radio group. Undo removes it.'
            : 'Duplicated item. Undo removes it.')
        }}>{annotation.kind === 'form-field' && annotation.fieldType === 'radio' ? 'Add another choice' : 'Duplicate'}</button>
        <button type="button" onClick={() => {
          dispatch({ type: 'copyAnnotation', annotationId: annotation.id })
          announce?.('Item copied. Paste creates an offset copy.')
        }}>Copy</button>
        <button type="button" disabled={!canPaste} onClick={() => {
          dispatch({ type: 'pasteAnnotation', pageId: annotation.pageId, newId: createAnnotationId() })
          announce?.('Pasted a new item. Undo removes it.')
        }}>Paste</button>
        <button type="button" onClick={() => dispatch({ type: 'bringForward', annotationId: annotation.id })}>Bring forward</button>
        <button type="button" onClick={() => dispatch({ type: 'sendBackward', annotationId: annotation.id })}>Send backward</button>
      </div>
      </div>
    </aside>
  )
}
