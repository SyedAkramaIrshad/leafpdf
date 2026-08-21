import {
  deleteSession,
  resetLocalStoreForTests,
  saveSession,
} from '../persistence/localStore'
import type { LeafProject } from './projectTypes'

const DATABASE_NAME = 'leafpdf-project-recovery'
const DATABASE_VERSION = 1
const STORE_NAME = 'projects'

interface RecoveryRecord {
  key: string
  project: LeafProject
  updatedAt: number
}

function indexedDbFactory(): IDBFactory | null {
  try {
    return typeof globalThis.indexedDB === 'undefined' ? null : globalThis.indexedDB
  } catch {
    return null
  }
}

function legacySessionKey(projectKey: string): string {
  return projectKey.replace(/^leafpdf-project:/, 'leafpdf:')
}

async function openDatabase(): Promise<IDBDatabase | null> {
  const factory = indexedDbFactory()
  if (!factory) return null
  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Project recovery storage is blocked.'))
    })
  } catch {
    return null
  }
}

export function projectRecoveryKey(
  file: Pick<File, 'name' | 'size' | 'lastModified'>,
  documentFingerprint: string,
): string {
  if (!documentFingerprint.trim()) throw new Error('A PDF fingerprint is required for project recovery.')
  return `leafpdf-project:${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}:${encodeURIComponent(documentFingerprint)}`
}

export async function saveProjectRecovery(key: string, project: LeafProject): Promise<void> {
  if (!key.trim()) throw new Error('A project recovery key is required.')
  const database = await openDatabase()
  if (!database) throw new Error('Local project recovery is unavailable.')
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const record: RecoveryRecord = { key, project: structuredClone(project), updatedAt: Date.now() }
      transaction.objectStore(STORE_NAME).put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }

  // Keep the compact document-only record for older LeafPDF builds and existing
  // integrations. The complete project above remains the source of truth and
  // includes inserted PDF bytes, comments, and OCR that the legacy store cannot.
  await saveSession(legacySessionKey(key), project.document).catch(() => undefined)
}

export async function loadProjectRecovery(key: string): Promise<LeafProject | null> {
  if (!key.trim()) return null
  const database = await openDatabase()
  if (!database) return null
  try {
    return await new Promise<LeafProject | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => {
        const record = request.result as RecoveryRecord | undefined
        resolve(record?.project ? structuredClone(record.project) : null)
      }
      request.onerror = () => reject(request.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch {
    return null
  } finally {
    database.close()
  }
}

export async function deleteProjectRecovery(key: string): Promise<void> {
  if (!key.trim()) return
  const database = await openDatabase()
  if (!database) throw new Error('Local project recovery is unavailable.')
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
  await deleteSession(legacySessionKey(key)).catch(() => undefined)
}

export async function resetProjectRecoveryForTests(): Promise<void> {
  const factory = indexedDbFactory()
  if (!factory) return
  await Promise.all([
    new Promise<void>((resolve) => {
      const request = factory.deleteDatabase(DATABASE_NAME)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    }),
    resetLocalStoreForTests(),
  ])
}
