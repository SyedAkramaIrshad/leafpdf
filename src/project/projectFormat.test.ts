import { describe, expect, it } from 'vitest'
import type { CreatedFormFieldAnnotation, EditorDocument, HighlightAnnotation, ImageAnnotation, LinkAnnotation } from '../model/editor'
import { LINK_TARGET_MAX_LENGTH } from '../model/linkTarget'
import { createLeafProject, openLeafProject, projectFileName, serializeLeafProject } from './projectFormat'

function pdfFile(name: string, marker: string): File {
  return new File([`%PDF-1.4\n% ${marker}\n%%EOF`], name, {
    type: 'application/pdf',
    lastModified: 1234,
  })
}

function document(): EditorDocument {
  return {
    fileName: 'primary.pdf',
    pages: [
      { id: 'page-1', kind: 'original', sourceIndex: 0, rotation: 0 },
      { id: 'page-external', kind: 'external', documentId: 'inserted-1', sourceIndex: 0, rotation: 90 },
      { id: 'page-blank', kind: 'blank', width: 595, height: 842, rotation: 0 },
    ],
    annotations: [
      {
        id: 'annotation-1', pageId: 'page-external', kind: 'text', x: 0.1, y: 0.2,
        width: 0.3, height: 0.08, text: 'Still editable', color: '#182026', fontSize: 14,
        sourceReplacement: true,
      },
      {
        id: 'link-1', pageId: 'page-1', kind: 'link', x: 0.12, y: 0.2,
        width: 0.44, height: 0.07, targetType: 'url', target: 'example.com/offer',
      } satisfies LinkAnnotation,
      {
        id: 'date-1', pageId: 'page-1', kind: 'stamp', stamp: 'date',
        x: 0.2, y: 0.3, width: 0.22, height: 0.05,
        label: '30 Aug 2026', dateValue: '2026-08-30', dateFormat: 'day-month',
        color: '#182026', strokeWidth: 2.5,
      },
      {
        id: 'underline-1', pageId: 'page-1', kind: 'highlight', mark: 'underline',
        x: 0.12, y: 0.36, width: 0.44, height: 0.06,
        color: '#3157d5', opacity: 1, strokeWidth: 2.5,
      } satisfies HighlightAnnotation,
      {
        id: 'image-1', pageId: 'page-blank', kind: 'image', role: 'image',
        x: 0.12, y: 0.36, width: 0.44, height: 0.22,
        dataUrl: 'data:image/png;base64,AAAA', mimeType: 'image/png', opacity: 0.45,
      } satisfies ImageAnnotation,
      {
        id: 'created-text-1', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
        fieldName: 'leafpdf.text.1', x: 0.18, y: 0.42, width: 0.48, height: 0.07,
        required: true, defaultText: 'Your name', multiline: false,
      } satisfies CreatedFormFieldAnnotation,
      {
        id: 'created-checkbox-1', pageId: 'page-blank', kind: 'form-field', fieldType: 'checkbox',
        fieldName: 'leafpdf.checkbox.1', x: 0.18, y: 0.55, width: 0.05, height: 0.05,
        required: false, checkedByDefault: true,
      } satisfies CreatedFormFieldAnnotation,
      {
        id: 'created-radio-yes', pageId: 'page-1', kind: 'form-field', fieldType: 'radio',
        fieldName: 'relocation', optionValue: 'Yes', selectedByDefault: true,
        x: 0.18, y: 0.64, width: 0.05, height: 0.05, required: true,
      } satisfies CreatedFormFieldAnnotation,
      {
        id: 'created-radio-no', pageId: 'page-1', kind: 'form-field', fieldType: 'radio',
        fieldName: 'relocation', optionValue: 'No', selectedByDefault: false,
        x: 0.34, y: 0.64, width: 0.05, height: 0.05, required: true,
      } satisfies CreatedFormFieldAnnotation,
      {
        id: 'created-dropdown-1', pageId: 'page-blank', kind: 'form-field', fieldType: 'dropdown',
        fieldName: 'office.location', options: ['Dubai', 'Abu Dhabi', 'Bengaluru'], defaultOption: 'Dubai',
        x: 0.18, y: 0.72, width: 0.32, height: 0.06, required: false,
      } satisfies CreatedFormFieldAnnotation,
    ],
    formValues: { owner: 'Syed' },
  }
}

