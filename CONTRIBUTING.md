# Contributing to LeafPDF

Thanks for helping improve LeafPDF. The project is intentionally local-first: a contribution must
not upload a user's PDF, annotation data, signature, or recovery record to an external service.

## Reporting issues

Use the structured [bug report](https://github.com/SyedAkramaIrshad/leafpdf/issues/new?template=bug_report.yml)
for reproducible problems and the [feature request](https://github.com/SyedAkramaIrshad/leafpdf/issues/new?template=feature_request.yml)
for an everyday PDF workflow or usability proposal. Search existing issues first.

Never attach a real personal PDF, offer letter, ID, signature, confidential document, credential, or
secret. Reproduce bugs with the generated fixtures, a new synthetic PDF, or a public document URL.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

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

Maintainers preparing a version should follow the evidence gate in [RELEASING.md](RELEASING.md).
