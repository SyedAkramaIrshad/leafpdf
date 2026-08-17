# Contributing to LeafPDF

Thanks for helping improve LeafPDF. The project is intentionally local-first: a contribution must
not upload a user's PDF, annotation data, signature, or recovery record to an external service.

## Development setup

```bash
git clone https://github.com/SyedAkramaIrshad/leafpdf.git
cd leafpdf
npm install
npm run dev
```

Node.js 22 or newer is recommended. No API keys or environment variables are required.

## Before opening a pull request

```bash
npm run lint
npm test
npm run build
```

Changes to browser workflows or PDF export should also run the deterministic fixtures and browser
suite:

```bash
python3 scripts/create-fixture.py
python3 scripts/create-edge-fixtures.py
npm run test:e2e
npm run verify:self-test
```

Keep generated fixtures and exports out of commits; `tmp/` and `output/` are ignored. Add or update
tests for behavioral changes, keep accessibility names stable, and state any PDF feature that cannot
be preserved rather than silently claiming compatibility.

## Pull requests

- Keep each pull request focused on one coherent change.
- Explain the user-visible behavior and how it was verified.
- Include screenshots for visual changes.
- Never include real personal PDFs, signatures, credentials, or API keys.
