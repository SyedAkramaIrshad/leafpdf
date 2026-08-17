"""Generate deterministic edge-case PDF fixtures for LeafPDF verification.

Every fixture is byte-stable across runs: creation dates are pinned so a rebuilt
fixture does not invalidate a previously recorded verification.

Install ReportLab and pypdf in your Python environment, then run:

    python3 scripts/create-edge-fixtures.py
"""

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    TextStringObject,
)

OUTPUT_DIR = Path("tmp/pdfs")
PINNED_DATE = "D:20260101000000Z"


def _pin(canvas: Canvas) -> None:
    """Make output byte-stable so fixtures do not churn between runs."""
    canvas.setCreationDate = lambda: None  # type: ignore[method-assign]
    canvas._doc.info.creationDate = PINNED_DATE
    canvas._doc.info.modDate = PINNED_DATE


def _labelled_page(canvas: Canvas, title: str, note: str, pagesize) -> None:
    canvas.setPageSize(pagesize)
    width, height = pagesize
    canvas.setFillColor(HexColor("#182026"))
    canvas.setFont("Helvetica-Bold", 24)
    canvas.drawString(48, height - 70, title)
    canvas.setFont("Helvetica", 12)
    canvas.setFillColor(HexColor("#4D5556"))
    canvas.drawString(48, height - 100, note)
    # A corner marker on every page makes clipping and rotation errors obvious.
    canvas.setFillColor(HexColor("#3157D5"))
    canvas.rect(20, height - 34, 14, 14, stroke=0, fill=1)
    canvas.setFillColor(HexColor("#F26B4A"))
    canvas.rect(width - 34, 20, 14, 14, stroke=0, fill=1)
    canvas.setFillColor(HexColor("#182026"))
    canvas.setFont("Helvetica", 10)
    canvas.drawString(48, 40, "Baseline anchor text at the page bottom-left.")
    canvas.showPage()


def build_orientation_fixture(path: Path) -> None:
    """Portrait and landscape pages carrying each /Rotate value."""
    canvas = Canvas(str(path), pagesize=A4)
    _pin(canvas)
    _labelled_page(canvas, "Portrait page", "Rotation 0 expected.", A4)
    _labelled_page(canvas, "Landscape page", "Rotation 0 expected.", landscape(A4))
    canvas.save()

    reader = PdfReader(str(path))
    writer = PdfWriter()
    # Four copies of the portrait page, one per /Rotate value, then the landscape page.
    for rotation in (0, 90, 180, 270):
        page = PdfReader(str(path)).pages[0]
        page.rotate(rotation)
        writer.add_page(page)
    writer.add_page(reader.pages[1])
    _write(writer, path)


def build_unicode_fixture(path: Path) -> None:
    """Selectable Latin text plus a note about scripts LeafPDF cannot embed."""
    canvas = Canvas(str(path), pagesize=A4)
    _pin(canvas)
    width, height = A4
    canvas.setFillColor(HexColor("#182026"))
    canvas.setFont("Helvetica-Bold", 22)
    canvas.drawString(48, height - 70, "Unicode replacement targets")
    canvas.setFont("Helvetica", 13)
    for index, label in enumerate([
        "Replace me with Arabic",
        "Replace me with Devanagari",
        "Replace me with Cyrillic",
        "Replace me with an em dash and Euro",
        "Replace me with Chinese to prove export is refused",
    ]):
        canvas.drawString(48, height - 120 - index * 30, label)
    canvas.save()


def build_style_fixture(path: Path) -> None:
    """Embedded custom faces and colours used by the edit-style round trip."""
    regular_path = Path("src/assets/fonts/NotoSans-Regular.ttf")
    bold_path = Path("src/assets/fonts/NotoSans-Bold.ttf")
    pdfmetrics.registerFont(TTFont("LeafPDFNoto", regular_path))
    pdfmetrics.registerFont(TTFont("LeafPDFNotoBold", bold_path))

    canvas = Canvas(str(path), pagesize=A4)
    _pin(canvas)
    _, height = A4
    canvas.setFillColor(HexColor("#3157D5"))
    canvas.setFont("LeafPDFNoto", 15)
    canvas.drawString(48, height - 90, "Custom blue regular")
    canvas.setFillColor(HexColor("#F26B4A"))
    canvas.setFont("LeafPDFNotoBold", 15)
    canvas.drawString(48, height - 130, "Custom coral bold")
    canvas.save()


def build_metadata_fixture(path: Path) -> None:
    canvas = Canvas(str(path), pagesize=A4)
    _pin(canvas)
    canvas.setTitle("Preserve me")
    canvas.setAuthor("Syed")
    canvas.setSubject("Metadata preservation")
    canvas.setKeywords("leafpdf export metadata")
    _labelled_page(canvas, "Metadata fixture", "Title, author, subject, keywords set.", A4)
    _labelled_page(canvas, "Second page", "Used for reorder and delete tests.", A4)
    canvas.save()


def build_outline_fixture(path: Path) -> None:
    """Metadata plus bookmarks, so reordering must require confirmation."""
    build_metadata_fixture(path)
    reader = PdfReader(str(path))
    writer = PdfWriter()
    writer.append(reader)
    writer.add_outline_item("First section", 0)
    writer.add_outline_item("Second section", 1)
    _write(writer, path)


def build_attachment_fixture(path: Path) -> None:
    build_metadata_fixture(path)
    reader = PdfReader(str(path))
    writer = PdfWriter()
    writer.append(reader)
    writer.add_attachment("note.txt", b"LeafPDF attachment fixture.\n")
    _write(writer, path)


