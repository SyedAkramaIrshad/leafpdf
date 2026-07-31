import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, type PDFContext } from 'pdf-lib'
import type { EditorDocument } from '../model/editor'
import { NO_SOURCE_FEATURES, type SourcePdfFeatures } from './sourceFeatures'

export { describeFeatures, NO_SOURCE_FEATURES, type SourcePdfFeatures } from './sourceFeatures'

/**
 * `preserve` mutates the source document, keeping every structural feature.
 * `rebuild-safe` copies pages into a new document, which is only acceptable when
 * the source has no catalog feature to lose. `requires-confirmation` means the
 * requested page operation would drop or invalidate something, so the user has to
 * accept a compatibility copy first.
 */
export type ExportStrategy = 'preserve' | 'rebuild-safe' | 'requires-confirmation'

function lookupDict(context: PDFContext, value: unknown): PDFDict | undefined {
  if (value instanceof PDFDict) return value
  if (value instanceof PDFRef) {
    const resolved = context.lookup(value)
    return resolved instanceof PDFDict ? resolved : undefined
  }
  return undefined
}

function lookupArray(context: PDFContext, value: unknown): PDFArray | undefined {
  if (value instanceof PDFArray) return value
  if (value instanceof PDFRef) {
    const resolved = context.lookup(value)
    return resolved instanceof PDFArray ? resolved : undefined
  }
  return undefined
}

/**
 * Only user-authored metadata counts. `/Producer` and `/Creator` name the writing
 * tool — pdf-lib stamps them into every document it creates — and the exporter
 * legitimately replaces `/Producer` with LeafPDF, so their presence says nothing
 * about whether an export would lose something the user cares about. The rebuild
 * path still copies `/Creator` across when it exists.
 */
function hasAnyMetadata(document: PDFDocument): boolean {
  const values = [
    document.getTitle(),
    document.getAuthor(),
    document.getSubject(),
    document.getKeywords(),
  ]
  return values.some((value) => typeof value === 'string' && value.trim().length > 0)
}

/**
 * An outline *root* is not an outline. Several writers (pypdf among them) create an
 * empty `/Outlines` dictionary in every document they produce, so testing for the
 * key alone would demand a compatibility copy for documents that have no bookmarks
 * to lose. Real bookmarks have a `/First` child, or a positive `/Count`.
 */
function hasOutlineEntries(document: PDFDocument): boolean {
  const outlines = lookupDict(document.context, document.catalog.get(PDFName.of('Outlines')))
  if (!outlines) return false
  if (outlines.get(PDFName.of('First')) !== undefined) return true
  const count = outlines.get(PDFName.of('Count'))
  return count instanceof PDFNumber && count.asNumber() > 0
}

/**
 * Attachments live at catalog `/Names` -> `/EmbeddedFiles`. A `/Names` tree on its
 * own is not evidence: named destinations use the same parent dictionary.
 */
function hasEmbeddedFiles(document: PDFDocument): boolean {
  const names = lookupDict(document.context, document.catalog.get(PDFName.of('Names')))
  if (!names) return false
  const embeddedFiles = lookupDict(document.context, names.get(PDFName.of('EmbeddedFiles')))
  return embeddedFiles !== undefined
}

/** Walks `/AcroForm` `/Fields`, including `/Kids`, looking for `/FT /Sig`. */
function hasSignatureField(document: PDFDocument, acroForm: PDFDict): boolean {
  const context = document.context
  const seen = new Set<string>()

  const walk = (fields: PDFArray | undefined, depth: number): boolean => {
    if (!fields || depth > 8) return false
    for (let index = 0; index < fields.size(); index += 1) {
      const entry = fields.get(index)
      const key = entry instanceof PDFRef ? entry.toString() : `inline-${depth}-${index}`
      if (seen.has(key)) continue
      seen.add(key)
      const field = lookupDict(context, entry)
      if (!field) continue
      const fieldType = field.get(PDFName.of('FT'))
      if (fieldType instanceof PDFName && fieldType.asString() === '/Sig') return true
      if (walk(lookupArray(context, field.get(PDFName.of('Kids'))), depth + 1)) return true
    }
    return false
  }

  return walk(lookupArray(context, acroForm.get(PDFName.of('Fields'))), 0)
}

/**
 * Catalog entries a rebuild cannot carry across, because they are keyed by page
 * index, point at specific pages, or are opaque to LeafPDF. Presence of any of
 * these means a page reorder or deletion must be confirmed by the user first.
 *
 * Deliberately excluded, because `exportByRebuilding` copies them instead of warning
 * about them: `/PageMode`, `/PageLayout`, and `/Lang` are single direct objects that
 * do not depend on page order.
 */
const BLOCKING_CATALOG_ENTRIES: Array<[string, string]> = [
  ['StructTreeRoot', 'Tagged-PDF structure (accessibility)'],
  ['PageLabels', 'Custom page numbering'],
  ['OCProperties', 'Optional content layers'],
  ['OpenAction', 'An action that runs when the file opens'],
  ['AA', 'Additional document actions'],
  ['Dests', 'Named destinations'],
  ['Threads', 'Article threads'],
  ['Collection', 'Portfolio collection'],
  ['Requirements', 'Viewer requirements'],
  ['SpiderInfo', 'Web capture information'],
  ['Perms', 'Document permissions'],
  ['Legal', 'Legal attestations'],
  // Held indirectly, so exportByRebuilding cannot copy them without rewriting the
  // object graph. Disclosed rather than silently dropped.
  ['Metadata', 'XMP metadata'],
  ['ViewerPreferences', 'Viewer preferences'],
]

