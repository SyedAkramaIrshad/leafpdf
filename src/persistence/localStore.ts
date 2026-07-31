import type { Annotation, EditorDocument, EditorPage } from '../model/editor'

/** A user-approved signature bitmap retained only in this browser. */
export interface SavedSignature {
  id: string
  name: string
  /** Normalized by the UI to a PNG before it is allowed into this store. */
  dataUrl: string
  createdAt: number
}

const DATABASE_NAME = 'leafpdf-local-store'
const DATABASE_VERSION = 1
const SIGNATURES_STORE = 'signatures'
const SESSIONS_STORE = 'sessions'
const unavailable = Symbol('indexeddb-unavailable')

type MaybeDatabaseValue = unknown | typeof unavailable

/**
 * Identifies a recovery document from its metadata and PDF.js document
 * fingerprint. The PDF bytes are deliberately never persisted by LeafPDF.
 */
export function sessionKey(
  file: Pick<File, 'name' | 'size' | 'lastModified'>,
  documentFingerprint: string,
): string {
  if (!nonEmptyString(documentFingerprint)) throw new Error('A PDF fingerprint is required for local recovery.')
  return `leafpdf:${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}:${encodeURIComponent(documentFingerprint)}`
}

export async function loadSignatures(): Promise<SavedSignature[]> {
  const records = await getAll(SIGNATURES_STORE)
  const values = records === unavailable
    ? []
    : Array.isArray(records) ? records.filter(isSavedSignature) : []
  return clone(values.sort((left, right) => right.createdAt - left.createdAt))
}

export async function saveSignature(signature: SavedSignature): Promise<void> {
  if (!isSavedSignature(signature)) {
    throw new Error('Only valid PNG signature records can be saved locally.')
  }
  const value = clone(signature)
  const result = await put(SIGNATURES_STORE, value)
  if (result === unavailable) throw new Error('Local browser storage is unavailable.')
}

export async function deleteSignature(id: string): Promise<void> {
  if (!nonEmptyString(id)) return
  const result = await remove(SIGNATURES_STORE, id)
  if (result === unavailable) throw new Error('Local browser storage is unavailable.')
}

/** Save an annotation document only; this function intentionally accepts no PDF data. */
export async function saveSession(key: string, document: EditorDocument): Promise<void> {
  if (!nonEmptyString(key) || !isEditorDocument(document)) {
    throw new Error('Invalid local recovery document.')
  }
  // Pick known fields so future callers cannot accidentally include source bytes.
  const safeDocument = persistedDocument(document)
  const result = await put(SESSIONS_STORE, { key, document: safeDocument })
  if (result === unavailable) throw new Error('Local browser storage is unavailable.')
}

export async function loadSession(key: string): Promise<EditorDocument | null> {
  if (!nonEmptyString(key)) return null
  const record = await get(SESSIONS_STORE, key)
  if (record === unavailable) return null
  if (!isSessionRecord(record, key)) return null
  return clone(persistedDocument(record.document))
}

export async function deleteSession(key: string): Promise<void> {
  if (!nonEmptyString(key)) return
  const result = await remove(SESSIONS_STORE, key)
  if (result === unavailable) throw new Error('Local browser storage is unavailable.')
}

/** Test-only cleanup for the local test database. */
export async function resetLocalStoreForTests(): Promise<void> {
  const factory = indexedDbFactory()
  if (!factory) return
  await new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.deleteDatabase(DATABASE_NAME)
    } catch {
      resolve()
      return
    }
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

function indexedDbFactory(): IDBFactory | null {
  try {
    return typeof globalThis.indexedDB === 'undefined' ? null : globalThis.indexedDB
  } catch {
    return null
  }
}

async function get(storeName: string, key: IDBValidKey): Promise<MaybeDatabaseValue> {
  const database = await openDatabase()
  if (!database) return unavailable
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch {
    return unavailable
  } finally {
    database.close()
  }
}

async function getAll(storeName: string): Promise<MaybeDatabaseValue> {
  const database = await openDatabase()
  if (!database) return unavailable
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readonly')
      const request = transaction.objectStore(storeName).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch {
    return unavailable
  } finally {
    database.close()
  }
}

async function put(storeName: string, value: unknown): Promise<void | typeof unavailable> {
  const database = await openDatabase()
  if (!database) return unavailable
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).put(value)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch {
    return unavailable
  } finally {
    database.close()
  }
}

async function remove(storeName: string, key: IDBValidKey): Promise<void | typeof unavailable> {
  const database = await openDatabase()
  if (!database) return unavailable
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite')
      transaction.objectStore(storeName).delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch {
    return unavailable
  } finally {
    database.close()
  }
}

async function openDatabase(): Promise<IDBDatabase | null> {
  const factory = indexedDbFactory()
  if (!factory) return null
  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(SIGNATURES_STORE)) {
          database.createObjectStore(SIGNATURES_STORE, { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
          database.createObjectStore(SESSIONS_STORE, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Local browser storage is blocked.'))
    })
  } catch {
    return null
  }
}

function isSessionRecord(value: unknown, expectedKey: string): value is { key: string; document: EditorDocument } {
  if (!isRecord(value) || value.key !== expectedKey || !isEditorDocument(value.document)) return false
  return Object.keys(value).every((key) => key === 'key' || key === 'document')
}

function isSavedSignature(value: unknown): value is SavedSignature {
  if (!isRecord(value)) return false
  return nonEmptyString(value.id)
    && nonEmptyString(value.name)
    && typeof value.createdAt === 'number'
    && Number.isFinite(value.createdAt)
    && typeof value.dataUrl === 'string'
    && /^data:image\/png;base64,[a-z0-9+/=\s]+$/i.test(value.dataUrl)
    && Object.keys(value).every((key) => key === 'id' || key === 'name' || key === 'dataUrl' || key === 'createdAt')
}

