# LeafPDF current status

Updated: 2026-09-06

## Product boundary

LeafPDF is a local-first, laptop/desktop PDF editor. The supported workspace width is 1024 CSS
pixels and wider. Mobile layouts, mobile-only controls, responsive phone zoom behavior, and mobile
preview captures are out of scope.

The primary workflow is:

> Open PDF → add text, details, date, checkmark, signature, or image → directly select,
> move, align, or delete it → Undo/Redo when needed → Save PDF.

Phone-number details and `tel:` link annotations are PDF content features and remain supported;
they are unrelated to phone-sized application layouts.

## Verified remote state

- Repository: `SyedAkramaIrshad/leafpdf`
- Branches: `main` and `feature/next-level-workbench`
- Verified product commit: `79ec78e4ea0c6f60a5b57249896f93779e136c62`
- GitHub Actions: run `34017479018` passed both `test-and-build` and `e2e` jobs.

Both remote branches were confirmed at that commit after non-force fast-forward pushes. It contains
the laptop-first editor work, explicit text completion, Copy → Paste → Undo history behavior,
grouped selection/alignment, synchronized tests, current public documentation, screenshots, and CI.

## Current follow-up changes

- Removed obsolete phone-width expectations and preview captures from tests and release tooling.
- Preserved the labeled desktop tool rail at the minimum supported 1024 px width.
- Raised the top bar above side panels so the More menu remains clickable.
- Made toast bodies click-through while keeping their dismiss buttons interactive.
- Updated README and contributor/release language to state the 1024 px laptop/desktop boundary.
- Kept hosting guidance provider-neutral and local-first.

## Verification state

Fresh local evidence completed during this follow-up:

- Unit tests: 51 files passed, 442 tests passed.
- Lint: passed.
- Production build: passed with the documented large-chunk warning.
- Export verifier self-test: passed every deliberate failure case.
- Development Playwright matrix: 67 passed, 1 on-demand screenshot test skipped.
- Production-preview Playwright matrix with CSP: 67 passed, 1 on-demand screenshot test skipped.
- Nested-path/offline hosting workflow: 1 passed.
- README screenshot generation: 1 passed; both images inspected at original resolution.
- Desktop preview generation: five states captured and inspected.

The requested cleanup, verification, and product-code pushes are complete through the verified
product commit above. This status update is documentation-only. No implementation work remains in
this cleanup; begin a new change only from a new user request or a freshly reproduced defect.

## Continuation guardrails

- Do not restart Copy → Paste → Undo or text-Done implementation unless a fresh test reproduces a
  defect.
- Do not restore mobile UI, mobile screenshots, or sub-1024 responsive behavior.
- Do not confuse PDF phone-number fields/links or the PDF 32000 specification with mobile support.
- Preserve unrelated desktop behavior and the local-only privacy boundary.
