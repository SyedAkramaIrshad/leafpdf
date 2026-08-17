import { afterEach, describe, expect, it } from 'vitest'
import type { EditorDocument } from '../model/editor'
import {
  deleteSession,
  deleteSignature,
  loadSession,
  loadSignatures,
  resetLocalStoreForTests,
  saveSession,
  saveSignature,
  sessionKey,
} from './localStore'

function makeDocument(): EditorDocument {
  return {
  fileName: 'resume.pdf',
  pages: [{ id: 'page-1', kind: 'original', sourceIndex: 0, rotation: 0 }],
  annotations: [{
    id: 'note-1', pageId: 'page-1', kind: 'text', x: 0.1, y: 0.2,
    width: 0.3, height: 0.1, text: 'Private note', color: '#111111', fontSize: 12,
  }],
  formValues: { 'owner.name': 'Syed', 'subscribe': true },
  }
}

afterEach(async () => {
  await resetLocalStoreForTests()
})

describe('local browser persistence', () => {
  it('creates a deterministic recovery key bound to the PDF fingerprint', () => {
    const file = { name: 'resume.pdf', size: 1234, lastModified: 99 } as File
    expect(sessionKey(file, 'pdf-id-a')).toBe(sessionKey(file, 'pdf-id-a'))
    expect(sessionKey(file, 'pdf-id-a')).not.toBe(sessionKey(file, 'pdf-id-b'))
    expect(sessionKey(file, 'pdf-id-a')).not.toBe(sessionKey({ ...file, size: 1235 } as File, 'pdf-id-a'))
  })

  it('round-trips sessions without storing or leaking a mutable document reference', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const document = makeDocument()
    await saveSession(key, document)
    const original = document.annotations[0]
    if (original.kind !== 'text') throw new Error('Expected text annotation')
    original.text = 'Changed after save'

    const recovered = await loadSession(key)
    expect(recovered?.annotations[0]).toMatchObject({ text: 'Private note' })
    if (!recovered || recovered.annotations[0].kind !== 'text') throw new Error('Expected text annotation')
    recovered.annotations[0].text = 'Changed after load'
    expect((await loadSession(key))?.annotations[0]).toMatchObject({ text: 'Private note' })

    await deleteSession(key)
    expect(await loadSession(key)).toBeNull()
  })

  it('rejects malformed recovery documents rather than persisting them', async () => {
    const key = 'broken-record'
    await expect(saveSession(key, { ...makeDocument(), pages: [] } as EditorDocument)).rejects.toThrow(/invalid/i)
    expect(await loadSession(key)).toBeNull()
  })

  it('stores blank pages but strips inserted-PDF pages and their annotations', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const document = makeDocument()
    document.pages = [
      ...document.pages,
      { id: 'page-blank', kind: 'blank', width: 595, height: 842, rotation: 0 },
      { id: 'page-ext', kind: 'external', documentId: 'inserted-1', sourceIndex: 0, rotation: 0 },
    ]
    document.annotations = [
      ...document.annotations,
      {
        id: 'on-blank', pageId: 'page-blank', kind: 'text', x: 0.1, y: 0.1,
        width: 0.3, height: 0.1, text: 'Stays', color: '#111111', fontSize: 12,
      },
      {
        id: 'on-external', pageId: 'page-ext', kind: 'text', x: 0.1, y: 0.1,
        width: 0.3, height: 0.1, text: 'Cannot be restored', color: '#111111', fontSize: 12,
      },
    ]
    await saveSession(key, document)
    const recovered = await loadSession(key)
    expect(recovered?.pages.map(({ id }) => id)).toEqual(['page-1', 'page-blank'])
    expect(recovered?.annotations.map(({ id }) => id)).toEqual(['note-1', 'on-blank'])
  })

  it('restores records saved before pages carried an explicit kind', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const legacy = makeDocument()
    // Simulate an old record: no `kind` on the page, no formValues field.
    ;(legacy.pages[0] as { kind?: string }).kind = undefined
    delete (legacy.pages[0] as { kind?: string }).kind
    delete (legacy as { formValues?: unknown }).formValues
    await saveSession(key, legacy)
    const recovered = await loadSession(key)
    expect(recovered?.pages[0]).toEqual({ id: 'page-1', kind: 'original', sourceIndex: 0, rotation: 0 })
    expect(recovered?.formValues).toEqual({})
  })

  it('keeps only valid reusable PNG signatures and returns cloned entries', async () => {
    await saveSignature({
      id: 'signature-1', name: 'Syed', dataUrl: 'data:image/png;base64,c2ln', createdAt: 42,
    })
    const signatures = await loadSignatures()
    expect(signatures).toEqual([{ id: 'signature-1', name: 'Syed', dataUrl: 'data:image/png;base64,c2ln', createdAt: 42 }])
    signatures[0].name = 'Mutated'
    expect((await loadSignatures())[0].name).toBe('Syed')

    await expect(saveSignature({
      id: 'bad', name: 'Bad', dataUrl: 'data:image/jpeg;base64,c2ln', createdAt: 43,
    })).rejects.toThrow(/PNG/i)
    await deleteSignature('signature-1')
    expect(await loadSignatures()).toEqual([])
  })

  it('reports unavailable durable storage instead of pretending memory is recovery', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined })
    try {
      await expect(saveSession('unavailable', makeDocument())).rejects.toThrow(/storage is unavailable/i)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor)
    }
  })
})
