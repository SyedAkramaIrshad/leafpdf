"""Generate a large PDF fixture to establish LeafPDF's honest file-size limit.

Incompressible noise images are used so the file really is as large as it claims;
compressible filler would misrepresent the memory cost of opening it.

    python3 scripts/create-large-fixture.py 100

The argument is the approximate target size in megabytes.
"""

import sys
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

OUTPUT_DIR = Path("tmp/pdfs")
# Fixed seed keeps the fixture reproducible between runs.
SEED = 20260729


def noise_bytes(rng: np.random.Generator, side: int = 900) -> BytesIO:
    pixels = rng.integers(0, 256, size=(side, side, 3), dtype=np.uint8)
    buffer = BytesIO()
    # Quality 95 on pure noise stays essentially incompressible.
    Image.fromarray(pixels).save(buffer, format="JPEG", quality=95)
    buffer.seek(0)
    return buffer


def noise_image(rng: np.random.Generator, side: int = 900) -> ImageReader:
    return ImageReader(noise_bytes(rng, side))


def build(target_mb: int, path: Path) -> None:
    rng = np.random.default_rng(SEED)
    width, height = A4
    canvas = Canvas(str(path), pagesize=A4)
    canvas._doc.info.creationDate = "D:20260101000000Z"
    canvas._doc.info.modDate = "D:20260101000000Z"

    target_bytes = target_mb * 1024 * 1024
    # Measure one real image rather than guessing its compressed size.
    sample_bytes = len(noise_bytes(np.random.default_rng(SEED)).getvalue())
    total_pages = max(1, round(target_bytes / (sample_bytes * 2)))
    print(f"sample image {sample_bytes / 1024:.0f} KB -> {total_pages} pages for ~{target_mb} MB")

    pages = 0
    while True:
        # Two noise images per page, plus selectable text for the edit path.
        canvas.drawImage(noise_image(rng), 30, height / 2 + 10, width - 60, height / 2 - 50)
        canvas.drawImage(noise_image(rng), 30, 60, width - 60, height / 2 - 60)
        canvas.setFont("Helvetica", 12)
        canvas.drawString(34, 40, f"Large fixture page {pages + 1}")
        canvas.showPage()
        pages += 1
        if pages >= total_pages:
            break

    canvas.save()
    actual = path.stat().st_size
    print(f"{path}: {pages} pages, {actual / (1024 * 1024):.1f} MB")


if __name__ == "__main__":
    target = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build(target, OUTPUT_DIR / f"large-{target}mb.pdf")
