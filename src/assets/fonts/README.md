# Bundled fonts

LeafPDF embeds these fonts into exported PDFs so that text outside WinAnsi
(Arabic, Devanagari, Greek, Cyrillic, and most punctuation and symbols) survives
export. They are served from LeafPDF's own build output and are loaded only when
an export needs them. LeafPDF never requests a font from Google or any other
host at runtime.

All five families are licensed under the SIL Open Font License, Version 1.1.
The verbatim license text is in `OFL.txt`; its body is byte-identical for all
families, and only the copyright line differs:

| File | Copyright | Upstream |
| --- | --- | --- |
| `NotoSans-Regular.ttf`, `NotoSans-Bold.ttf` | Copyright 2022 The Noto Project Authors | https://github.com/notofonts/latin-greek-cyrillic |
| `NotoSansArabic-Regular.ttf` | Copyright 2022 The Noto Project Authors | https://github.com/notofonts/arabic |
| `NotoSansDevanagari-Regular.ttf` | Copyright 2022 The Noto Project Authors | https://github.com/notofonts/devanagari |
| `NotoSansHebrew-Regular.ttf` | Copyright 2024 The Noto Project Authors | https://github.com/notofonts/hebrew |
| `NotoSansThai-Regular.ttf` | Copyright 2022 The Noto Project Authors | https://github.com/notofonts/thai |

The binaries are the unmodified hinted TTF builds published at
https://github.com/notofonts/notofonts.github.io.

## Coverage limits

These files cover Latin, Greek, Cyrillic, Arabic, Devanagari, Hebrew, and Thai.
They contain no CJK glyphs. Rather than draw blank boxes, LeafPDF
refuses an export whose added text needs a script it cannot embed and names the
offending text. Adding a script means dropping its Noto TTF here and registering
it in `src/pdf/fontRegistry.ts`.