def build_form_fixture(path: Path) -> None:
    """An AcroForm text field, so page operations must require confirmation."""
    build_metadata_fixture(path)
    reader = PdfReader(str(path))
    writer = PdfWriter()
    writer.append(reader)

    field = DictionaryObject()
    field.update({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/FT"): NameObject("/Tx"),
        NameObject("/T"): TextStringObject("owner.name"),
        NameObject("/V"): TextStringObject(""),
        NameObject("/Rect"): ArrayObject([NumberObject(x) for x in (60, 520, 300, 548)]),
        NameObject("/F"): NumberObject(4),
    })
    field_ref = writer._add_object(field)
    page = writer.pages[0]
    field[NameObject("/P")] = page.indirect_reference
    page[NameObject("/Annots")] = ArrayObject([field_ref])

    acro_form = DictionaryObject()
    acro_form.update({
        NameObject("/Fields"): ArrayObject([field_ref]),
        NameObject("/DA"): TextStringObject("/Helv 0 Tf 0 g"),
    })
    writer._root_object[NameObject("/AcroForm")] = writer._add_object(acro_form)
    _write(writer, path)


def build_signature_fixture(path: Path) -> None:
    """A signature *field*, enough for detection; it is not a real signature."""
    build_metadata_fixture(path)
    reader = PdfReader(str(path))
    writer = PdfWriter()
    writer.append(reader)

    field = DictionaryObject()
    field.update({
        NameObject("/Type"): NameObject("/Annot"),
        NameObject("/Subtype"): NameObject("/Widget"),
        NameObject("/FT"): NameObject("/Sig"),
        NameObject("/T"): TextStringObject("Signature1"),
        NameObject("/Rect"): ArrayObject([NumberObject(x) for x in (60, 100, 300, 160)]),
        NameObject("/F"): NumberObject(4),
    })
    field_ref = writer._add_object(field)
    page = writer.pages[0]
    field[NameObject("/P")] = page.indirect_reference
    page[NameObject("/Annots")] = ArrayObject([field_ref])

    acro_form = DictionaryObject()
    acro_form.update({
        NameObject("/Fields"): ArrayObject([field_ref]),
        NameObject("/SigFlags"): NumberObject(3),
    })
    writer._root_object[NameObject("/AcroForm")] = writer._add_object(acro_form)
    _write(writer, path)


def build_encrypted_fixture(path: Path) -> None:
    """Permissions-only encryption: an empty user password, as most locked PDFs
    in the wild use. Viewers open it without a prompt; the objects are still
    genuinely encrypted, so LeafPDF must refuse to export it and say why."""
    build_metadata_fixture(path)
    reader = PdfReader(str(path))
    writer = PdfWriter()
    writer.append(reader)
    writer.encrypt(user_password="", owner_password="leafpdf-owner")
    _write(writer, path)


def build_scanned_fixture(path: Path) -> None:
    """An image-only page: no selectable text, so the OCR message must appear."""
    canvas = Canvas(str(path), pagesize=A4)
    _pin(canvas)
    width, height = A4
    # Draw shapes only. Text drawn as vectors would still not be extractable.
    canvas.setFillColor(HexColor("#EDE8DC"))
    canvas.rect(0, 0, width, height, stroke=0, fill=1)
    canvas.setFillColor(HexColor("#8A8578"))
    for row in range(14):
        y = height - 120 - row * 26
        canvas.rect(60, y, width - 120 - (row % 4) * 40, 9, stroke=0, fill=1)
    canvas.save()


def build_large_fixture(path: Path, pages: int = 100) -> None:
    """Many pages, to prove the UI stays responsive during export."""
    canvas = Canvas(str(path), pagesize=A4)
    _pin(canvas)
    for index in range(pages):
        _labelled_page(canvas, f"Page {index + 1} of {pages}", "Large-document responsiveness fixture.", A4)
    canvas.save()


def build_empty_text_fixture(path: Path) -> None:
    """A page whose only text is whitespace, exercising the box filters."""
    canvas = Canvas(str(path), pagesize=A4)
    _pin(canvas)
    canvas.setFont("Helvetica", 12)
    canvas.drawString(60, 700, "    ")
    canvas.save()


def _write(writer: PdfWriter, path: Path) -> None:
    writer.add_metadata({
        "/Title": "Preserve me",
        "/Author": "Syed",
        "/Subject": "Metadata preservation",
        "/Keywords": "leafpdf export metadata",
        "/CreationDate": PINNED_DATE,
        "/ModDate": PINNED_DATE,
    })
    with path.open("wb") as handle:
        writer.write(handle)


FIXTURES = {
    "edge-orientation.pdf": build_orientation_fixture,
    "edge-unicode.pdf": build_unicode_fixture,
    "edge-styles.pdf": build_style_fixture,
    "edge-metadata.pdf": build_metadata_fixture,
    "edge-outlines.pdf": build_outline_fixture,
    "edge-attachment.pdf": build_attachment_fixture,
    "edge-form.pdf": build_form_fixture,
    "edge-signature-field.pdf": build_signature_fixture,
    "edge-encrypted.pdf": build_encrypted_fixture,
    "edge-scanned.pdf": build_scanned_fixture,
    "edge-whitespace-text.pdf": build_empty_text_fixture,
    "edge-100-pages.pdf": build_large_fixture,
}


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, build in FIXTURES.items():
        path = OUTPUT_DIR / name
        build(path)
        print(f"{path} ({path.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
