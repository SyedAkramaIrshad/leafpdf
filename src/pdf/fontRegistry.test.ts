import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { createFontRegistry } from './fontRegistry'

async function registryFor() {
  const document = await PDFDocument.create()
  return { document, registry: await createFontRegistry(document) }
}

describe('createFontRegistry', () => {
  it('uses a standard font for ASCII and Latin-1 text', async () => {
    const { registry } = await registryFor()
    const font = await registry.fontFor({ text: 'Quarterly report 50% (draft) - Grüße ½ ©', fontFamily: 'sans', fontWeight: 400 })
    expect(font.name).toBe('Helvetica')
  })

  it('uses the standard italic faces so italic survives export', async () => {
    const { registry } = await registryFor()
    expect((await registry.fontFor({ text: 'Slanted', fontFamily: 'sans', fontWeight: 400, fontStyle: 'italic' })).name)
      .toBe('Helvetica-Oblique')
    expect((await registry.fontFor({ text: 'Slanted', fontFamily: 'serif', fontWeight: 700, fontStyle: 'italic' })).name)
      .toBe('Times-BoldItalic')
    expect((await registry.fontFor({ text: 'Slanted', fontFamily: 'mono', fontWeight: 400, fontStyle: 'italic' })).name)
      .toBe('Courier-Oblique')
    // Absent style means upright.
    expect((await registry.fontFor({ text: 'Upright', fontFamily: 'sans', fontWeight: 400 })).name).toBe('Helvetica')
  })

  it('falls back to upright for italic text no standard font can encode', async () => {
    const { registry } = await registryFor()
    // The bundled Noto files are upright only, so this must not throw.
    const font = await registry.fontFor({ text: 'Привет', fontFamily: 'sans', fontWeight: 400, fontStyle: 'italic' })
    expect(font.name).toMatch(/NotoSans/)
  })

  it('embeds a font for an em dash and curly quotes', async () => {
    const { registry } = await registryFor()
    const font = await registry.fontFor({ text: 'Reviewed — “locally”', fontFamily: 'sans', fontWeight: 400 })
    expect(font.name).toMatch(/NotoSans/)
  })

  it('embeds a font for cp1252-only characters a substituted face would mis-advance', async () => {
    const { registry } = await registryFor()
    // Base-14 Helvetica is not embedded, so Poppler draws its own wider Euro over
    // the following digit. An embedded font carries correct widths.
    const font = await registry.fontFor({ text: '€50', fontFamily: 'sans', fontWeight: 400 })
    expect(font.name).toMatch(/NotoSans/)
  })

  it('picks the standard font matching family and weight', async () => {
    const { registry } = await registryFor()
    expect((await registry.fontFor({ text: 'Plain', fontFamily: 'serif', fontWeight: 700 })).name).toBe('Times-Bold')
    expect((await registry.fontFor({ text: 'Plain', fontFamily: 'mono', fontWeight: 400 })).name).toBe('Courier')
    expect((await registry.fontFor({ text: 'Plain', fontFamily: 'sans', fontWeight: 700 })).name).toBe('Helvetica-Bold')
  })

  it('falls back to a bundled Unicode font for text WinAnsi cannot encode', async () => {
    const { registry } = await registryFor()
    const cyrillic = await registry.fontFor({ text: 'Привет', fontFamily: 'sans', fontWeight: 400 })
    expect(cyrillic.name).toMatch(/NotoSans/)

    const arabic = await registry.fontFor({ text: 'مرحبا', fontFamily: 'sans', fontWeight: 400 })
    expect(arabic.name).toMatch(/NotoSansArabic/)

    const devanagari = await registry.fontFor({ text: 'नमस्ते', fontFamily: 'sans', fontWeight: 400 })
    expect(devanagari.name).toMatch(/NotoSansDevanagari/)
  })

  it('measures Unicode text with the font that will actually draw it', async () => {
    const { registry } = await registryFor()
    const font = await registry.fontFor({ text: 'مرحبا', fontFamily: 'sans', fontWeight: 400 })
    expect(font.widthOfTextAtSize('مرحبا', 12)).toBeGreaterThan(0)
  })

  it('never embeds the same font twice in one document', async () => {
    const { registry } = await registryFor()
    const first = await registry.fontFor({ text: 'Привет', fontFamily: 'sans', fontWeight: 400 })
    const second = await registry.fontFor({ text: 'Здравствуйте', fontFamily: 'sans', fontWeight: 400 })
    expect(second).toBe(first)

    const standardFirst = await registry.fontFor({ text: 'One', fontFamily: 'sans', fontWeight: 400 })
    const standardSecond = await registry.fontFor({ text: 'Two', fontFamily: 'sans', fontWeight: 400 })
    expect(standardSecond).toBe(standardFirst)
  })

  it('refuses text no bundled font can draw and names the characters', async () => {
    const { registry } = await registryFor()
    await expect(registry.fontFor({ text: '你好', fontFamily: 'sans', fontWeight: 400 }))
      .rejects.toThrow(/cannot embed a font for "你好"/)
    await expect(registry.fontFor({ text: '你好', fontFamily: 'sans', fontWeight: 400 }))
      .rejects.toThrow(/Chinese/)
  })
})
