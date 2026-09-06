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

## Last pushed baseline

- Repository: `SyedAkramaIrshad/leafpdf`
- Branches: `main` and `feature/next-level-workbench`
- Last pushed baseline: `6c1aea5a729daa5c0ecb83580386a7aa120ba52d`

That baseline contains the laptop-first editor work, including explicit text completion,
Copy → Paste → Undo history behavior, and grouped selection/alignment. The current follow-up brings
tests, public documentation, screenshots, and CI into sync with that source.

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

The local follow-up is verified. Remaining release work is repository-only: review the exact diff,
commit it, push it without force to the feature branch and `main`, and confirm the resulting GitHub
Actions run.

## Continuation guardrails

- Do not restart Copy → Paste → Undo or text-Done implementation unless a fresh test reproduces a
  defect.
- Do not restore mobile UI, mobile screenshots, or sub-1024 responsive behavior.
- Do not confuse PDF phone-number fields/links or the PDF 32000 specification with mobile support.
- Preserve unrelated desktop behavior and the local-only privacy boundary.
