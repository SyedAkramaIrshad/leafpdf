import type { EditorDocument } from '../model/editor'
import type { SourcePdfFeatures } from '../pdf/sourceFeatures'
import type { OcrPageResult, ReviewComment } from '../project/projectTypes'

export interface PrivacyFinding {
  id: string
  label: string
  detected: boolean
  detail: string
  removedBySanitizedCopy: boolean
}

export interface PrivacyReport {
  findings: PrivacyFinding[]
  knownKeyLimit: string
  canSanitize: boolean
}

export function buildPrivacyReport(
  features: SourcePdfFeatures,
  document: EditorDocument,
  comments: ReviewComment[],
  ocr: OcrPageResult[],
): PrivacyReport {
  const findings: PrivacyFinding[] = [
    {
      id: 'metadata',
      label: 'Document metadata',
      detected: features.hasMetadata,
      detail: features.hasMetadata ? 'Title, author, subject, keywords, or related document metadata is present.' : 'No user-authored document metadata was detected.',
      removedBySanitizedCopy: true,
    },
    {
      id: 'attachments',
      label: 'Embedded files and attachments',
      detected: features.hasAttachments,
      detail: features.hasAttachments ? 'The PDF contains one or more embedded files.' : 'No embedded files were detected.',
      removedBySanitizedCopy: true,
    },
    {
      id: 'forms',
      label: 'Interactive form fields',
      detected: features.hasAcroForm || Object.keys(document.formValues).length > 0,
      detail: features.hasAcroForm ? 'The PDF contains an AcroForm; filled values can remain machine-readable.' : 'No interactive form dictionary was detected.',
      removedBySanitizedCopy: true,
    },
    {
      id: 'signatures',
      label: 'Digital signatures',
      detected: features.hasDigitalSignatures,
      detail: features.hasDigitalSignatures ? 'A signature field is present. Any rebuild invalidates the existing signature.' : 'No signature field was detected.',
      removedBySanitizedCopy: true,
    },
    {
      id: 'bookmarks',
      label: 'Bookmarks and outlines',
      detected: features.hasOutlines,
      detail: features.hasOutlines ? 'The PDF contains outline entries that may reveal document structure.' : 'No outline entries were detected.',
      removedBySanitizedCopy: true,
    },
    {
      id: 'comments',
      label: 'LeafPDF review comments',
      detected: comments.length > 0,
      detail: comments.length > 0 ? `${comments.length} project comment${comments.length === 1 ? '' : 's'} will remain in the editable project but are excluded from a sanitized PDF.` : 'No LeafPDF review comments are present.',
      removedBySanitizedCopy: true,
    },
    {
      id: 'ocr',
      label: 'Local OCR text',
      detected: ocr.some((result) => result.words.length > 0),
      detail: ocr.some((result) => result.words.length > 0) ? 'Recognized text is stored in the editable project. The sanitized PDF contains only the current visible pages.' : 'No local OCR results are stored.',
      removedBySanitizedCopy: true,
    },
    {
      id: 'redactions',
      label: 'Pending permanent redactions',
      detected: document.annotations.some((annotation) => annotation.kind === 'redaction'),
      detail: document.annotations.some((annotation) => annotation.kind === 'redaction') ? 'Redacted pages are rasterized before sanitization so the original covered objects are not copied.' : 'No pending LeafPDF redactions are present.',
      removedBySanitizedCopy: false,
    },
  ]

  for (const [index, feature] of (features.additionalFeatures ?? []).entries()) {
    findings.push({
      id: `additional-${index}`,
      label: feature,
      detected: true,
      detail: 'This known PDF structure is dropped when a sanitized copy rebuilds the catalog.',
      removedBySanitizedCopy: true,
    })
  }

  return {
    findings,
    knownKeyLimit: 'This report checks known PDF structures. It is evidence-based, but it is not a mathematical proof that an unknown or malformed object contains no hidden information.',
    canSanitize: !features.isEncrypted,
  }
}
