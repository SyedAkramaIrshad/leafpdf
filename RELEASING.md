# Releasing LeafPDF

LeafPDF is a static, local-first browser application. `package.json` has `private: true`; LeafPDF is
not published to npm. A release consists of tagged source and, when useful, a verified `dist/`
artifact that can be served as a static site. Hosting and deployment are separate operator choices
and are not automated by this guide. Any published build must also satisfy the provider-neutral
[HOSTING.md](HOSTING.md) contract for its exact root or subpath.

This checklist documents evidence. It does not authorize a tag, GitHub release, deployment, package
publication, or repository-setting change.

## 1. Prepare a clean verification environment

Use Node.js 22 or newer, npm, Python 3.12 or newer, Poppler (`pdftoppm`), and Playwright Chromium.
Install JavaScript dependencies from the lockfile:

```bash
npm ci
```

The deterministic PDF fixtures require ReportLab and pypdf. Install them in an isolated Python
environment, then generate only synthetic documents:

```bash
python3 -m pip install reportlab pypdf
python3 scripts/create-fixture.py
python3 scripts/create-edge-fixtures.py
```

Never use a personal PDF, offer letter, ID, signature, confidential document, credential, or secret
as release evidence.

## 2. Run the static and verifier gates

Run each command separately and record its exit code and test counts:

```bash
npm run lint
npm test -- --run
npm run build
npm run verify:self-test
```

The build may report the known large-chunk warning. Record it as a known limitation; do not describe
the build as warning-free. The verifier self-test must prove that broken exports are rejected.

## 3. Run browser and PDF round trips

Exercise the development server, then the production build with its Content-Security-Policy:

```bash
npm run test:e2e
LEAFPDF_E2E_SERVER=preview npm run test:e2e
```

Prove the production artifact can also live under a repository-style path and complete the core
open/edit/export workflow after going offline:

```bash
LEAFPDF_BASE_PATH=/leafpdf/ LEAFPDF_HOSTING_TEST=1 npx playwright test e2e/hosting.spec.ts
```

The suite must cover the no-external-request promise, offer-style text/date/check/image/signature
finishing, forms, project recovery, page operations, redaction, keyboard behavior, the supported
1024 px minimum-width workspace, and export.
An intentionally skipped on-demand screenshot test is acceptable only when screenshot generation is
run separately.

Generate and inspect the two README screenshots:

```bash
LEAFPDF_SCREENSHOTS=1 npm run test:e2e -- screenshots
```

Capture the five desktop pull-request preview states against a running production preview or local server:

```bash
node scripts/capture-preview.mjs
```

For the enforced large-file boundary, run:

```bash
npm run test:e2e:large
```

Real-world verification uses only official public files: the IRS W-9 and the PDF 32000 specification.
Run the **Deep verification** GitHub Actions workflow or follow the official-download commands in
README. Do not redistribute those downloaded files as release attachments.

## 4. Review the evidence manually

Before deciding to release:

- Inspect `docs/screenshots/leafpdf-landing.png` and `docs/screenshots/leafpdf-editor.jpg`.
- Inspect all five `preview/*.png` states: desktop landing/workbench, Review, Help, and Privacy.
- Confirm no screenshot, fixture, trace, log, or artifact contains personal or confidential data.
- Compare every README capability claim with a current test, source path, or explicit limitation.
- Confirm the production-preview suite exercised the CSP and the no-external-request browser test.
- Confirm the nested-path hosting test exercised manifest scope, the generated app-shell cache,
  offline reload, local PDF rendering, Enter-to-finish text, and offline export.
- Confirm the explicit unsupported-feature list is still accurate.
- Record the current bundle-size warning and any real-world font warnings without hiding them.
- Reopen representative exported PDFs and verify visible content, page count, form values, and
  compatibility-copy expectations where relevant.

Generated `tmp/`, `output/`, `preview/`, test traces, downloaded real-world PDFs, and local recovery
data are verification material, not release attachments.

## 5. Version and publish intentionally

Only after the evidence above is current:

1. Choose an intentional semantic version and update `package.json` and `package-lock.json` together.
2. Write release notes grouped into user-visible changes, fixes, verification evidence, and known
   limitations.
3. Ensure the source tag exactly matches that version.
4. Wait for CI and the current Deep verification run to pass for the release commit.
5. Create the GitHub release from the verified tag.
6. Attach `dist/` only if a prebuilt static artifact is intentionally offered and was produced by the
   verified release commit.

Do not run `npm publish`: LeafPDF is not an npm package. Do not attach generated fixtures, exports,
preview images, traces, real-world PDFs, or user documents to the release.
