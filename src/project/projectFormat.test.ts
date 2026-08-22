import { describe, expect, it } from 'vitest'
import type { EditorDocument } from '../model/editor'
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
      },
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

  it('uses the source stem for the portable project name', () => {
    expect(projectFileName('contract.final.pdf')).toBe('contract.final.leafpdf')
    expect(projectFileName('document')).toBe('document.leafpdf')
  })
})
