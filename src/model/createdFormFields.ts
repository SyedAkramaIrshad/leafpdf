import type {
  Annotation,
  CreatedFormFieldAnnotation,
  CreatedFormFieldType,
} from './editorCore'

export const CREATED_FORM_FIELD_NAME_MAX_LENGTH = 100
export const CREATED_FORM_OPTION_MAX_LENGTH = 200
export const CREATED_DROPDOWN_MAX_OPTIONS = 100

export function formFieldNamesConflict(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`)
}

function usedNames(annotations: readonly Annotation[], reservedNames: Iterable<string>): Set<string> {
  return new Set([
    ...annotations.flatMap((annotation) => annotation.kind === 'form-field' ? [annotation.fieldName] : []),
    ...reservedNames,
  ])
}

export function nextCreatedFormFieldName(
  fieldType: CreatedFormFieldType,
  annotations: readonly Annotation[],
  reservedNames: Iterable<string> = [],
): string {
  const names = usedNames(annotations, reservedNames)
  for (let index = 1; index <= annotations.length + names.size + 2; index += 1) {
    const candidate = `leafpdf.${fieldType}.${index}`
    if (!names.has(candidate)) return candidate
  }
  // The loop bound is deliberately generous, so this is reachable only if the
  // input changes while this synchronous function runs.
  throw new Error('A unique form field name could not be created.')
}

export function createdFormFieldNameIssue(
  fieldName: string,
  annotations: readonly Annotation[] = [],
  currentAnnotationId: string | null = null,
  reservedNames: Iterable<string> = [],
  fieldType?: CreatedFormFieldType,
): string | null {
  if (fieldName.trim().length === 0) return 'Enter a field name.'
  if (fieldName !== fieldName.trim()) return 'Remove spaces at the start or end.'
  if (fieldName.length > CREATED_FORM_FIELD_NAME_MAX_LENGTH) return 'Use 100 characters or fewer.'
  if (Array.from(fieldName).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })) return 'Remove control characters.'
  if (fieldName.split('.').some((part) => part.trim().length === 0)) {
    return 'Each name section between dots needs text.'
  }
  if (annotations.some((annotation) => {
    if (annotation.kind !== 'form-field' || annotation.id === currentAnnotationId) return false
    const sharedRadioGroup = annotation.fieldName === fieldName
      && annotation.fieldType === 'radio'
      && fieldType === 'radio'
    return !sharedRadioGroup && formFieldNamesConflict(annotation.fieldName, fieldName)
  })) {
    return 'Another created field already uses this name.'
  }
  if (Array.from(reservedNames).some((reserved) => formFieldNamesConflict(reserved, fieldName))) {
    return 'The source PDF already uses this field name.'
  }
  return null
}

function valueIssue(value: string, emptyMessage: string): string | null {
  if (value.trim().length === 0) return emptyMessage
  if (value !== value.trim()) return 'Remove spaces at the start or end.'
  if (value.length > CREATED_FORM_OPTION_MAX_LENGTH) return 'Use 200 characters or fewer.'
  if (Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })) return 'Remove control characters.'
  return null
}

export function nextRadioOptionValue(
  fieldName: string,
  annotations: readonly Annotation[],
): string {
  const groupValues = annotations.flatMap((annotation) =>
    annotation.kind === 'form-field'
      && annotation.fieldType === 'radio'
      && annotation.fieldName === fieldName
      ? [annotation.optionValue]
      : [])
  const values = new Set(groupValues)
  for (let index = groupValues.length + 1; index <= groupValues.length + annotations.length + 3; index += 1) {
    const candidate = `Option ${index}`
    if (!values.has(candidate)) return candidate
  }
  throw new Error('A unique radio option value could not be created.')
}

export function radioOptionValueIssue(
  optionValue: string,
  fieldName: string,
  annotations: readonly Annotation[] = [],
  currentAnnotationId: string | null = null,
): string | null {
  const basic = valueIssue(optionValue, 'Enter an option value.')
  if (basic) return basic
  if (annotations.some((annotation) =>
    annotation.kind === 'form-field'
      && annotation.fieldType === 'radio'
      && annotation.id !== currentAnnotationId
      && annotation.fieldName === fieldName
      && annotation.optionValue === optionValue)) {
    return 'Another choice in this group uses this value.'
  }
  return null
}

export function dropdownOptionsIssue(
  options: readonly string[],
  defaultOption: string,
): string | null {
  if (options.length === 0) return 'Add at least one choice.'
  if (options.length > CREATED_DROPDOWN_MAX_OPTIONS) return 'Use 100 choices or fewer.'
  if (options.some((option) => option.trim().length === 0)) return 'Remove blank choices.'
  if (options.some((option) => option !== option.trim())) {
    return 'Remove spaces at the start or end of each choice.'
  }
  if (options.some((option) => option.length > CREATED_FORM_OPTION_MAX_LENGTH)) {
    return 'Use 200 characters or fewer for each choice.'
  }
  if (options.some((option) => valueIssue(option, 'Remove blank choices.') !== null)) {
    return 'Remove control characters from choices.'
  }
  if (new Set(options).size !== options.length) return 'Every choice needs a unique value.'
  if (defaultOption !== '' && !options.includes(defaultOption)) {
    return 'Choose a default from the listed choices.'
  }
  return null
}

export function createdFormFieldCollectionIssue(
  fields: readonly CreatedFormFieldAnnotation[],
  reservedNames: Iterable<string> = [],
): string | null {
  const sourceNames = Array.from(reservedNames)
  for (const field of fields) {
    const basicNameIssue = createdFormFieldNameIssue(field.fieldName)
    if (basicNameIssue) return `Created field "${field.fieldName}" cannot be saved: ${basicNameIssue}`
    const sourceConflict = sourceNames.find((name) => formFieldNamesConflict(name, field.fieldName))
    if (sourceConflict) {
      return `Created field name "${field.fieldName}" conflicts with source field "${sourceConflict}".`
    }
  }

  for (let leftIndex = 0; leftIndex < fields.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < fields.length; rightIndex += 1) {
      const left = fields[leftIndex]
      const right = fields[rightIndex]
      if (!formFieldNamesConflict(left.fieldName, right.fieldName)) continue
      if (left.fieldName === right.fieldName
        && left.fieldType === 'radio'
        && right.fieldType === 'radio') continue
      if (left.fieldName === right.fieldName) {
        return `Created field name "${right.fieldName}" is shared by incompatible field types.`
      }
      return `Created field name "${right.fieldName}" conflicts with "${left.fieldName}".`
    }
  }

  const radioGroups = new Map<string, Array<Extract<CreatedFormFieldAnnotation, { fieldType: 'radio' }>>>()
  for (const field of fields) {
    if (field.fieldType === 'radio') {
      // Collection-level duplicate values are reported below with the group
      // name and repeated value. This pass validates only the choice itself.
      const issue = radioOptionValueIssue(field.optionValue, field.fieldName)
      if (issue) return `Radio group "${field.fieldName}" choice "${field.optionValue}": ${issue}`
      const group = radioGroups.get(field.fieldName) ?? []
      group.push(field)
      radioGroups.set(field.fieldName, group)
    } else if (field.fieldType === 'dropdown') {
      const issue = dropdownOptionsIssue(field.options, field.defaultOption)
      if (issue) return `Dropdown "${field.fieldName}": ${issue}`
    }
  }

  for (const [name, group] of radioGroups) {
    const values = new Set<string>()
    for (const choice of group) {
      if (values.has(choice.optionValue)) {
        return `Radio group "${name}" has more than one choice with value "${choice.optionValue}".`
      }
      values.add(choice.optionValue)
    }
    if (new Set(group.map(({ required }) => required)).size > 1) {
      return `Radio group "${name}" has inconsistent Required settings.`
    }
    if (group.filter(({ selectedByDefault }) => selectedByDefault).length > 1) {
      return `Radio group "${name}" has more than one default choice.`
    }
  }
  return null
}

interface CreateCreatedFormFieldInput {
  id: string
  pageId: string
  fieldType: CreatedFormFieldType
  x: number
  y: number
  width: number
  height: number
  annotations: readonly Annotation[]
  reservedNames?: Iterable<string>
}

export function createCreatedFormField({
  id,
  pageId,
  fieldType,
  x,
  y,
  width,
  height,
  annotations,
  reservedNames = [],
}: CreateCreatedFormFieldInput): CreatedFormFieldAnnotation {
  const base = {
    id,
    pageId,
    kind: 'form-field' as const,
    fieldType,
    fieldName: nextCreatedFormFieldName(fieldType, annotations, reservedNames),
    x,
    y,
    width,
    height,
    required: false,
  }
  if (fieldType === 'text') return { ...base, fieldType, defaultText: '', multiline: false }
  if (fieldType === 'checkbox') return { ...base, fieldType, checkedByDefault: false }
  if (fieldType === 'radio') {
    return { ...base, fieldType, optionValue: 'Option 1', selectedByDefault: false }
  }
  return { ...base, fieldType, options: ['Option 1', 'Option 2'], defaultOption: '' }
}
