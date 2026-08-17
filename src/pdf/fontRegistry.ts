import { Encodings } from '@pdf-lib/standard-fonts'
import { StandardFonts, type PDFDocument, type PDFFont } from 'pdf-lib'

// pdf-lib does not re-export its `Fontkit` type from the package root, so take it
// from the method that consumes it rather than deep-importing internals.
type Fontkit = Parameters<PDFDocument['registerFontkit']>[0]

let fontkitLoading: Promise<Fontkit> | null = null

/**
 * fontkit is ~700 kB and is only needed to embed a bundled Unicode font, so it is
 * loaded on first use. An export that stays inside the standard 14 fonts never
 * downloads it.
 *
 * `@pdf-lib/fontkit` ships a UMD bundle whose Indic/Universal shaper state machine
 * is a generator compiled against `regeneratorRuntime`, which the bundle never
 * provides. Without the global, shaping Devanagari throws
 * `regeneratorRuntime is not defined`, so it must be installed before fontkit
 * runs a shaper.
 */
function loadFontkit(): Promise<Fontkit> {
  fontkitLoading ??= (async () => {
    const [regenerator, fontkitModule] = await Promise.all([
      import('regenerator-runtime'),
      import('@pdf-lib/fontkit'),
    ])
    const shaperGlobals = globalThis as typeof globalThis & { regeneratorRuntime?: unknown }
    shaperGlobals.regeneratorRuntime ??= regenerator.default
    return fontkitModule.default as unknown as Fontkit
  })()
  return fontkitLoading
}

export type FontFamily = 'sans' | 'serif' | 'mono'
export type FontWeight = 400 | 700
export type FontStyle = 'normal' | 'italic'

export interface FontRequest {
  text: string
  fontFamily: FontFamily
  fontWeight: FontWeight
  /** Defaults to upright. Honoured for the standard 14 fonts, which ship italics. */
  fontStyle?: FontStyle
}

export interface FontRegistry {
  /**
   * Resolve the narrowest font that can draw every character of `input.text`.
   * Async because pdf-lib embeds fonts asynchronously; resolving on demand keeps
   * an export from writing font files the document never draws with.
   */
  fontFor(input: FontRequest): Promise<PDFFont>
}

/**
 * The standard 14 fonts include italic (oblique) faces, so italic survives export
 * for ASCII and Latin-1 text. The bundled Noto files are upright only; italic text
 * outside that range falls back to upright rather than being faked by shearing.
 */
const STANDARD_FONTS: Record<FontFamily, Record<FontStyle, Record<FontWeight, StandardFonts>>> = {
  sans: {
    normal: { 400: StandardFonts.Helvetica, 700: StandardFonts.HelveticaBold },
    italic: { 400: StandardFonts.HelveticaOblique, 700: StandardFonts.HelveticaBoldOblique },
  },
  serif: {
    normal: { 400: StandardFonts.TimesRoman, 700: StandardFonts.TimesRomanBold },
    italic: { 400: StandardFonts.TimesRomanItalic, 700: StandardFonts.TimesRomanBoldItalic },
  },
  mono: {
    normal: { 400: StandardFonts.Courier, 700: StandardFonts.CourierBold },
    italic: { 400: StandardFonts.CourierOblique, 700: StandardFonts.CourierBoldOblique },
  },
}

interface BundledFont {
  key: string
  /** Shown to the user when nothing can draw their text. */
  label: string
  load: () => Promise<Uint8Array>
}

/**
 * Fetch a bundled font emitted by Vite as a same-origin asset. `?url` keeps the
 * raw TTF bytes out of the JavaScript bundle: `?inline` base64-encoded every font,
 * which shipped each file 33% larger and cost an `atob` decode on first use.
 */
async function fetchFontBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`A bundled font could not be loaded (HTTP ${response.status}).`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Every bundled Unicode font, in the order they are tried. Each is a separate
 * dynamic import so a plain Latin export downloads none of them, and an Arabic
 * export downloads only the Arabic file. The files are emitted by the build and
 * served from this app's own origin, so no font is ever requested from Google or
 * any other host at runtime.
 */
const BUNDLED_FONTS: BundledFont[] = [
  {
    key: 'noto-sans-400',
    label: 'Noto Sans',
    load: () => import('../assets/fonts/NotoSans-Regular.ttf?url').then((module) => fetchFontBytes(module.default)),
  },
  {
    key: 'noto-sans-700',
    label: 'Noto Sans Bold',
    load: () => import('../assets/fonts/NotoSans-Bold.ttf?url').then((module) => fetchFontBytes(module.default)),
  },
  {
    key: 'noto-arabic',
    label: 'Noto Sans Arabic',
    load: () => import('../assets/fonts/NotoSansArabic-Regular.ttf?url').then((module) => fetchFontBytes(module.default)),
  },
  {
    key: 'noto-devanagari',
    label: 'Noto Sans Devanagari',
    load: () => import('../assets/fonts/NotoSansDevanagari-Regular.ttf?url').then((module) => fetchFontBytes(module.default)),
  },
  {
    key: 'noto-hebrew',
    label: 'Noto Sans Hebrew',
    load: () => import('../assets/fonts/NotoSansHebrew-Regular.ttf?url').then((module) => fetchFontBytes(module.default)),
  },
  {
    key: 'noto-thai',
    label: 'Noto Sans Thai',
    load: () => import('../assets/fonts/NotoSansThai-Regular.ttf?url').then((module) => fetchFontBytes(module.default)),
  },
]

