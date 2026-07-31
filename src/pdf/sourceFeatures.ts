/**
 * The feature record and its pure helpers live apart from `sourceAnalysis`, which
 * needs pdf-lib to detect them. The UI only ever describes features, so keeping
 * these separate keeps pdf-lib out of the main-thread bundle entirely.
 */
export interface SourcePdfFeatures {
  hasMetadata: boolean
  hasOutlines: boolean
  hasAttachments: boolean
  hasAcroForm: boolean
  hasDigitalSignatures: boolean
  /**
   * Human-readable names of any other catalog features found that a rebuild cannot
   * carry across — either because they are keyed by page index, because they point
   * at specific pages, or because they are opaque to LeafPDF. Kept as a list rather
   * than more booleans so new entries do not change the shape of this record.
   */
  additionalFeatures: string[]
}

export const NO_SOURCE_FEATURES: SourcePdfFeatures = {
  hasMetadata: false,
  hasOutlines: false,
  hasAttachments: false,
  hasAcroForm: false,
  hasDigitalSignatures: false,
  additionalFeatures: [],
}

/** Human-readable names for the features a compatibility copy would lose. */
export function describeFeatures(features: SourcePdfFeatures): string[] {
  const described: string[] = []
  if (features.hasOutlines) described.push('Bookmarks and outline entries')
  if (features.hasAcroForm) described.push('Interactive form fields')
  if (features.hasAttachments) described.push('Embedded file attachments')
  if (features.hasDigitalSignatures) described.push('An existing digital signature')
  described.push(...(features.additionalFeatures ?? []))
  return described
}
