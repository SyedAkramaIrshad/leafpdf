"""Structurally verify a LeafPDF export against its source, then render every page.

    python3 scripts/verify_export.py <source.pdf> <exported.pdf> [--render-dir DIR]

Exits non-zero on any structural or render failure, so it can gate a release.

Checks performed:
  * The exported file opens and reports a positive page count.
  * Page count is consistent with a page-preserving or page-removing edit.
  * Page rotations are all legal multiples of 90.
  * `/Producer` is LeafPDF, proving the file came from this exporter.
  * When the export kept every source page, user metadata must survive, and any
    AcroForm fields and embedded attachments in the source must still be present.
  * Every page renders through Poppler's pdftoppm with a zero exit code and
    produces a non-empty, non-blank PNG.

Install pypdf and Poppler, ensure `pdftoppm` is on PATH, then run:

    python3 scripts/verify_export.py tmp/pdfs/mvp-fixture.pdf output/pdf/mvp-fixture-edited.pdf
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from pypdf import PdfReader

METADATA_KEYS = ("/Title", "/Author", "/Subject", "/Keywords")


class Failure(Exception):
    """A verification check that did not hold."""


def _catalog(reader: PdfReader):
    return reader.trailer["/Root"]


def _has_real_outlines(reader: PdfReader) -> bool:
    """An empty `/Outlines` root is not a bookmark; many writers emit one."""
    root = _catalog(reader)
    if "/Outlines" not in root:
        return False
    outlines = root["/Outlines"].get_object()
    if "/First" in outlines:
        return True
    return int(outlines.get("/Count", 0) or 0) > 0


def _attachment_names(reader: PdfReader) -> set[str]:
    root = _catalog(reader)
    if "/Names" not in root:
        return set()
    names = root["/Names"].get_object()
    if "/EmbeddedFiles" not in names:
        return set()
    embedded = names["/EmbeddedFiles"].get_object()
    entries = embedded.get("/Names", [])
    # /Names is a flat [name, value, name, value, ...] array.
    return {str(entries[index]) for index in range(0, len(entries), 2)}


def _field_names(reader: PdfReader) -> set[str]:
    try:
        fields = reader.get_fields() or {}
    except Exception:  # noqa: BLE001 - a damaged form must not crash the check
        return set()
    return set(fields.keys())


def check_structure(source_path: Path, export_path: Path, compatibility_copy: bool = False) -> list[str]:
    notes: list[str] = []
    source = PdfReader(str(source_path))
    export = PdfReader(str(export_path))

    source_pages = len(source.pages)
    export_pages = len(export.pages)
    if export_pages < 1:
        raise Failure("the exported PDF has no pages")
    if export_pages > source_pages:
        raise Failure(f"export has more pages ({export_pages}) than the source ({source_pages})")
    notes.append(f"pages: source {source_pages} -> export {export_pages}")

    rotations = [int(page.get("/Rotate", 0) or 0) % 360 for page in export.pages]
    illegal = [value for value in rotations if value not in (0, 90, 180, 270)]
    if illegal:
        raise Failure(f"illegal page rotations: {illegal}")
    notes.append(f"rotations: {rotations}")

    producer = (export.metadata or {}).get("/Producer")
    if producer != "LeafPDF":
        raise Failure(f"expected /Producer 'LeafPDF', found {producer!r}")
    notes.append("producer: LeafPDF")

    preserved_every_page = export_pages == source_pages
    if not preserved_every_page:
        notes.append("page count changed, so catalog features are not required to survive")
        return notes

    source_metadata = source.metadata or {}
    if compatibility_copy:
        # A disclosed compatibility copy is allowed to lose outlines, forms, and
        # attachments: that is exactly what the user accepted. Metadata must still
        # be copied across explicitly, so that is still checked below.
        export_metadata = export.metadata or {}
        for key in METADATA_KEYS:
            expected = source_metadata.get(key)
            if expected in (None, ""):
                continue
            if export_metadata.get(key) != expected:
                raise Failure(f"metadata {key} was {expected!r} in the source but {export_metadata.get(key)!r} in the compatibility copy")
        notes.append("compatibility copy: metadata copied, catalog features intentionally not required")
        return notes

    export_metadata = export.metadata or {}
    for key in METADATA_KEYS:
        expected = source_metadata.get(key)
        if expected in (None, ""):
            continue
        if export_metadata.get(key) != expected:
            raise Failure(f"metadata {key} was {expected!r} in the source but {export_metadata.get(key)!r} in the export")
    notes.append(f"metadata preserved: {[k for k in METADATA_KEYS if source_metadata.get(k)] or 'none set'}")

    missing_fields = _field_names(source) - _field_names(export)
    if missing_fields:
        raise Failure(f"AcroForm fields lost: {sorted(missing_fields)}")
    if _field_names(source):
        notes.append(f"form fields preserved: {sorted(_field_names(source))}")

    missing_attachments = _attachment_names(source) - _attachment_names(export)
    if missing_attachments:
        raise Failure(f"attachments lost: {sorted(missing_attachments)}")
    if _attachment_names(source):
        notes.append(f"attachments preserved: {sorted(_attachment_names(source))}")

    if _has_real_outlines(source) and not _has_real_outlines(export):
        raise Failure("source bookmarks are missing from the export")
    if _has_real_outlines(source):
        notes.append("outlines preserved")

    return notes


def check_render(export_path: Path, render_dir: Path) -> list[str]:
    if shutil.which("pdftoppm") is None:
        raise Failure("pdftoppm is not on PATH; add Poppler's bin directory")

    render_dir.mkdir(parents=True, exist_ok=True)
    for existing in render_dir.glob("page-*.png"):
        existing.unlink()

    completed = subprocess.run(
        ["pdftoppm", "-r", "72", "-png", str(export_path), str(render_dir / "page")],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise Failure(f"pdftoppm exited {completed.returncode}: {completed.stderr.strip()}")

    rendered = sorted(render_dir.glob("page-*.png"))
    expected = len(PdfReader(str(export_path)).pages)
    if len(rendered) != expected:
        raise Failure(f"rendered {len(rendered)} PNGs for {expected} pages")

    empty = [path.name for path in rendered if path.stat().st_size == 0]
    if empty:
        raise Failure(f"empty render files: {empty}")

    blank = [path.name for path in rendered if _is_blank(path)]
    if blank:
        raise Failure(f"pages rendered blank: {blank}")

    return [
        f"rendered {len(rendered)} page(s) to {render_dir}, none blank",
    ] + [f"  {path}" for path in rendered]


def _is_blank(path: Path) -> bool:
    """
    True when a rendered page carries no ink.

    File size is not evidence: a blank A4 page at 72 dpi compresses to well over a
    kilobyte, so a size threshold passes blank pages. This inspects pixels instead
    and asks how many differ from the page's dominant colour, which is the paper.
    """
    try:
        from PIL import Image
    except ImportError as error:  # noqa: TRY003 - the message is the remediation
        raise Failure(
            "Pillow is required to detect blank pages. Use the bundled runtime, "
            "or install Pillow into the interpreter running this script."
        ) from error

    with Image.open(path) as image:
        grey = image.convert("L")
        histogram = grey.histogram()

    total = sum(histogram)
    if total == 0:
        return True
    paper = max(range(len(histogram)), key=lambda level: histogram[level])
    # Ignore levels within a hair of the paper colour, so JPEG-ish noise and
    # anti-aliasing on the page edge do not read as content.
    ink = sum(count for level, count in enumerate(histogram) if abs(level - paper) > 12)
    # A page with a single short line of text is still well above this.
    return (ink / total) < 0.0002


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a LeafPDF export.")
    parser.add_argument("source", type=Path)
    parser.add_argument("export", type=Path)
    parser.add_argument("--render-dir", type=Path, default=None)
    parser.add_argument(
        "--expect-compatibility-copy",
        action="store_true",
        help=(
            "The export is a disclosed compatibility copy, so outlines, form fields, and "
            "attachments are allowed to be absent. Metadata is still required."
        ),
    )
    args = parser.parse_args()

    for path in (args.source, args.export):
        if not path.is_file():
            print(f"FAIL: missing file {path}", file=sys.stderr)
            return 2

    render_dir = args.render_dir or Path("tmp/pdfs/rendered") / args.export.stem

    try:
        notes = check_structure(args.source, args.export, args.expect_compatibility_copy)
        notes += check_render(args.export, render_dir)
    except Failure as failure:
        print(f"FAIL: {failure}", file=sys.stderr)
        return 1

    print(f"PASS {args.export}")
    for note in notes:
        print(f"  {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
