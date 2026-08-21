import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { EditorPage } from '../model/editor'
import { pageRenderSource, type ExternalDocuments } from '../pdf/pageSource'
import type { OcrPageResult, OcrWord } from '../project/projectTypes'

interface DetectedTextLike {
  rawValue?: string
  boundingBox?: { x: number; y: number; width: number; height: number }
}

interface TextDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedTextLike[]>
}

type TextDetectorConstructor = new () => TextDetectorLike

type OcrWindow = Window & typeof globalThis & {
  TextDetector?: TextDetectorConstructor
}

export function nativeOcrAvailable(): boolean {
  return typeof (window as OcrWindow).TextDetector === 'function'
}

export function normalizeDetectedText(
  detected: DetectedTextLike[],
  width: number,
  height: number,
): OcrWord[] {
  if (width <= 0 || height <= 0) return []
  return detected.flatMap((entry) => {
    const text = entry.rawValue?.trim()
    const box = entry.boundingBox
    if (!text || !box || box.width <= 0 || box.height <= 0) return []
    const x = Math.max(0, Math.min(1, box.x / width))
    const y = Math.max(0, Math.min(1, box.y / height))
    const wordWidth = Math.max(0, Math.min(1 - x, box.width / width))
    const wordHeight = Math.max(0, Math.min(1 - y, box.height / height))
    return [{
      text,
      // The browser TextDetector API does not expose calibrated confidence.
      // Keep a neutral value rather than inventing a high-confidence claim.
      confidence: 0.5,
      x,
      y,
      width: wordWidth,
      height: wordHeight,
    }]
  })
}

/**
 * Run OCR entirely on-device using the browser's native TextDetector when it is
 * available. No model or page bitmap is downloaded or uploaded by LeafPDF.
 */
export async function runNativeOcr(
  main: PDFDocumentProxy,
  external: ExternalDocuments,
  page: EditorPage,
  language = 'auto',
): Promise<OcrPageResult> {
  const Constructor = (window as OcrWindow).TextDetector
  if (!Constructor) {
    throw new Error('This browser does not provide its local TextDetector OCR API.')
  }
  if (page.kind === 'blank') {
    return { pageId: page.id, language, provider: 'text-detector', createdAt: Date.now(), words: [] }
  }
  const source = pageRenderSource(page, main, external)
  if (!source) throw new Error('The selected page source is unavailable for OCR.')
  const sourcePage = await source.pdf.getPage(source.pageNumber)
  const rotation = (sourcePage.rotate + page.rotation) % 360
  const viewport = sourcePage.getViewport({ scale: 2, rotation })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('This browser could not create an OCR drawing surface.')
  await sourcePage.render({ canvas, canvasContext: context, viewport }).promise
  const detector = new Constructor()
  const detected = await detector.detect(canvas)
  return {
    pageId: page.id,
    language,
    provider: 'text-detector',
    createdAt: Date.now(),
    words: normalizeDetectedText(detected, canvas.width, canvas.height),
  }
}