/** Sub-trees of catalog `/Names` that a rebuild would drop. */
const BLOCKING_NAME_TREES: Array<[string, string]> = [
  ['Dests', 'Named destinations'],
  ['JavaScript', 'Document JavaScript'],
  ['AP', 'Named appearance streams'],
  ['Templates', 'Named page templates'],
]

/**
 * True when a link annotation targets a page rather than an external resource.
 *
 * A `/Dest` is a page destination by definition. An `/A` action only matters when it
 * navigates within the document: `/GoTo` does, `/URI` does not, so an ordinary web
 * link must not trigger a confirmation.
 */
function linkTargetsAPage(context: PDFContext, annotation: PDFDict): boolean {
  if (annotation.get(PDFName.of('Dest')) !== undefined) return true
  const action = lookupDict(context, annotation.get(PDFName.of('A')))
  if (!action) return false
  const kind = action.get(PDFName.of('S'))
  if (!(kind instanceof PDFName)) return false
  // /GoTo is same-document navigation. /GoToR and /GoToE leave this file, so their
  // targets are unaffected by reordering pages here.
  return kind.asString() === '/GoTo'
}

/**
 * Internal links live on pages, not in the catalog, so a catalog-only scan missed
 * them entirely: a link to a page that is later deleted or moved is left pointing at
 * the wrong page, or at an orphaned reference.
 */
function hasInternalPageLinks(document: PDFDocument): boolean {
  const context = document.context
  for (const page of document.getPages()) {
    const annotations = lookupArray(context, page.node.get(PDFName.of('Annots')))
    if (!annotations) continue
    for (let index = 0; index < annotations.size(); index += 1) {
      const annotation = lookupDict(context, annotations.get(index))
      if (!annotation) continue
      const subtype = annotation.get(PDFName.of('Subtype'))
      if (!(subtype instanceof PDFName) || subtype.asString() !== '/Link') continue
      if (linkTargetsAPage(context, annotation)) return true
    }
  }
  return false
}

function additionalCatalogFeatures(document: PDFDocument): string[] {
  const found = new Set<string>()
  for (const [key, label] of BLOCKING_CATALOG_ENTRIES) {
    if (document.catalog.get(PDFName.of(key)) !== undefined) found.add(label)
  }
  const names = lookupDict(document.context, document.catalog.get(PDFName.of('Names')))
  if (names) {
    for (const [key, label] of BLOCKING_NAME_TREES) {
      if (names.get(PDFName.of(key)) !== undefined) found.add(label)
    }
  }
  // Page-level, not catalog-level, so this needs its own walk.
  if (hasInternalPageLinks(document)) found.add('Links between pages')
  return [...found]
}

/**
 * Inspect a source PDF for the catalog-level features an export must not silently
 * discard. Damaged bytes report no features rather than throwing, because the
 * caller still needs a strategy decision.
 */
export async function analyzeSourcePdf(bytes: Uint8Array): Promise<SourcePdfFeatures> {
  let document: PDFDocument
  try {
    document = await PDFDocument.load(bytes.slice(), { ignoreEncryption: false, updateMetadata: false })
  } catch {
    return { ...NO_SOURCE_FEATURES }
  }
  return analyzeLoadedPdf(document)
}

/**
 * The same inspection against an already-parsed document, so the exporter does not
 * have to parse the same bytes a second time just to decide on a strategy.
 */
export function analyzeLoadedPdf(document: PDFDocument): SourcePdfFeatures {
  const acroForm = lookupDict(document.context, document.catalog.get(PDFName.of('AcroForm')))
  return {
    hasMetadata: hasAnyMetadata(document),
    hasOutlines: hasOutlineEntries(document),
    hasAttachments: hasEmbeddedFiles(document),
    hasAcroForm: acroForm !== undefined,
    hasDigitalSignatures: acroForm ? hasSignatureField(document, acroForm) : false,
    additionalFeatures: additionalCatalogFeatures(document),
  }
}

/**
 * True when the edited pages are every original page in the original order.
 *
 * The page count is part of the question. Checking only that each remaining page sits
 * at its own source index reports "unchanged" after a trailing page is deleted, which
 * skipped the confirmation gate for exactly that case.
 */
function keepsEveryPageInOrder(document: EditorDocument, sourcePageCount: number): boolean {
  return document.pages.length === sourcePageCount
    && document.pages.every((page, index) => page.sourceIndex === index)
}

function hasStructuralReferences(features: SourcePdfFeatures): boolean {
  return features.hasOutlines
    || features.hasAttachments
    || features.hasAcroForm
    || features.hasDigitalSignatures
    || (features.additionalFeatures?.length ?? 0) > 0
}

export function chooseExportStrategy(
  features: SourcePdfFeatures,
  document: EditorDocument,
  sourcePageCount: number = document.pages.length,
): ExportStrategy {
  // Every original page, original order: mutate the source and keep everything.
  if (keepsEveryPageInOrder(document, sourcePageCount)) return 'preserve'

  // Pages only removed, order otherwise intact. Removal can be done in place, but
  // outlines, form fields, attachments, and signatures may reference a removed
  // page, so a structured document needs confirmation first.
  const sourceIndexes = document.pages.map((page) => page.sourceIndex)
  const ascending = sourceIndexes.every((value, index) => index === 0 || value > sourceIndexes[index - 1])
  if (ascending) return hasStructuralReferences(features) ? 'requires-confirmation' : 'preserve'

  // Reordered: only a rebuild can express the new order, and a rebuild cannot
  // carry catalog features across.
  return hasStructuralReferences(features) ? 'requires-confirmation' : 'rebuild-safe'
}

