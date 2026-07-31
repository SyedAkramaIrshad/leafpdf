from pathlib import Path

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen.canvas import Canvas


def build_fixture(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(output_path), pagesize=A4)
    width, height = A4

    canvas.setFillColor(HexColor("#182026"))
    canvas.setFont("Helvetica-Bold", 28)
    canvas.drawString(56, height - 76, "LeafPDF verification document")
    canvas.setFillColor(HexColor("#3157D5"))
    canvas.rect(56, height - 110, 150, 4, stroke=0, fill=1)
    canvas.setFillColor(HexColor("#4D5556"))
    canvas.setFont("Helvetica", 12)
    lines = [
        "This deterministic PDF tests text, vector rules, page operations,",
        "annotation placement, signatures, rotation, and final rendering.",
    ]
    for index, line in enumerate(lines):
        canvas.drawString(56, height - 145 - index * 19, line)

    canvas.setFillColor(HexColor("#182026"))
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(56, height - 190, "Availability:")
    canvas.setFont("Helvetica", 10)
    canvas.drawString(118, height - 190, "Open to Immediate GCC Relocation")

    canvas.setStrokeColor(HexColor("#CBC8BE"))
    canvas.setFillColor(HexColor("#F8F6F0"))
    canvas.roundRect(56, height - 360, width - 112, 145, 5, stroke=1, fill=1)
    canvas.setFillColor(HexColor("#182026"))
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(76, height - 244, "APPROVAL CHECK")
    canvas.setFont("Helvetica", 11)
    for index, label in enumerate(["Owner", "Status", "Date"]):
        y = height - 278 - index * 31
        canvas.setFillColor(HexColor("#71766F"))
        canvas.drawString(76, y, label)
        canvas.setStrokeColor(HexColor("#A9A69D"))
        canvas.line(150, y - 2, width - 80, y - 2)
    canvas.setFillColor(Color(0.19, 0.34, 0.84, alpha=0.08))
    canvas.rect(56, 70, width - 112, 110, stroke=0, fill=1)
    canvas.setFillColor(HexColor("#182026"))
    canvas.setFont("Helvetica-Oblique", 15)
    canvas.drawString(76, 130, "Use this area for highlights, notes, and ink.")
    canvas.showPage()

    canvas.setPageSize(landscape(A4))
    width, height = landscape(A4)
    canvas.setFillColor(HexColor("#182026"))
    canvas.setFont("Helvetica-Bold", 30)
    canvas.drawString(58, height - 72, "Page operations")
    canvas.setFont("Helvetica", 13)
    canvas.setFillColor(HexColor("#4D5556"))
    canvas.drawString(58, height - 106, "Move this page, rotate it, delete it, or annotate it before export.")
    colors = ["#3157D5", "#BFE3D0", "#F26B4A"]
    labels = ["REORDER", "ROTATE", "EXPORT"]
    block_width = (width - 156) / 3
    for index, (color, label) in enumerate(zip(colors, labels)):
        x = 58 + index * (block_width + 20)
        canvas.setFillColor(HexColor(color))
        canvas.roundRect(x, 150, block_width, 220, 6, stroke=0, fill=1)
        canvas.setFillColor(HexColor("#182026") if color == "#BFE3D0" else HexColor("#FFFFFF"))
        canvas.setFont("Helvetica-Bold", 16)
        canvas.drawCentredString(x + block_width / 2, 250, label)
    canvas.save()


if __name__ == "__main__":
    build_fixture(Path("tmp/pdfs/mvp-fixture.pdf"))
