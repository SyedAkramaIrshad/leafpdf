import type { EditorDocument } from '../model/editor'

export const LEAF_PROJECT_FORMAT = 'leafpdf-project' as const
export const LEAF_PROJECT_VERSION = 1 as const
export const LEAF_PROJECT_MIME = 'application/x-leafpdf+json' as const

export interface ReviewComment {
  id: string
  pageId: string
  x: number
  y: number
  body: string
  author: string
  createdAt: number
  updatedAt: number
  resolved: boolean
}

export interface OcrWord {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

export interface OcrPageResult {
  pageId: string
  language: string
  provider: 'text-detector'
  createdAt: number
  words: OcrWord[]
}

export interface LeafProjectSource {
  id: string
  name: string
  mimeType: 'application/pdf'
  size: number
  lastModified: number
  sha256: string
  /** Base64 without a data-URL prefix. */
  data: string
}

export interface LeafProject {
  format: typeof LEAF_PROJECT_FORMAT
  version: typeof LEAF_PROJECT_VERSION
  createdAt: number
  updatedAt: number
  primarySourceId: string
  sources: LeafProjectSource[]
  document: EditorDocument
  comments: ReviewComment[]
  ocr: OcrPageResult[]
}

export interface LeafProjectInput {
  primaryFile: File
  insertedFiles: Array<{ id: string; file: File }>
  document: EditorDocument
  comments?: ReviewComment[]
  ocr?: OcrPageResult[]
  createdAt?: number
}

export interface OpenedLeafProject {
  project: LeafProject
  primaryFile: File
  insertedFiles: Map<string, File>
}