function isEditorDocument(value: unknown): value is EditorDocument {
  if (!isRecord(value) || !nonEmptyString(value.fileName) || !Array.isArray(value.pages) || !Array.isArray(value.annotations)) {
    return false
  }
  if (!hasOnly(value, [], ['fileName', 'pages', 'annotations'])) return false
  if (!value.pages.every(isEditorPage) || value.pages.length === 0) return false
  const pageIds = new Set(value.pages.map((page) => page.id))
  return pageIds.size === value.pages.length && value.annotations.every((annotation) => isAnnotation(annotation, pageIds))
}

function isEditorPage(value: unknown): value is EditorPage {
  return isRecord(value)
    && nonEmptyString(value.id)
    && typeof value.sourceIndex === 'number'
    && Number.isInteger(value.sourceIndex)
    && value.sourceIndex >= 0
    && (value.rotation === 0 || value.rotation === 90 || value.rotation === 180 || value.rotation === 270)
    && Object.keys(value).every((key) => key === 'id' || key === 'sourceIndex' || key === 'rotation')
}

function isAnnotation(value: unknown, pageIds: Set<string>): value is Annotation {
  if (!isRecord(value) || !annotationBaseIsValid(value, pageIds)) return false
  switch (value.kind) {
    case 'text':
      return typeof value.text === 'string'
        && nonEmptyString(value.color)
        && positiveNumber(value.fontSize)
        && optionalNumberBetween(value.opacity, 0, 1)
        && optionalOneOf(value.fontFamily, ['sans', 'serif', 'mono'])
        && optionalOneOf(value.fontWeight, [400, 700])
        && optionalOneOf(value.fontStyle, ['normal', 'italic'])
        && optionalOneOf(value.direction, ['ltr', 'rtl'])
        && hasOnly(value, annotationBaseKeys, ['kind', 'text', 'color', 'fontSize', 'opacity', 'fontFamily', 'fontWeight', 'fontStyle', 'direction'])
    case 'highlight':
      return nonEmptyString(value.color)
        && numberBetween(value.opacity, 0, 1)
        && hasOnly(value, annotationBaseKeys, ['kind', 'color', 'opacity'])
    case 'ink':
      return Array.isArray(value.points)
        && value.points.every(isNormalizedPoint)
        && nonEmptyString(value.color)
        && positiveNumber(value.strokeWidth)
        && hasOnly(value, annotationBaseKeys, ['kind', 'points', 'color', 'strokeWidth'])
    case 'image':
      return imageDataMatchesMime(value.dataUrl, value.mimeType)
        && optionalOneOf(value.role, ['image', 'signature'])
        && hasOnly(value, annotationBaseKeys, ['kind', 'dataUrl', 'mimeType', 'role'])
    case 'shape':
      return oneOf(value.shape, ['rectangle', 'ellipse', 'line', 'arrow'])
        && nonEmptyString(value.strokeColor)
        && (value.fillColor === undefined || nonEmptyString(value.fillColor))
        && positiveNumber(value.strokeWidth)
        && hasOnly(value, annotationBaseKeys, ['kind', 'shape', 'strokeColor', 'fillColor', 'strokeWidth'])
    case 'stamp':
      return oneOf(value.stamp, ['check', 'cross', 'dot', 'date'])
        && (value.label === undefined || typeof value.label === 'string')
        && nonEmptyString(value.color)
        && positiveNumber(value.strokeWidth)
        && hasOnly(value, annotationBaseKeys, ['kind', 'stamp', 'label', 'color', 'strokeWidth'])
    default:
      return false
  }
}

const annotationBaseKeys = ['id', 'pageId', 'x', 'y', 'width', 'height', 'rotation'] as const

function annotationBaseIsValid(value: Record<string, unknown>, pageIds: Set<string>): boolean {
  return nonEmptyString(value.id)
    && typeof value.pageId === 'string'
    && pageIds.has(value.pageId)
    && numberBetween(value.x, 0, 1)
    && numberBetween(value.y, 0, 1)
    && numberBetween(value.width, 0, 1)
    && numberBetween(value.height, 0, 1)
    && optionalFiniteNumber(value.rotation)
}

function isNormalizedPoint(value: unknown): boolean {
  return isRecord(value)
    && numberBetween(value.x, 0, 1)
    && numberBetween(value.y, 0, 1)
    && hasOnly(value, [], ['x', 'y'])
}

function imageDataMatchesMime(dataUrl: unknown, mimeType: unknown): boolean {
  return (mimeType === 'image/png' || mimeType === 'image/jpeg')
    && typeof dataUrl === 'string'
    && dataUrl.startsWith(`data:${mimeType};base64,`)
}

function persistedDocument(document: EditorDocument): EditorDocument {
  return clone({
    fileName: document.fileName,
    pages: document.pages,
    annotations: document.annotations,
  })
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

function numberBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}

function optionalNumberBetween(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || numberBetween(value, minimum, maximum)
}

function optionalOneOf<T extends string | number>(value: unknown, options: readonly T[]): value is T | undefined {
  return value === undefined || options.includes(value as T)
}

function oneOf<T extends string | number>(value: unknown, options: readonly T[]): value is T {
  return options.includes(value as T)
}

function hasOnly(value: Record<string, unknown>, base: readonly string[], additional: readonly string[]): boolean {
  const allowed = new Set([...base, ...additional])
  return Object.keys(value).every((key) => allowed.has(key))
}
