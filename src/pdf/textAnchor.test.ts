import { describe, expect, it } from 'vitest'
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib'
import pako from 'pako'
import { createEditorState, editorReducer } from '../model/editor'
import { anchorAtOffsetFromTop, exportEditedPdf } from './exportPdf'

const PAGE = { width: 400, height: 500 }

/** Decode a page's content streams so the actual drawing operators can be read. */
function decodeContentStreams(document: PDFDocument, pageIndex: number): string {
  const contents = document.getPage(pageIndex).node.get(PDFName.of('Contents'))
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents]
  return refs
    .map((ref) => {
      const stream = document.context.lookup(ref)
      if (!(stream instanceof PDFRawStream)) return ''
      const raw = stream.asUint8Array()
      try {
        return new TextDecoder().decode(pako.inflate(raw))
      } catch {
        return new TextDecoder().decode(raw)
      }
    })
    .join('\n')
}

/** The y translation of the text matrix, i.e. the first baseline. */
function textBaselineY(content: string): number {
  const match = content.match(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm/)
  if (!match) throw new Error(`No text matrix found in:\n${content}`)
  return Number(match[2])
}

async function exportTextAnnotation(box: { y: number; height: number }): Promise<number> {
  const source = await PDFDocument.create()
  source.addPage([PAGE.width, PAGE.height])
  const sourceBytes = await source.save()

  let state = createEditorState('anchor.pdf', 1)
  state = editorReducer(state, {
    type: 'addAnnotation',
    annotation: {
      id: 'text-1', pageId: 'page-1', kind: 'text', x: 0.1, y: box.y,
      width: 0.5, height: box.height, text: 'HELLO', color: '#000000', fontSize: 18,
    },
  })

  const reopened = await PDFDocument.load(await exportEditedPdf(sourceBytes, state.present))
  return textBaselineY(decodeContentStreams(reopened, 0))
}

/** The offset the exporter uses for added text: the font's ascent below the box top. */
async function ascentOf(size: number): Promise<number> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  return font.heightAtSize(size, { descender: false })
}

describe('anchorAtOffsetFromTop', () => {
  it('maps the box top-left to PDF coordinates when the offset is zero', () => {
    const anchor = anchorAtOffsetFromTop({ x: 0.1, y: 0.2, width: 0.5, height: 0.1 }, PAGE.width, PAGE.height, 0, 0)
    expect(anchor.x).toBeCloseTo(40)
    // PDF y counts up from the bottom, so the box top is near the top of the page.
    expect(anchor.y).toBeCloseTo(500 - 100)
  })

  it('maps the box bottom-left when the offset is the box height', () => {
    const box = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }
    const anchor = anchorAtOffsetFromTop(box, PAGE.width, PAGE.height, 0, box.height * PAGE.height)
    expect(anchor.y).toBeCloseTo(500 - 150)
  })

  it('gives the same text baseline regardless of how tall the box is', async () => {
    // This is the defect: anchoring text to the box bottom made a taller box push the
    // exported text further down, while the preview always starts it at the top.
    const ascent = await ascentOf(18)
    const shortBox = { x: 0.1, y: 0.2, width: 0.5, height: 0.04 }
    const tallBox = { x: 0.1, y: 0.2, width: 0.5, height: 0.30 }

    const shortAnchor = anchorAtOffsetFromTop(shortBox, PAGE.width, PAGE.height, 0, ascent)
    const tallAnchor = anchorAtOffsetFromTop(tallBox, PAGE.width, PAGE.height, 0, ascent)
    expect(tallAnchor.y).toBeCloseTo(shortAnchor.y)

    // And the baseline sits one ascent below the box top, not at its bottom.
    expect(shortAnchor.y).toBeCloseTo(500 - 100 - ascent)
  })

  it('keeps the offset perpendicular to a rotated annotation', () => {
    // A 90-degree annotation grows to the left in display space, so the offset moves
    // along -x rather than +y.
    const box = { x: 0.5, y: 0.5, width: 0.2, height: 0.1, rotation: 90 }
    const anchor = anchorAtOffsetFromTop(box, PAGE.width, PAGE.height, 0, 20)
    expect(anchor.x).toBeCloseTo(200 - 20)
    expect(anchor.y).toBeCloseTo(500 - 250)
  })

  it('exports added text at the top of its box, not the bottom', async () => {
    const ascent = await ascentOf(18)
    const boxTopInPdf = PAGE.height - 0.2 * PAGE.height

    // A tall box and a short box at the same y must put text on the same baseline.
    const short = await exportTextAnnotation({ y: 0.2, height: 0.04 })
    const tall = await exportTextAnnotation({ y: 0.2, height: 0.30 })
    expect(tall).toBeCloseTo(short, 1)

    // The baseline is one ascent below the box top. Anchoring to the bottom of the
    // tall box would put it at 250, which is 150pt too low.
    expect(short).toBeCloseTo(boxTopInPdf - ascent, 1)
    expect(tall).toBeGreaterThan(250 + 1)
  })

  it('follows the page rotation', () => {
    // On a 90-degree page the display box is landscape, so the same normalized point
    // lands on a different PDF axis.
    const box = { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }
    const anchor = anchorAtOffsetFromTop(box, PAGE.width, PAGE.height, 90, 0)
    expect(anchor.x).toBeCloseTo(0.2 * PAGE.width)
    expect(anchor.y).toBeCloseTo(0.1 * PAGE.height)
  })
})
