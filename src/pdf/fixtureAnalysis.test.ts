import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzeSourcePdf } from './sourceAnalysis'
import type { SourcePdfFeatures } from './sourceFeatures'

/**
 * Detection has to hold against PDFs written by other tools, not only ones built
 * with pdf-lib inside a test. These fixtures come from ReportLab and pypdf, which
 * is how the empty-`/Outlines`-root false positive was caught.
 *
 * Generate them with `scripts/create-edge-fixtures.py`. Absent fixtures skip rather
 * than fail, so a fresh clone can still run `npm test`.
 */
const FIXTURE_DIR = 'tmp/pdfs'
const fixturesPresent = existsSync(`${FIXTURE_DIR}/edge-metadata.pdf`)

const CASES: Array<[string, Partial<SourcePdfFeatures>]> = [
  ['edge-metadata.pdf', {
    hasMetadata: true, hasOutlines: false, hasAttachments: false,
    hasAcroForm: false, hasDigitalSignatures: false,
  }],
  ['edge-outlines.pdf', { hasMetadata: true, hasOutlines: true, hasAcroForm: false, hasDigitalSignatures: false }],
  ['edge-attachment.pdf', { hasAttachments: true, hasOutlines: false }],
  ['edge-form.pdf', { hasAcroForm: true, hasDigitalSignatures: false, hasOutlines: false }],
  ['edge-signature-field.pdf', { hasAcroForm: true, hasDigitalSignatures: true, hasOutlines: false }],
  ['edge-orientation.pdf', { hasOutlines: false, hasAcroForm: false, hasAttachments: false }],
  ['edge-100-pages.pdf', {
    hasOutlines: false, hasAttachments: false, hasAcroForm: false, hasDigitalSignatures: false,
  }],
]

describe.skipIf(!fixturesPresent)('analyzeSourcePdf against generated fixtures', () => {
  for (const [name, expected] of CASES) {
    it(`reads ${name} correctly`, async () => {
      const path = `${FIXTURE_DIR}/${name}`
      if (!existsSync(path)) throw new Error(`Missing ${path}. Run scripts/create-edge-fixtures.py.`)
      expect(await analyzeSourcePdf(new Uint8Array(readFileSync(path)))).toMatchObject(expected)
    })
  }
})
