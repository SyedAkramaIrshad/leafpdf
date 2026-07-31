"""Self-test for scripts/verify_export.py.

A verifier that never fails is worthless, so each check is exercised against a
deliberately broken export and must reject it. Run this whenever verify_export.py
changes; it is part of the release gate.

    python3 scripts/test_verify_export.py

Exits 0 only when every case behaves as expected.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas

VERIFY = Path(__file__).with_name("verify_export.py")
PINNED_DATE = "D:20260101000000Z"


def _source(path: Path, *, blank_second_page: bool) -> None:
    """Page 1 holds a single short line; page 2 is optionally left entirely blank."""
    canvas = Canvas(str(path), pagesize=A4)
    canvas.setTitle("Verifier self-test")
    canvas.setAuthor("Syed")
    canvas._doc.info.creationDate = PINNED_DATE
    canvas._doc.info.modDate = PINNED_DATE
    canvas.setFont("Helvetica", 11)
    canvas.drawString(60, 700, "One short line of text, and nothing else on this page.")
    canvas.showPage()
    if blank_second_page:
        canvas.showPage()
    canvas.save()


def _export(source: Path, target: Path, *, producer: str = "LeafPDF", drop_title: bool = False,
            pages: slice | None = None) -> None:
    reader = PdfReader(str(source))
    writer = PdfWriter()
    for page in reader.pages[pages] if pages else reader.pages:
        writer.add_page(page)
    metadata = {key: value for key, value in (reader.metadata or {}).items()}
    metadata["/Producer"] = producer
    if drop_title:
        metadata.pop("/Title", None)
    writer.add_metadata(metadata)
    with target.open("wb") as handle:
        writer.write(handle)


def run(source: Path, export: Path, *extra: str) -> int:
    completed = subprocess.run(
        [sys.executable, str(VERIFY), str(source), str(export), *extra],
        capture_output=True,
        text=True,
    )
    return completed.returncode


def main() -> int:
    failures: list[str] = []

    def check(name: str, actual: int, expected: int) -> None:
        status = "ok" if actual == expected else "FAILED"
        print(f"  [{status}] {name}: exit {actual} (expected {expected})")
        if actual != expected:
            failures.append(name)

    with tempfile.TemporaryDirectory() as directory:
        work = Path(directory)
        with_blank = work / "with-blank.pdf"
        sparse_only = work / "sparse-only.pdf"
        _source(with_blank, blank_second_page=True)
        _source(sparse_only, blank_second_page=False)

        print("blank-page detection:")
        # A blank A4 page still compresses to a couple of kilobytes, so a file-size
        # threshold passes it. This must be caught by inspecting pixels.
        blank_export = work / "blank-export.pdf"
        _export(with_blank, blank_export)
        check("a blank page is rejected", run(with_blank, blank_export), 1)

        sparse_export = work / "sparse-export.pdf"
        _export(sparse_only, sparse_export)
        check("a page with one short line is accepted", run(sparse_only, sparse_export), 0)

        print("structural checks:")
        wrong_producer = work / "wrong-producer.pdf"
        _export(sparse_only, wrong_producer, producer="SomethingElse")
        check("a foreign /Producer is rejected", run(sparse_only, wrong_producer), 1)

        no_title = work / "no-title.pdf"
        _export(sparse_only, no_title, drop_title=True)
        check("dropped metadata is rejected", run(sparse_only, no_title), 1)

        extra_pages = work / "extra-pages.pdf"
        _export(with_blank, extra_pages)
        check("more pages than the source is rejected", run(sparse_only, extra_pages), 1)

        check("a missing file is reported", run(sparse_only, work / "absent.pdf"), 2)

        print("compatibility-copy contract:")
        # Page count is unchanged by a reorder, so the relaxed contract must be opt-in.
        check(
            "dropped metadata still fails as a compatibility copy",
            run(sparse_only, no_title, "--expect-compatibility-copy"),
            1,
        )

    print()
    if failures:
        print(f"FAIL: {len(failures)} case(s) behaved unexpectedly: {failures}")
        return 1
    print("PASS: verify_export.py rejects every deliberately broken export")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