function bundledFont(key: string): BundledFont {
  const found = BUNDLED_FONTS.find((font) => font.key === key)
  if (!found) throw new Error(`Unknown bundled font: ${key}`)
  return found
}

/** Candidate order for one request: matching weight first, then script fonts. */
function candidateKeys(weight: FontWeight): string[] {
  const weighted = weight === 700 ? ['noto-sans-700', 'noto-sans-400'] : ['noto-sans-400', 'noto-sans-700']
  return [...weighted, 'noto-arabic', 'noto-devanagari', 'noto-hebrew', 'noto-thai']
}

interface ParsedFont {
  bytes: Uint8Array
  covers: (codePoint: number) => boolean
}

/**
 * Font bytes and their parsed glyph coverage do not depend on the output
 * document, so they are cached for the lifetime of the module rather than
 * re-parsed on every export.
 */
const parsedFonts = new Map<string, Promise<ParsedFont>>()

function parseFont(key: string): Promise<ParsedFont> {
  const cached = parsedFonts.get(key)
  if (cached) return cached
  const parsing = Promise.all([bundledFont(key).load(), loadFontkit()]).then(([bytes, fontkit]) => {
    const font = fontkit.create(bytes) as { hasGlyphForCodePoint?: (codePoint: number) => boolean; characterSet?: number[] }
    if (typeof font.hasGlyphForCodePoint === 'function') {
      const has = font.hasGlyphForCodePoint.bind(font)
      return { bytes, covers: (codePoint: number) => has(codePoint) }
    }
    const characterSet = new Set(font.characterSet ?? [])
    return { bytes, covers: (codePoint: number) => characterSet.has(codePoint) }
  })
  parsedFonts.set(key, parsing)
  return parsing
}

function codePoints(text: string): number[] {
  return Array.from(text, (character) => character.codePointAt(0) ?? 0)
}

/**
 * The standard 14 fonts are not embedded, so a viewer substitutes its own face
 * (Poppler uses Nimbus Sans for Helvetica). Substituted faces agree with the
 * Helvetica metrics for ASCII and the Latin-1 supplement, but not for the
 * cp1252-only range 0x80-0x9F: a `€` drawn as base-14 Helvetica collides with the
 * next character in Poppler because the substituted glyph is wider than the 556
 * advance pdf-lib declares. Those characters therefore go to an embedded font,
 * which carries its own widths and renders identically everywhere. Subsetting
 * keeps that cost at a few kilobytes.
 */
function isSafeForStandardFont(text: string): boolean {
  // pdf-lib splits on line breaks before encoding, so they never reach the encoder.
  const encodable = text.replace(/[\n\r\t]/g, '')
  return codePoints(encodable).every((codePoint) => {
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(codePoint)) return false
    const isAscii = codePoint >= 0x20 && codePoint <= 0x7e
    const isLatin1Supplement = codePoint >= 0xa0 && codePoint <= 0xff
    return isAscii || isLatin1Supplement
  })
}

function describeUnsupported(text: string, missing: number[]): string {
  const characters = [...new Set(missing)].slice(0, 6).map((codePoint) => String.fromCodePoint(codePoint)).join(' ')
  return `LeafPDF cannot embed a font for "${text}". These characters are not in any bundled font: ${characters}. `
    + 'Latin, Greek, Cyrillic, Arabic, Devanagari, Hebrew, and Thai are supported; scripts such as Chinese, Japanese, and Korean are not yet.'
}

export async function createFontRegistry(document: PDFDocument): Promise<FontRegistry> {
  const embedded = new Map<string, Promise<PDFFont>>()
  let fontkitRegistered = false

  const embed = (key: string, embedder: () => Promise<PDFFont>): Promise<PDFFont> => {
    const cached = embedded.get(key)
    if (cached) return cached
    const embedding = embedder()
    embedded.set(key, embedding)
    return embedding
  }

  return {
    async fontFor({
      text,
      fontFamily,
      fontWeight,
      fontStyle = 'normal',
    }) {
      const wanted = codePoints(text)

      // Ordinary Latin text keeps using the standard 14 fonts, so it embeds no
      // font file at all.
      if (isSafeForStandardFont(text)) {
        const standard = STANDARD_FONTS[fontFamily][fontStyle][fontWeight]
        return embed(`standard:${standard}`, () => document.embedFont(standard))
      }

      let closestMissing: number[] | null = null
      for (const key of candidateKeys(fontWeight)) {
        const parsed = await parseFont(key)
        const missing = wanted.filter((codePoint) => !parsed.covers(codePoint))
        if (missing.length === 0) {
          return embed(`bundled:${key}`, async () => {
            if (!fontkitRegistered) {
              document.registerFontkit(await loadFontkit())
              fontkitRegistered = true
            }
            return document.embedFont(parsed.bytes, { subset: true })
          })
        }
        if (!closestMissing || missing.length < closestMissing.length) closestMissing = missing
      }
      throw new Error(describeUnsupported(text, closestMissing ?? wanted))
    },
  }
}
