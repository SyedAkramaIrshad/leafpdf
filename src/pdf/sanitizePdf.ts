import { PDFDocument, PDFName } from 'pdf-lib'

export interface SanitizeOptions {
  removePageAnnotations?: boolean
  keepDocumentMetadata?: boolean
}

/**
 * Rebuild a PDF into a fresh catalog. This intentionally drops attachments,
 * forms, JavaScript/actions, outlines, optional-content configuration, XMP,
 * signatures, and every other catalog object that is not explicitly recreated.
 * Page annotations are removed by default as a separate privacy boundary.
 */
export async function sanitizePdfBytes(
  sourceBytes: Uint8Array,
  options: SanitizeOptions = {},
): Promise<Uint8Array> {
  const source = await PDFDocument.load(sourceBytes.slice(), {
    ignoreEncryption: false,
    updateMetadata: false,
  })

  // Widgets are page annotations. Removing `/Annots` without flattening first
  // would erase visible values from filled forms. Flatten only when an AcroForm
  // actually exists; calling `getForm()` on a formless PDF creates one.
  if (source.catalog.get(PDFName.of('AcroForm')) !== undefined) {
    source.getForm().flatten()
  }

  const output = await PDFDocument.create()
  const sourcePages = source.getPages()
  const copiedPages = await output.copyPages(source, sourcePages.map((_, index) => index))
  for (const copied of copiedPages) {
    if (options.removePageAnnotations !== false) copied.node.delete(PDFName.of('Annots'))
    output.addPage(copied)
  }

  if (options.keepDocumentMetadata) {
    const title = source.getTitle()
    const author = source.getAuthor()
    const subject = source.getSubject()
    const keywords = source.getKeywords()
    const creator = source.getCreator()
    const creationDate = source.getCreationDate()
    if (title) output.setTitle(title)
    if (author) output.setAuthor(author)
    if (subject) output.setSubject(subject)
    if (keywords) output.setKeywords(keywords.split(/[,\s]+/).filter(Boolean))
    if (creator) output.setCreator(creator)
    if (creationDate) output.setCreationDate(creationDate)
  }

  output.setProducer('LeafPDF sanitized copy')
  output.setModificationDate(new Date())
  return output.save()
}
