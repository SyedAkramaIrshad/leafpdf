import type { EditorDocument } from '../model/editor'
import {
  LEAF_PROJECT_FORMAT,
  LEAF_PROJECT_MIME,
  LEAF_PROJECT_VERSION,
  type LeafProject,
  type LeafProjectInput,
  type LeafProjectSource,
  type OcrPageResult,
  type OpenedLeafProject,
  type ReviewComment,
} from './projectTypes'

export const PROJECT_LIMITS = {
  maxProjectBytes: 320 * 1024 * 1024,
  maxSourceBytes: 100 * 1024 * 1024,
  maxSources: 20,
  maxPages: 10_000,
  maxAnnotations: 100_000,
  maxComments: 10_000,
  maxOcrWords: 2_000_000,
} as const

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalized(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && value <= 1
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  if (!BASE64_PATTERN.test(value) || value.length % 4 !== 0) {
    throw new Error('A project source contains invalid base64 data.')
  }
  let binary: string
  try {
    binary = atob(value)
  } catch {
    throw new Error('A project source contains invalid base64 data.')
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', ownedArrayBuffer(bytes))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
}

async function sourceFromFile(id: string, file: File): Promise<LeafProjectSource> {
  assert(id.trim().length > 0, 'Every project source needs an id.')
  assert(file.size > 0, `The PDF source ${file.name} is empty.`)
  assert(file.size <= PROJECT_LIMITS.maxSourceBytes, `The PDF source ${file.name} exceeds 100 MB.`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  assert(isPdf(bytes), `${file.name} is not a valid PDF source.`)
  return {
    id,
    name: file.name,
    mimeType: 'application/pdf',
    size: bytes.byteLength,
    lastModified: file.lastModified,
    sha256: await sha256(bytes),
    data: bytesToBase64(bytes),
  }
}

function validateDocument(value: unknown): asserts value is EditorDocument {
  assert(isRecord(value), 'The project document is missing.')
  assert(typeof value.fileName === 'string' && value.fileName.length > 0, 'The project document has no file name.')
  assert(Array.isArray(value.pages) && value.pages.length > 0, 'The project has no pages.')
  assert(value.pages.length <= PROJECT_LIMITS.maxPages, 'The project contains too many pages.')
  assert(Array.isArray(value.annotations), 'The project annotations are invalid.')
  assert(value.annotations.length <= PROJECT_LIMITS.maxAnnotations, 'The project contains too many annotations.')
  assert(isRecord(value.formValues), 'The project form values are invalid.')

  const pageIds = new Set<string>()
  for (const page of value.pages) {
    assert(isRecord(page) && typeof page.id === 'string' && page.id.length > 0, 'A project page is invalid.')
    assert(!pageIds.has(page.id), 'The project contains duplicate page ids.')
    pageIds.add(page.id)
    assert(page.kind === 'original' || page.kind === 'blank' || page.kind === 'external', 'A project page type is unsupported.')
    assert(page.rotation === 0 || page.rotation === 90 || page.rotation === 180 || page.rotation === 270, 'A project page rotation is invalid.')
    if (page.kind === 'original') {
      assert(Number.isInteger(page.sourceIndex) && Number(page.sourceIndex) >= 0, 'An original page index is invalid.')
    } else if (page.kind === 'external') {
      assert(typeof page.documentId === 'string' && page.documentId.length > 0, 'An inserted page source is missing.')
      assert(Number.isInteger(page.sourceIndex) && Number(page.sourceIndex) >= 0, 'An inserted page index is invalid.')
    } else {
      assert(finiteNumber(page.width) && page.width > 0, 'A blank page width is invalid.')
      assert(finiteNumber(page.height) && page.height > 0, 'A blank page height is invalid.')
    }
  }

  for (const annotation of value.annotations) {
    assert(isRecord(annotation), 'A project annotation is invalid.')
    assert(typeof annotation.id === 'string' && annotation.id.length > 0, 'A project annotation id is invalid.')
    assert(typeof annotation.pageId === 'string' && pageIds.has(annotation.pageId), 'A project annotation targets a missing page.')
    assert(typeof annotation.kind === 'string', 'A project annotation type is invalid.')
    if (annotation.kind !== 'ink') {
      assert(normalized(annotation.x) && normalized(annotation.y), 'A project annotation position is invalid.')
      assert(normalized(annotation.width) && normalized(annotation.height), 'A project annotation size is invalid.')
    }
  }
}

function validateComments(value: unknown, pageIds: Set<string>): asserts value is ReviewComment[] {
  assert(Array.isArray(value), 'Project comments are invalid.')
  assert(value.length <= PROJECT_LIMITS.maxComments, 'The project contains too many comments.')
  for (const comment of value) {
    assert(isRecord(comment), 'A project comment is invalid.')
    assert(typeof comment.id === 'string' && comment.id.length > 0, 'A project comment id is invalid.')
    assert(typeof comment.pageId === 'string' && pageIds.has(comment.pageId), 'A project comment targets a missing page.')
    assert(normalized(comment.x) && normalized(comment.y), 'A project comment position is invalid.')
    assert(typeof comment.body === 'string' && comment.body.length <= 20_000, 'A project comment body is invalid.')
    assert(typeof comment.author === 'string' && comment.author.length <= 200, 'A project comment author is invalid.')
    assert(finiteNumber(comment.createdAt) && finiteNumber(comment.updatedAt), 'A project comment timestamp is invalid.')
    assert(typeof comment.resolved === 'boolean', 'A project comment state is invalid.')
  }
}

function validateOcr(value: unknown, pageIds: Set<string>): asserts value is OcrPageResult[] {
  assert(Array.isArray(value), 'Project OCR results are invalid.')
  let wordCount = 0
  for (const result of value) {
    assert(isRecord(result), 'A project OCR result is invalid.')
    assert(typeof result.pageId === 'string' && pageIds.has(result.pageId), 'A project OCR result targets a missing page.')
    assert(typeof result.language === 'string' && result.language.length <= 100, 'A project OCR language is invalid.')
    assert(result.provider === 'text-detector', 'The project OCR provider is unsupported.')
    assert(finiteNumber(result.createdAt), 'A project OCR timestamp is invalid.')
    assert(Array.isArray(result.words), 'A project OCR word list is invalid.')
    wordCount += result.words.length
    assert(wordCount <= PROJECT_LIMITS.maxOcrWords, 'The project contains too many OCR words.')
    for (const word of result.words) {
      assert(isRecord(word), 'A project OCR word is invalid.')
      assert(typeof word.text === 'string' && word.text.length <= 2_000, 'A project OCR word is invalid.')
      assert(finiteNumber(word.confidence) && word.confidence >= 0 && word.confidence <= 1, 'A project OCR confidence is invalid.')
      assert(normalized(word.x) && normalized(word.y) && normalized(word.width) && normalized(word.height), 'A project OCR box is invalid.')
    }
  }
}

function validateProject(value: unknown): asserts value is LeafProject {
  assert(isRecord(value), 'This is not a LeafPDF project.')
  assert(value.format === LEAF_PROJECT_FORMAT, 'This is not a LeafPDF project.')
  assert(value.version === LEAF_PROJECT_VERSION, `LeafPDF project version ${String(value.version)} is not supported.`)
  assert(finiteNumber(value.createdAt) && finiteNumber(value.updatedAt), 'The project timestamps are invalid.')
  assert(typeof value.primarySourceId === 'string' && value.primarySourceId.length > 0, 'The project primary source is missing.')
  assert(Array.isArray(value.sources) && value.sources.length > 0, 'The project has no PDF sources.')
  assert(value.sources.length <= PROJECT_LIMITS.maxSources, 'The project contains too many source PDFs.')
  validateDocument(value.document)
  const pageIds = new Set(value.document.pages.map((page) => page.id))
  validateComments(value.comments, pageIds)
  validateOcr(value.ocr, pageIds)
}

async function verifySource(value: unknown): Promise<{ source: LeafProjectSource; file: File }> {
  assert(isRecord(value), 'A project source is invalid.')
  assert(typeof value.id === 'string' && value.id.length > 0, 'A project source id is invalid.')
  assert(typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 1_000, 'A project source name is invalid.')
  assert(value.mimeType === 'application/pdf', 'A project source is not a PDF.')
  assert(Number.isInteger(value.size) && Number(value.size) > 0, 'A project source size is invalid.')
  assert(Number(value.size) <= PROJECT_LIMITS.maxSourceBytes, `The PDF source ${value.name} exceeds 100 MB.`)
  assert(finiteNumber(value.lastModified), 'A project source timestamp is invalid.')
  assert(typeof value.sha256 === 'string' && SHA256_PATTERN.test(value.sha256), 'A project source hash is invalid.')
  assert(typeof value.data === 'string', 'A project source has no data.')
  const bytes = base64ToBytes(value.data)
  assert(bytes.byteLength === value.size, `The PDF source ${value.name} has an incorrect size.`)
  assert(isPdf(bytes), `The PDF source ${value.name} is not a PDF.`)
  assert(await sha256(bytes) === value.sha256, `The PDF source ${value.name} failed its integrity check.`)
  const source = value as unknown as LeafProjectSource
  return {
    source,
    file: new File([ownedArrayBuffer(bytes)], source.name, {
      type: 'application/pdf',
      lastModified: source.lastModified,
    }),
  }
}

export async function createLeafProject(input: LeafProjectInput): Promise<LeafProject> {
  assert(input.insertedFiles.length + 1 <= PROJECT_LIMITS.maxSources, 'The project contains too many source PDFs.')
  const primarySourceId = 'primary'
  const ids = new Set([primarySourceId])
  for (const entry of input.insertedFiles) {
    assert(!ids.has(entry.id), `The project source id ${entry.id} is duplicated.`)
    ids.add(entry.id)
  }
  const sources = await Promise.all([
    sourceFromFile(primarySourceId, input.primaryFile),
    ...input.insertedFiles.map(({ id, file }) => sourceFromFile(id, file)),
  ])
  const totalBytes = sources.reduce((sum, source) => sum + source.size, 0)
  assert(totalBytes <= PROJECT_LIMITS.maxProjectBytes, 'The project source PDFs exceed the project size limit.')
  const now = Date.now()
  const project: LeafProject = {
    format: LEAF_PROJECT_FORMAT,
    version: LEAF_PROJECT_VERSION,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    primarySourceId,
    sources,
    document: structuredClone(input.document),
    comments: structuredClone(input.comments ?? []),
    ocr: structuredClone(input.ocr ?? []),
  }
  validateProject(project)
  return project
}

export function serializeLeafProject(project: LeafProject): Blob {
  validateProject(project)
  return new Blob([JSON.stringify(project)], { type: LEAF_PROJECT_MIME })
}

export async function hydrateLeafProject(project: LeafProject): Promise<OpenedLeafProject> {
  validateProject(project)
  const verified = await Promise.all(project.sources.map(verifySource))
  const ids = new Set<string>()
  let totalBytes = 0
  for (const { source } of verified) {
    assert(!ids.has(source.id), `The project source id ${source.id} is duplicated.`)
    ids.add(source.id)
    totalBytes += source.size
  }
  assert(totalBytes <= PROJECT_LIMITS.maxProjectBytes, 'The project source PDFs exceed the project size limit.')
  const primary = verified.find(({ source }) => source.id === project.primarySourceId)
  assert(primary, 'The project primary PDF is missing.')

  const referencedExternalIds = new Set(
    project.document.pages.flatMap((page) => page.kind === 'external' ? [page.documentId] : []),
  )
  for (const id of referencedExternalIds) {
    assert(ids.has(id), `The inserted PDF source ${id} is missing from the project.`)
  }

  return {
    project: structuredClone(project),
    primaryFile: primary.file,
    insertedFiles: new Map(
      verified
        .filter(({ source }) => source.id !== project.primarySourceId)
        .map(({ source, file }) => [source.id, file]),
    ),
  }
}

export async function openLeafProject(input: Blob | ArrayBuffer | string): Promise<OpenedLeafProject> {
  const byteLength = typeof input === 'string'
    ? new TextEncoder().encode(input).byteLength
    : input instanceof ArrayBuffer
      ? input.byteLength
      : input.size
  assert(byteLength <= PROJECT_LIMITS.maxProjectBytes * 1.5, 'The LeafPDF project file is too large.')
  const text = typeof input === 'string'
    ? input
    : input instanceof ArrayBuffer
      ? new TextDecoder().decode(input)
      : await input.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('This LeafPDF project is not valid JSON.')
  }
  validateProject(parsed)
  return hydrateLeafProject(parsed)
}

export function projectFileName(sourceName: string): string {
  const stem = sourceName.replace(/\.pdf$/i, '') || 'document'
  return `${stem}.leafpdf`
}
