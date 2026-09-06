import { afterEach, describe, expect, it } from 'vitest'
import type { LeafProject } from './projectTypes'
import {
  deleteProjectRecovery,
  loadProjectRecovery,
  projectRecoveryKey,
  resetProjectRecoveryForTests,
  saveProjectRecovery,
} from './projectRecovery'

function project(): LeafProject {
  return {
    format: 'leafpdf-project',
    version: 1,
    createdAt: 1,
    updatedAt: 2,
    primarySourceId: 'primary',
    sources: [{
      id: 'primary', name: 'source.pdf', mimeType: 'application/pdf', size: 14,
      lastModified: 10, sha256: '0'.repeat(64), data: 'JVBERi0xLjQKJSVFT0Y=',
    }],
    document: {
      fileName: 'source.pdf',
      pages: [{ id: 'page-1', kind: 'original', sourceIndex: 0, rotation: 0 }],
      annotations: [
        {
          id: 'created-field-1', pageId: 'page-1', kind: 'form-field', fieldType: 'text',
          fieldName: 'leafpdf.text.1', x: 0.1, y: 0.2, width: 0.4, height: 0.06,
          required: false, defaultText: 'Editable after recovery', multiline: false,
        },
        {
          id: 'created-radio-yes', pageId: 'page-1', kind: 'form-field', fieldType: 'radio',
          fieldName: 'relocation', optionValue: 'Yes', selectedByDefault: true,
          x: 0.1, y: 0.3, width: 0.05, height: 0.05, required: true,
        },
        {
          id: 'created-radio-no', pageId: 'page-1', kind: 'form-field', fieldType: 'radio',
          fieldName: 'relocation', optionValue: 'No', selectedByDefault: false,
          x: 0.2, y: 0.3, width: 0.05, height: 0.05, required: true,
        },
        {
          id: 'created-dropdown', pageId: 'page-1', kind: 'form-field', fieldType: 'dropdown',
          fieldName: 'office.location', options: ['Dubai', 'Abu Dhabi'], defaultOption: 'Dubai',
          x: 0.1, y: 0.4, width: 0.3, height: 0.06, required: false,
        },
      ],
      formValues: {},
    },
    comments: [],
    ocr: [],
  }
}

afterEach(async () => {
  await resetProjectRecoveryForTests()
})

describe('project recovery', () => {
  it('stores and restores the exact portable project representation', async () => {
    const key = projectRecoveryKey(
      new File(['pdf'], 'source.pdf', { lastModified: 10 }),
      'fingerprint-1',
    )
    const saved = project()
    await saveProjectRecovery(key, saved)
    saved.document.fileName = 'mutated-after-save.pdf'

    const recovered = await loadProjectRecovery(key)
    expect(recovered).toEqual(project())
    expect(recovered?.document.annotations[0]).toMatchObject({
      kind: 'form-field', fieldName: 'leafpdf.text.1', defaultText: 'Editable after recovery',
    })
    expect(recovered?.document.annotations.slice(1)).toEqual(project().document.annotations.slice(1))

    recovered!.comments.push({
      id: 'comment', pageId: 'page-1', x: 0.1, y: 0.1, body: 'Review', author: '',
      createdAt: 1, updatedAt: 1, resolved: false,
    })
    expect((await loadProjectRecovery(key))?.comments).toEqual([])
  })

  it('deletes a recovery project explicitly', async () => {
    const key = 'project-key'
    await saveProjectRecovery(key, project())
    await deleteProjectRecovery(key)
    expect(await loadProjectRecovery(key)).toBeNull()
  })

  it('keys recovery by source metadata and PDF fingerprint', () => {
    const file = new File(['pdf'], 'same.pdf', { lastModified: 10 })
    expect(projectRecoveryKey(file, 'one')).not.toBe(projectRecoveryKey(file, 'two'))
  })
})
