# Hosting LeafPDF

No hosting provider is selected or configured by this repository. This guide defines the static-host
contract that must be satisfied after a provider and public URL are chosen intentionally.

LeafPDF has no backend, account system, upload endpoint, API key, analytics service, or database. A
host serves the compiled application files; PDF parsing, editing, recovery, and export still happen
inside the user's browser.

## Build the exact public path

For a dedicated domain or root path such as `https://pdf.example.com/`, use the default build:

```bash
npm run build
```

For a nested path such as `https://example.com/leafpdf/`, build with that same path:

```bash
LEAFPDF_BASE_PATH=/leafpdf/ npm run build
```

`LEAFPDF_BASE_PATH` is a URL path, not a full URL. It is normalized to one leading and trailing
slash. URLs, query strings, fragments, and `.` or `..` traversal segments are rejected. Rebuild if
the public path changes; moving a root build under a subdirectory will leave its asset and
service-worker URLs pointing at the wrong place.

The complete deployable artifact is `dist/`. Upload its **contents** to the configured public root
or subpath without renaming hashed files. Do not deploy `src/`, `tmp/`, `output/`, `preview/`, test
traces, generated fixtures, or user documents.

`vite preview` is a local production-build smoke-test server. It is not a production server and is
not the process to run on a public host.

## Static-host contract

The chosen host must provide all of the following:

- **HTTPS** for every public URL. Browsers permit service workers on secure contexts; `localhost`
  is the development-only exception.
- A path-preserving **SPA fallback** to that build's `index.html` for navigation requests inside
  the configured base path. Existing assets, `sw.js`, and `manifest.webmanifest` must be served as
  files and must never be rewritten to HTML.
- Correct MIME types: `application/javascript` for JavaScript and module workers, `text/css` for
  stylesheets, `application/manifest+json` (or `application/json`) for the web manifest,
  `image/svg+xml` for the SVG icon, and `font/ttf` for bundled fonts. Send
  `X-Content-Type-Options: nosniff` so a wrong type fails visibly instead of being guessed.
- Revalidation for the two entry points: `Cache-Control: no-cache` for `index.html` and `sw.js`.
  This lets browsers discover a new hashed shell and service-worker cache version after release.
- Long-lived caching for fingerprinted files under `assets/`, for example
  `Cache-Control: public, max-age=31536000, immutable`. The manifest and icons may use a shorter
  revalidation policy.
- The existing `Content-Security-Policy` from the built HTML, preferably mirrored as an HTTP header:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:
  blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self';
  form-action 'none'`. Do not loosen `connect-src` to add analytics, upload services, or CDNs while
  still claiming local-only processing.
- Sensible browser headers such as `Referrer-Policy: no-referrer` and a restrictive
  `Permissions-Policy`; neither requires document data to leave the browser.

The generated service worker is scoped to the configured base path. Its cache name includes that
scope, and its build-time precache list contains only files emitted into `dist/`. It does not cache
opened PDFs, `.leafpdf` projects, exports, recovery records, or arbitrary same-origin responses.
After one successful online load, the app shell can reload offline; the user still selects the PDF
from their own device.

## Verify before publishing

Generate the synthetic fixture once if it is absent:

```bash
python3 scripts/create-fixture.py
```

Then prove a repository-style subpath and the complete offline editor workflow:

```bash
LEAFPDF_BASE_PATH=/leafpdf/ \
LEAFPDF_HOSTING_TEST=1 \
npx playwright test e2e/hosting.spec.ts
```

That test builds and serves the production artifact at `/leafpdf/`, verifies the relative manifest,
service-worker scope, and exact emitted-asset cache, turns the browser offline, reloads the app,
opens the synthetic PDF, adds text using Enter-to-finish, and exports an edited PDF. It must pass in
addition to the normal root development and production-preview suites in [RELEASING.md](RELEASING.md).

After a provider and public URL are selected, verify the deployed URL separately in a fresh browser
profile. Check the manifest, service-worker scope, response MIME types and cache headers, one online
edit/export, and one offline reload. Provider-specific configuration belongs in a separate,
explicitly approved change.
