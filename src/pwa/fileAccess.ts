import { LEAF_PROJECT_MIME } from '../project/projectTypes'

interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

interface OpenPickerOptions {
  multiple?: boolean
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
}

interface SavePickerOptions {
  suggestedName?: string
  types?: FilePickerAcceptType[]
  excludeAcceptAllOption?: boolean
}

interface FileSystemFileHandleLike {
  getFile(): Promise<File>
  createWritable(): Promise<{
    write(data: Blob): Promise<void>
    close(): Promise<void>
    abort?(): Promise<void>
  }>
}

interface LaunchParamsLike {
  files: FileSystemFileHandleLike[]
}

interface LaunchQueueLike {
  setConsumer(consumer: (params: LaunchParamsLike) => void | Promise<void>): void
}

type FileWindow = Window & typeof globalThis & {
  showOpenFilePicker?: (options?: OpenPickerOptions) => Promise<FileSystemFileHandleLike[]>
  showSaveFilePicker?: (options?: SavePickerOptions) => Promise<FileSystemFileHandleLike>
  launchQueue?: LaunchQueueLike
}

const DOCUMENT_TYPES: FilePickerAcceptType[] = [
  {
    description: 'PDF or LeafPDF project',
    accept: {
      'application/pdf': ['.pdf'],
      [LEAF_PROJECT_MIME]: ['.leafpdf'],
    },
  },
]

export function supportsNativeOpen(): boolean {
  return typeof (window as FileWindow).showOpenFilePicker === 'function'
}

export function supportsNativeSave(): boolean {
  return typeof (window as FileWindow).showSaveFilePicker === 'function'
}

export async function chooseLocalDocument(): Promise<File | null> {
  const picker = (window as FileWindow).showOpenFilePicker
  if (!picker) return null
  try {
    const [handle] = await picker({
      multiple: false,
      types: DOCUMENT_TYPES,
      excludeAcceptAllOption: true,
    })
    return handle ? await handle.getFile() : null
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
}

function fallbackDownload(blob: Blob, suggestedName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = suggestedName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export async function saveLocalBlob(
  blob: Blob,
  suggestedName: string,
  type: FilePickerAcceptType,
): Promise<'native' | 'download' | 'cancelled'> {
  const picker = (window as FileWindow).showSaveFilePicker
  if (!picker) {
    fallbackDownload(blob, suggestedName)
    return 'download'
  }

  let handle: FileSystemFileHandleLike
  try {
    handle = await picker({ suggestedName, types: [type], excludeAcceptAllOption: true })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    throw error
  }

  const writable = await handle.createWritable()
  try {
    await writable.write(blob)
    await writable.close()
    return 'native'
  } catch (error) {
    await writable.abort?.().catch(() => undefined)
    throw error
  }
}

export const PDF_SAVE_TYPE: FilePickerAcceptType = {
  description: 'PDF document',
  accept: { 'application/pdf': ['.pdf'] },
}

export const PROJECT_SAVE_TYPE: FilePickerAcceptType = {
  description: 'LeafPDF editable project',
  accept: { [LEAF_PROJECT_MIME]: ['.leafpdf'] },
}

export function registerFileLaunchConsumer(onFile: (file: File) => void | Promise<void>): () => void {
  const queue = (window as FileWindow).launchQueue
  if (!queue) return () => undefined
  let active = true
  queue.setConsumer(async ({ files }) => {
    if (!active || files.length === 0) return
    const file = await files[0].getFile()
    if (active) await onFile(file)
  })
  return () => { active = false }
}

export interface StorageHealth {
  persisted: boolean
  usage: number | null
  quota: number | null
}

export async function requestPersistentStorage(): Promise<StorageHealth> {
  const storage = navigator.storage
  if (!storage) return { persisted: false, usage: null, quota: null }
  const persisted = storage.persist ? await storage.persist().catch(() => false) : false
  const estimate = storage.estimate ? await storage.estimate().catch(() => ({})) : {}
  return {
    persisted,
    usage: typeof estimate.usage === 'number' ? estimate.usage : null,
    quota: typeof estimate.quota === 'number' ? estimate.quota : null,
  }
}
