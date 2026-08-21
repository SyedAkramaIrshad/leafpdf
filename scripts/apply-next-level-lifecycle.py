from pathlib import Path

path = Path('src/components/NextLevelWorkbench.tsx')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        """import {
  createLeafProject,
  openLeafProject,
  projectFileName,
  serializeLeafProject,
} from '../project/projectFormat'""",
        """import {
  createLeafProject,
  hydrateLeafProject,
  projectFileName,
  serializeLeafProject,
} from '../project/projectFormat'""",
    ),
    (
        "if (annotationControl && NUDGE_KEYS.has(event.key)) {",
        "if (!isEditing && annotationControl && NUDGE_KEYS.has(event.key)) {",
    ),
    (
        """    if (!base || base.signature !== signature) {
      const project = await createLeafProject({
        primaryFile: loaded.sourceFile,
        insertedFiles: Array.from(insertedPdfs, ([id, entry]) => ({ id, file: entry.file })),""",
        """    if (!base || base.signature !== signature) {
      const referencedSourceIds = new Set(
        documentSnapshot.pages.flatMap((page) => page.kind === 'external' ? [page.documentId] : []),
      )
      const project = await createLeafProject({
        primaryFile: loaded.sourceFile,
        insertedFiles: Array.from(insertedPdfs)
          .filter(([id]) => referencedSourceIds.has(id))
          .map(([id, entry]) => ({ id, file: entry.file })),""",
    ),
    (
        """      dispatch({ type: 'markSaved', document: documentSnapshot })
      setNotice(""",
        """      dispatch({ type: 'markSaved', document: documentSnapshot })
      if (latestDocument.current === documentSnapshot && !projectOnlyDirty) {
        setProjectSavedDocument(documentSnapshot)
        await recoveryQueue.current.clear(recoveryKey)
      }
      setNotice(""",
    ),
    (
        "const opened = await openLeafProject(JSON.stringify(recoveryProject))",
        "const opened = await hydrateLeafProject(recoveryProject)",
    ),
    (
        """  const compareWith = async (file: File) => {
    setComparing(true)
    setNotice(null)
    let pdf: PDFDocumentProxy | null = null
    try {
      const { getDocument } = await import('pdfjs-dist')
      pdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
      setComparison(await comparePdfText(loaded.document, pdf))
      setComparisonName(file.name)
    } catch (error) {
      setNotice(error instanceof Error ? `Comparison failed: ${error.message}` : 'Comparison failed.')
    } finally {
      setComparing(false)
      if (pdf) void pdf.loadingTask.destroy().catch(() => undefined)
    }
  }""",
        """  const compareWith = async (file: File) => {
    setComparing(true)
    setNotice(null)
    let comparisonPdf: PDFDocumentProxy | null = null
    let currentPdf: PDFDocumentProxy | null = null
    try {
      const { getDocument } = await import('pdfjs-dist')
      comparisonPdf = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
      if (!loaded.features.isEncrypted) {
        const currentBytes = await buildEditedBytes(state.present, true, false, comments)
        currentPdf = await getDocument({ data: new Uint8Array(currentBytes) }).promise
      }
      setComparison(await comparePdfText(currentPdf ?? loaded.document, comparisonPdf))
      setComparisonName(file.name)
    } catch (error) {
      setNotice(error instanceof Error ? `Comparison failed: ${error.message}` : 'Comparison failed.')
    } finally {
      setComparing(false)
      if (comparisonPdf) void comparisonPdf.loadingTask.destroy().catch(() => undefined)
      if (currentPdf) void currentPdf.loadingTask.destroy().catch(() => undefined)
    }
  }""",
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count == 0:
        if new in text:
            continue
        raise SystemExit(f'Expected lifecycle source pattern was not found:\n{old[:160]}')
    if count != 1:
        raise SystemExit(f'Lifecycle source pattern appeared {count} times; refusing an ambiguous edit.')
    text = text.replace(old, new)

path.write_text(text, encoding='utf-8')
