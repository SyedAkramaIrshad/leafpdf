import { afterEach, describe, expect, it } from 'vitest'
import {
  imageOpacityOf,
  textMarkStrokeWidthOf,
  textMarkStyleOf,
  type EditorDocument,
  type HighlightAnnotation,
  type ImageAnnotation,
  type LinkAnnotation,
} from '../model/editor'
import { EMPTY_PERSONAL_DETAILS, type PersonalDetails } from '../model/personalDetails'
import {
  deletePersonalDetails,
  deleteSession,
  deleteSignature,
  loadPersonalDetails,
  loadSession,
  loadSignatures,
  resetLocalStoreForTests,
  savePersonalDetails,
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

  it('round-trips a visual whiteout with its exact geometry', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const document = makeDocument()
    document.annotations.push({
      id: 'whiteout-1', pageId: 'page-1', kind: 'whiteout', x: 0.12, y: 0.34,
      width: 0.45, height: 0.07, rotation: 3,
    })

    await saveSession(key, document)

    expect((await loadSession(key))?.annotations.at(-1)).toEqual({
      id: 'whiteout-1', pageId: 'page-1', kind: 'whiteout', x: 0.12, y: 0.34,
      width: 0.45, height: 0.07, rotation: 3,
    })
  })

  it('round-trips semantic text marks, defaults legacy highlights, and rejects malformed marks', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const document = makeDocument()
    const underline: HighlightAnnotation = {
      id: 'underline-1', pageId: 'page-1', kind: 'highlight', mark: 'underline',
      x: 0.12, y: 0.34, width: 0.45, height: 0.07,
      color: '#3157d5', opacity: 0.9, strokeWidth: 2.5,
    }
    document.annotations.push(underline)

    await saveSession(key, document)
    expect((await loadSession(key))?.annotations.at(-1)).toEqual(underline)

    const legacy: HighlightAnnotation = {
      id: 'legacy-highlight', pageId: 'page-1', kind: 'highlight',
      x: 0.1, y: 0.2, width: 0.3, height: 0.05,
      color: '#ffd447', opacity: 0.42,
    }
    expect(textMarkStyleOf(legacy)).toBe('highlight')
    expect(textMarkStrokeWidthOf(legacy)).toBe(2)

    for (const patch of [
      { mark: 'wavy' },
      { strokeWidth: 0 },
      { dashPattern: [1, 2] },
    ]) {
      const malformed = makeDocument() as EditorDocument & { annotations: Array<Record<string, unknown>> }
      malformed.annotations.push({ ...underline, ...patch })
      await expect(saveSession(`malformed-mark-${JSON.stringify(patch)}`, malformed as EditorDocument)).rejects.toThrow(/invalid/i)
    }
  })

  it('round-trips image opacity, defaults legacy images, and rejects malformed image proofing state', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const document = makeDocument()
    const image: ImageAnnotation = {
      id: 'image-1', pageId: 'page-1', kind: 'image', x: 0.12, y: 0.34,
      width: 0.45, height: 0.2, dataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png', role: 'image', opacity: 0.45,
    }
    document.annotations.push(image)

    await saveSession(key, document)
    expect((await loadSession(key))?.annotations.at(-1)).toEqual(image)

    const legacy: ImageAnnotation = { ...image, id: 'legacy-image' }
    delete legacy.opacity
    expect(imageOpacityOf(legacy)).toBe(1)

    for (const patch of [
      { opacity: 1.1 },
      { mimeType: 'image/jpeg' },
      { cropMode: 'cover' },
    ]) {
      const malformed = makeDocument() as EditorDocument & { annotations: Array<Record<string, unknown>> }
      malformed.annotations.push({ ...image, ...patch })
      await expect(saveSession(`malformed-image-${JSON.stringify(patch)}`, malformed as EditorDocument)).rejects.toThrow(/invalid/i)
    }
  })

  it('round-trips semantic and legacy dates and rejects malformed date metadata', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const document = makeDocument()
    document.annotations.push({
      id: 'date-1', pageId: 'page-1', kind: 'stamp', stamp: 'date',
      x: 0.2, y: 0.3, width: 0.22, height: 0.05,
      label: '30 Aug 2026', dateValue: '2026-08-30', dateFormat: 'day-month',
      color: '#182026', strokeWidth: 2.5,
    })
    document.annotations.push({
      id: 'legacy-date', pageId: 'page-1', kind: 'stamp', stamp: 'date',
      x: 0.2, y: 0.4, width: 0.22, height: 0.05,
      label: '30 August 2026', color: '#182026', strokeWidth: 2.5,
    })

    await saveSession(key, document)
    expect((await loadSession(key))?.annotations.slice(-2)).toEqual(document.annotations.slice(-2))

    for (const patch of [
      { dateValue: '2026-02-30' },
      { dateFormat: 'friendly' },
    ]) {
      const malformed = structuredClone(document) as EditorDocument & { annotations: Array<Record<string, unknown>> }
      Object.assign(malformed.annotations.at(-2)!, patch)
      await expect(saveSession(`malformed-date-${JSON.stringify(patch)}`, malformed as EditorDocument)).rejects.toThrow(/invalid/i)
    }

    const checkWithDate = makeDocument() as EditorDocument & { annotations: Array<Record<string, unknown>> }
    checkWithDate.annotations.push({
      id: 'check-1', pageId: 'page-1', kind: 'stamp', stamp: 'check',
      x: 0.2, y: 0.3, width: 0.05, height: 0.05,
      color: '#182026', strokeWidth: 2.5, dateValue: '2026-08-30', dateFormat: 'day-month',
    })
    await expect(saveSession('check-with-date', checkWithDate as EditorDocument)).rejects.toThrow(/invalid/i)
  })

  it('round-trips source-replacement text and rejects a malformed safety flag', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const document = makeDocument()
    document.annotations.push({
      id: 'replacement-1', pageId: 'page-1', kind: 'text', x: 0.12, y: 0.34,
      width: 0.45, height: 0.07, text: 'Syed Akrama', color: '#182026', fontSize: 12,
      sourceReplacement: true,
    })

    await saveSession(key, document)
    expect((await loadSession(key))?.annotations.at(-1)).toMatchObject({
      id: 'replacement-1', sourceReplacement: true,
    })

    const malformed = makeDocument() as EditorDocument & { annotations: Array<Record<string, unknown>> }
    malformed.annotations[0].sourceReplacement = 'yes'
    await expect(saveSession('malformed-source-replacement', malformed as EditorDocument)).rejects.toThrow(/invalid/i)
  })

  it('round-trips a clickable link draft with its exact destination and geometry', async () => {
    const key = sessionKey({ name: 'resume.pdf', size: 1234, lastModified: 99 } as File, 'pdf-id')
    const document = makeDocument()
    const link: LinkAnnotation = {
      id: 'link-1', pageId: 'page-1', kind: 'link', x: 0.12, y: 0.2,
      width: 0.44, height: 0.07, targetType: 'url', target: 'example.com/offer',
    }
    document.annotations.push(link)

    await saveSession(key, document)

    expect((await loadSession(key))?.annotations.at(-1)).toEqual(link)
  })

  it('rejects malformed or rotated link recovery records', async () => {
    const document = makeDocument()
    document.annotations.push({
      id: 'link-1', pageId: 'page-1', kind: 'link', x: 0.12, y: 0.2,
      width: 0.44, height: 0.07, rotation: 12, targetType: 'url', target: 'example.com',
    })

    await expect(saveSession('rotated-link', document)).rejects.toThrow(/invalid/i)
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

  it('persists only an explicit valid personal profile and returns a clone', async () => {
    expect(await loadPersonalDetails()).toBeNull()
    const details: PersonalDetails = {
      fullName: '  Syed Akrama Irshad  ',
      email: ' syed@example.com ',
      phone: '',
      company: ' LeafPDF ',
      address: ' 42 Paper Street\nBengaluru ',
    }

    await savePersonalDetails(details)
    const saved = await loadPersonalDetails()
    expect(saved).toEqual({
      fullName: 'Syed Akrama Irshad',
      email: 'syed@example.com',
      phone: '',
      company: 'LeafPDF',
      address: '42 Paper Street\nBengaluru',
    })
    if (!saved) throw new Error('Expected saved personal details')
    saved.fullName = 'Mutated after load'
    expect((await loadPersonalDetails())?.fullName).toBe('Syed Akrama Irshad')

    await deletePersonalDetails()
    expect(await loadPersonalDetails()).toBeNull()
  })

  it('rejects empty and malformed personal profiles', async () => {
    await expect(savePersonalDetails(EMPTY_PERSONAL_DETAILS)).rejects.toThrow(/at least one detail/i)
    await expect(savePersonalDetails({
      ...EMPTY_PERSONAL_DETAILS,
      fullName: 'n'.repeat(161),
    })).rejects.toThrow(/valid personal details/i)
    await expect(savePersonalDetails({
      ...EMPTY_PERSONAL_DETAILS,
      fullName: 'Syed',
      nickname: 'Akrama',
    } as unknown as PersonalDetails)).rejects.toThrow(/valid personal details/i)
    await expect(savePersonalDetails({
      ...EMPTY_PERSONAL_DETAILS,
      phone: 42,
    } as unknown as PersonalDetails)).rejects.toThrow(/valid personal details/i)
  })

  it('upgrades a version-one database without losing saved signatures', async () => {
    const legacyDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('leafpdf-local-store', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('signatures', { keyPath: 'id' })
        request.result.createObjectStore('sessions', { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = legacyDatabase.transaction('signatures', 'readwrite')
      transaction.objectStore('signatures').put({
        id: 'legacy-signature',
        name: 'Legacy',
        dataUrl: 'data:image/png;base64,c2ln',
        createdAt: 1,
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
    legacyDatabase.close()

    await savePersonalDetails({ ...EMPTY_PERSONAL_DETAILS, fullName: 'Syed' })

    expect(await loadSignatures()).toEqual([{
      id: 'legacy-signature', name: 'Legacy', dataUrl: 'data:image/png;base64,c2ln', createdAt: 1,
    }])
    expect(await loadPersonalDetails()).toEqual({ ...EMPTY_PERSONAL_DETAILS, fullName: 'Syed' })
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
