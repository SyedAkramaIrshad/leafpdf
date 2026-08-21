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
      annotations: [],
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
