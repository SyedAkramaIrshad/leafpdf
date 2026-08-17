import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createEditorState, editorReducer, type EditorState } from '../model/editor'
import { exportEditedPdf } from './exportPdf'

/**
 * Exports the generated fixtures and writes the results to `output/pdf/`, so
 * `scripts/verify_export.py` can check them structurally and render every page.
 * These cover real third-party PDFs (ReportLab and pypdf output) rather than
 * documents built by pdf-lib inside a test.
 *
 * Generate the fixtures with `scripts/create-edge-fixtures.py`; absent fixtures
 * skip rather than fail.
 */
const FIXTURE_DIR = 'tmp/pdfs'
const OUTPUT_DIR = 'output/pdf'
const fixturesPresent = existsSync(`${FIXTURE_DIR}/edge-orientation.pdf`)
const encryptedPresent = existsSync(`${FIXTURE_DIR}/edge-encrypted.pdf`)

function fixtureBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${FIXTURE_DIR}/${name}`))
}

function writeArtifact(name: string, bytes: Uint8Array): void {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(`${OUTPUT_DIR}/${name}`, bytes)
}

function annotateEveryPage(state: EditorState, label: string): EditorState {
  let next = state
  for (const [index, page] of state.present.pages.entries()) {
    next = editorReducer(next, {
      type: 'addAnnotation',
      annotation: {
        id: `anchor-${index}`, pageId: page.id, kind: 'text',
        // The same normalized anchor on every page, so a rotation error shows up as
        // a displaced or rotated label in the rendered PNG.
        x: 0.1, y: 0.1, width: 0.6, height: 0.06,
        text: `${label} p${index + 1}`, color: '#c5462f', fontSize: 16,
      },
    })
  }
  return next
}

describe.skipIf(!fixturesPresent)('export against generated fixtures', () => {
  it('keeps every /Rotate value and anchors an annotation on each page', async () => {
    const bytes = fixtureBytes('edge-orientation.pdf')
    const sourceRotations = (await PDFDocument.load(bytes)).getPages().map((page) => page.getRotation().angle)
    expect(sourceRotations).toEqual([0, 90, 180, 270, 0])

    const state = annotateEveryPage(createEditorState('edge-orientation.pdf', 5), 'ANCHOR')
    const output = await exportEditedPdf(bytes, state.present)
    writeArtifact('edge-orientation-edited.pdf', output)

    const reopened = await PDFDocument.load(output)
    expect(reopened.getPageCount()).toBe(5)
    // Rotation must survive untouched: annotations are placed in display space.
    expect(reopened.getPages().map((page) => page.getRotation().angle)).toEqual(sourceRotations)
  })

  it('preserves bookmarks, attachments, and form fields on an annotate-only export', async () => {
    for (const name of ['edge-outlines.pdf', 'edge-attachment.pdf', 'edge-form.pdf'] as const) {
      const bytes = fixtureBytes(name)
      const state = annotateEveryPage(createEditorState(name, 2), 'NOTE')
      const output = await exportEditedPdf(bytes, state.present)
      writeArtifact(name.replace('.pdf', '-edited.pdf'), output)

      const reopened = await PDFDocument.load(output)
      expect(reopened.getPageCount()).toBe(2)
      expect(reopened.getTitle()).toBe('Preserve me')
    }
  })

  it('refuses to reorder a fixture with bookmarks until a copy is accepted', async () => {
    const bytes = fixtureBytes('edge-outlines.pdf')
    let state = createEditorState('edge-outlines.pdf', 2)
    state = editorReducer(state, { type: 'movePage', pageId: 'page-2', direction: -1 })

    await expect(exportEditedPdf(bytes, state.present)).rejects.toThrow(/compatibility/i)
    const accepted = await exportEditedPdf(bytes, state.present, { allowCompatibilityCopy: true })
    expect((await PDFDocument.load(accepted)).getTitle()).toBe('Preserve me')
  })

  it('exports a page whose only text is whitespace', async () => {
    const bytes = fixtureBytes('edge-whitespace-text.pdf')
    const state = annotateEveryPage(createEditorState('edge-whitespace-text.pdf', 1), 'BLANK')
    const output = await exportEditedPdf(bytes, state.present)
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1)
  })

  it.skipIf(!encryptedPresent)('refuses an encrypted document with a human explanation', async () => {
    const bytes = fixtureBytes('edge-encrypted.pdf')
    const state = annotateEveryPage(createEditorState('edge-encrypted.pdf', 2), 'NOTE')
    await expect(exportEditedPdf(bytes, state.present)).rejects.toThrow(/encrypted/)
    // The refusal is a clear sentence, never pdf-lib's internal API hint.
    await expect(exportEditedPdf(bytes, state.present)).rejects.not.toThrow(/ignoreEncryption/)
  })
})