describe('LeafPDF project format', () => {
  it('round-trips every PDF source and editable project field', async () => {
    const project = await createLeafProject({
      primaryFile: pdfFile('primary.pdf', 'primary'),
      insertedFiles: [{ id: 'inserted-1', file: pdfFile('inserted.pdf', 'inserted') }],
      document: document(),
      comments: [{
        id: 'comment-1', pageId: 'page-external', x: 0.4, y: 0.5,
        body: 'Check this section', author: 'Reviewer', createdAt: 10, updatedAt: 11, resolved: false,
      }],
      ocr: [{
        pageId: 'page-1', language: 'en', provider: 'text-detector', createdAt: 12,
        words: [{ text: 'LeafPDF', confidence: 0.99, x: 0.1, y: 0.1, width: 0.2, height: 0.04 }],
      }],
      createdAt: 1,
    })

    const opened = await openLeafProject(serializeLeafProject(project))

    expect(opened.primaryFile.name).toBe('primary.pdf')
    expect(await opened.primaryFile.text()).toContain('primary')
    expect(opened.insertedFiles.get('inserted-1')?.name).toBe('inserted.pdf')
    expect(await opened.insertedFiles.get('inserted-1')?.text()).toContain('inserted')
    expect(opened.project.document).toEqual(document())
    expect(opened.project.comments[0]).toMatchObject({ body: 'Check this section', resolved: false })
    expect(opened.project.ocr[0].words[0].text).toBe('LeafPDF')
  })

  it('rejects a source whose bytes no longer match its recorded hash', async () => {
    const project = await createLeafProject({
      primaryFile: pdfFile('primary.pdf', 'primary'),
      insertedFiles: [],
      document: {
        fileName: 'primary.pdf',
        pages: [{ id: 'page-1', kind: 'original', sourceIndex: 0, rotation: 0 }],
        annotations: [],
        formValues: {},
      },
    })
    const parsed = JSON.parse(await serializeLeafProject(project).text())
    const data: string = parsed.sources[0].data
    parsed.sources[0].data = `${data[0] === 'A' ? 'B' : 'A'}${data.slice(1)}`

    await expect(openLeafProject(JSON.stringify(parsed))).rejects.toThrow(/integrity check|not a PDF/)
  })

  it('rejects a project that references an omitted inserted PDF', async () => {
    const project = await createLeafProject({
      primaryFile: pdfFile('primary.pdf', 'primary'),
      insertedFiles: [{ id: 'inserted-1', file: pdfFile('inserted.pdf', 'inserted') }],
      document: document(),
    })
    project.sources = project.sources.filter((source) => source.id !== 'inserted-1')

    await expect(openLeafProject(serializeLeafProject(project))).rejects.toThrow(/inserted PDF source/i)
  })

  it('rejects malformed link fields while preserving incomplete editable drafts', async () => {
    const makeProject = () => createLeafProject({
      primaryFile: pdfFile('primary.pdf', 'primary'),
      insertedFiles: [{ id: 'inserted-1', file: pdfFile('inserted.pdf', 'inserted') }],
      document: document(),
    })

    const incomplete = await makeProject()
    const draft = incomplete.document.annotations.find((annotation) => annotation.kind === 'link')
    if (!draft || draft.kind !== 'link') throw new Error('Expected link draft')
    draft.target = ''
    await expect(openLeafProject(serializeLeafProject(incomplete))).resolves.toBeDefined()

    const malformedCases: Array<Record<string, unknown>> = [
      { targetType: 'script' },
      { target: 42 },
      { target: 'x'.repeat(LINK_TARGET_MAX_LENGTH + 1) },
      { rotation: 15 },
      { unexpected: true },
    ]
    for (const patch of malformedCases) {
      const project = await makeProject()
      const parsed = JSON.parse(await serializeLeafProject(project).text())
      const link = parsed.document.annotations.find((annotation: { kind?: string }) => annotation.kind === 'link')
      Object.assign(link, patch)
      await expect(openLeafProject(JSON.stringify(parsed))).rejects.toThrow(/link/i)
    }
  })

  it('rejects malformed date metadata while preserving legacy dates', async () => {
    const makeProject = () => createLeafProject({
      primaryFile: pdfFile('primary.pdf', 'primary'),
      insertedFiles: [{ id: 'inserted-1', file: pdfFile('inserted.pdf', 'inserted') }],
      document: document(),
    })

    const legacy = await makeProject()
    const legacyDate = legacy.document.annotations.find((annotation) => annotation.kind === 'stamp')
    if (!legacyDate || legacyDate.kind !== 'stamp') throw new Error('Expected date stamp')
    delete legacyDate.dateValue
    delete legacyDate.dateFormat
    await expect(openLeafProject(serializeLeafProject(legacy))).resolves.toBeDefined()

    for (const patch of [
      { dateValue: '2026-02-30' },
      { dateFormat: 'friendly' },
      { stamp: 'check', dateValue: '2026-08-30', dateFormat: 'day-month' },
    ]) {
      const malformed = await makeProject()
      const parsed = JSON.parse(await serializeLeafProject(malformed).text())
      const date = parsed.document.annotations.find((annotation: { kind?: string }) => annotation.kind === 'stamp')
      if (!date) throw new Error('Expected date stamp')
      Object.assign(date, patch)
      await expect(openLeafProject(JSON.stringify(parsed))).rejects.toThrow(/date|stamp/i)
    }
  })

  it('rejects malformed text marks while preserving legacy highlights', async () => {
    const makeProject = () => createLeafProject({
      primaryFile: pdfFile('primary.pdf', 'primary'),
      insertedFiles: [{ id: 'inserted-1', file: pdfFile('inserted.pdf', 'inserted') }],
      document: document(),
    })

    const legacy = await makeProject()
    const legacyHighlight = legacy.document.annotations.find((annotation) => annotation.id === 'underline-1')
    if (!legacyHighlight || legacyHighlight.kind !== 'highlight') throw new Error('Expected text mark')
    delete legacyHighlight.mark
    delete legacyHighlight.strokeWidth
    await expect(openLeafProject(serializeLeafProject(legacy))).resolves.toBeDefined()

    for (const patch of [
      { mark: 'wavy' },
      { strokeWidth: 0 },
      { opacity: 2 },
      { unexpected: true },
    ]) {
      const malformed = await makeProject()
      const parsed = JSON.parse(await serializeLeafProject(malformed).text())
      const textMark = parsed.document.annotations.find((annotation: { id?: string }) => annotation.id === 'underline-1')
      if (!textMark) throw new Error('Expected text mark')
      Object.assign(textMark, patch)
      await expect(openLeafProject(JSON.stringify(parsed))).rejects.toThrow(/text mark/i)
    }
  })

  it('rejects malformed image proofing state while preserving legacy images', async () => {
    const makeProject = () => createLeafProject({
      primaryFile: pdfFile('primary.pdf', 'primary'),
      insertedFiles: [{ id: 'inserted-1', file: pdfFile('inserted.pdf', 'inserted') }],
      document: document(),
    })

    const legacy = await makeProject()
    const legacyImage = legacy.document.annotations.find((annotation) => annotation.id === 'image-1')
    if (!legacyImage || legacyImage.kind !== 'image') throw new Error('Expected placed image')
    delete legacyImage.opacity
    await expect(openLeafProject(serializeLeafProject(legacy))).resolves.toBeDefined()

    for (const patch of [
      { opacity: 1.1 },
      { mimeType: 'image/jpeg' },
      { role: 'background' },
      { cropMode: 'cover' },
    ]) {
      const malformed = await makeProject()
      const parsed = JSON.parse(await serializeLeafProject(malformed).text())
      const image = parsed.document.annotations.find((annotation: { id?: string }) => annotation.id === 'image-1')
      if (!image) throw new Error('Expected placed image')
      Object.assign(image, patch)
      await expect(openLeafProject(JSON.stringify(parsed))).rejects.toThrow(/image/i)
    }
  })

  it('rejects malformed or duplicate created form fields', async () => {
    const makeProject = () => createLeafProject({
      primaryFile: pdfFile('primary.pdf', 'primary'),
      insertedFiles: [{ id: 'inserted-1', file: pdfFile('inserted.pdf', 'inserted') }],
      document: document(),
    })

    const malformedCases: Array<Record<string, unknown>> = [
      { fieldType: 'button' },
      { fieldName: '' },
      { fieldName: 'owner..name' },
      { required: 'yes' },
      { rotation: 10 },
      { multiline: 'yes' },
      { checkedByDefault: true },
      { unexpected: true },
    ]
    for (const patch of malformedCases) {
      const project = await makeProject()
      const parsed = JSON.parse(await serializeLeafProject(project).text())
      const field = parsed.document.annotations.find((annotation: { id?: string }) => annotation.id === 'created-text-1')
      Object.assign(field, patch)
      await expect(openLeafProject(JSON.stringify(parsed))).rejects.toThrow(/form field|field name/i)
    }

    const duplicate = await makeProject()
    const duplicateParsed = JSON.parse(await serializeLeafProject(duplicate).text())
    const checkbox = duplicateParsed.document.annotations.find((annotation: { id?: string }) => annotation.id === 'created-checkbox-1')
    checkbox.fieldName = 'leafpdf.text.1'
    await expect(openLeafProject(JSON.stringify(duplicateParsed))).rejects.toThrow(/form field|incompatible/i)
  })

  it('rejects malformed radio groups and dropdown choices', async () => {
    type ParsedProject = { document: { annotations: Array<Record<string, unknown>> } }
    const annotation = (parsed: ParsedProject, id: string) => {
      const match = parsed.document.annotations.find((item) => item.id === id)
      if (!match) throw new Error(`Missing test annotation ${id}`)
      return match
    }
    const serialized = async () => {
      const project = await createLeafProject({
        primaryFile: pdfFile('primary.pdf', 'primary'),
        insertedFiles: [{ id: 'inserted-1', file: pdfFile('inserted.pdf', 'inserted') }],
        document: document(),
      })
      return JSON.parse(await serializeLeafProject(project).text()) as ParsedProject
    }

    const mutations: Array<(parsed: ParsedProject) => void> = [
      (parsed) => { annotation(parsed, 'created-radio-yes').optionValue = '' },
      (parsed) => { annotation(parsed, 'created-radio-yes').selectedByDefault = 'yes' },
      (parsed) => { annotation(parsed, 'created-radio-no').optionValue = 'Yes' },
      (parsed) => { annotation(parsed, 'created-radio-no').selectedByDefault = true },
      (parsed) => { annotation(parsed, 'created-radio-no').required = false },
      (parsed) => { annotation(parsed, 'created-radio-no').unexpected = true },
      (parsed) => { annotation(parsed, 'created-dropdown-1').options = [] },
      (parsed) => { annotation(parsed, 'created-dropdown-1').options = ['Dubai', 'Dubai'] },
      (parsed) => { annotation(parsed, 'created-dropdown-1').defaultOption = 'London' },
      (parsed) => { annotation(parsed, 'created-dropdown-1').fieldName = 'relocation' },
      (parsed) => { annotation(parsed, 'created-dropdown-1').unexpected = true },
    ]

    for (const mutate of mutations) {
      const parsed = await serialized()
      mutate(parsed)
      await expect(openLeafProject(JSON.stringify(parsed))).rejects.toThrow(/form field|radio group|radio choice|dropdown|incompatible/i)
    }
  })

  it('uses the source stem for the portable project name', () => {
    expect(projectFileName('contract.final.pdf')).toBe('contract.final.leafpdf')
    expect(projectFileName('document')).toBe('document.leafpdf')
  })
})
