# LeafPDF current status

Updated: 2026-09-07

## Product boundary

LeafPDF is a local-first, laptop/desktop PDF editor. The full-width workspace is used at 1024 CSS
pixels and wider. The user authorized fixing the clipped 738px desktop pane after the usability
review below; compact desktop panes now use the same labeled tools with a two-row toolbar from
720px. Mobile layouts, mobile-only controls, responsive phone zoom behavior, and mobile preview
captures remain out of scope.

The primary workflow is:

> Open PDF → add text, details, date, checkmark, signature, or image → directly select,
> move, align, or delete it → Undo/Redo when needed → Save PDF.

Phone-number details and `tel:` link annotations are PDF content features and remain supported;
they are unrelated to phone-sized application layouts.

## Latest local change: compact desktop workspace and clearer controls

Requested after the review: implement the narrow-window, properties-panel, and label improvements.
Prepared together with the earlier UI improvements for the desktop-usability commit on
`feature/next-level-workbench`. The requested push targets `origin/feature/next-level-workbench`,
not `main`; verify the remote branch before making publication or merge claims.

- `src/styles.css` and `src/nextLevel.css`: allow compact desktop panes without phone-specific
  controls; keep the labeled rail; use two toolbar rows below 1024px; position form guidance and
  placement hints below the actual toolbar; shorten the collapsed properties panel; remove the
  group's empty full-height panel area; increase utility/alignment label readability.
- `src/components/ProjectToolsMenu.tsx` and `src/components/ToolRail.tsx`: distinguish the top
  Document menu from the left Tools button instead of showing two different More menus.
- `src/components/ZoomControl.tsx`: separate the current zoom percentage from the Fit width action;
  preserve the existing zoom behavior and active-fit indication.
- `src/components/HelpPanel.tsx` and `README.md`: reflect the new labels and desktop-pane boundary.
- `e2e/desktop-workspace.spec.ts`: add narrow-pane checks for long filenames, reachable controls,
  Find results, compact selection, stable paper geometry, Undo/Redo, form filling, signatures, and
  export. Existing menu/zoom assertions and `scripts/capture-preview.mjs` follow the renamed labels.

Fresh evidence:

- Before the fix, the 738px test measured a 1024px document. The form check then caught the guide
  covering Find after the toolbar gained a second row; the shared toolbar-height offset fixed it.
- Unit tests: 51 files, 442 tests passed. Lint and production build passed.
- Full production-preview browser suite with CSP: 74 passed, 1 optional screenshot-generation
  test skipped (75 total, 2.0 minutes). All three new desktop-workspace checks passed.
- Direct read-only measurement of the user's live tab: viewport and document both 738px; Save,
  history, Document menu, and zoom controls reachable; collapsed properties height 172.2px instead
  of about 230px. No reload or changes to the user's PDF were performed during that check.
- Visually inspected fresh 738px/1024px sample screenshots and the grouped-selection screenshot.
- Existing large-build-chunk warning remains. These checks do not claim phone support or a new
  independent manual editing session; the in-app file-picker automation limitation remains.

The requested review findings are implemented. Do not restart them after compaction unless a fresh
defect is reproduced. Further product changes require a new user request.

## Earlier local improvement: laptop tool discovery and finishing help

Requested: improve the existing laptop editor, check its real workflow, and test and fix problems.
These changes are included with the latest desktop-usability changes above. They are separate
from the previous release recorded below.

Reproduced defect: opening Shapes inside the scrolling tool rail clipped its palette at both
1024 × 700 and 1440 × 700; the browser measured only about 2% of the Ellipse option as visible.

Source changes:

- `src/components/ToolRail.tsx`: separate the advanced panel from the scrolling everyday tools;
  add explicit close, outside-click and focus-leave dismissal, and keyboard focus restoration.
- `src/styles.css`: position the panel beside the rail, keep palettes inside it, and make toolbar,
  group, and advanced-tool labels more readable. Everyday tools remain visible when palettes open.
- `src/components/HelpPanel.tsx`: show a concise Add → Done → Save route first; place detailed
  instructions and shortcuts in expandable sections; correct the stale default-zoom description.
- `src/nextLevel.css`: improve action and help text sizing and style the expandable instructions.
- `e2e/tool-panel.spec.ts` and `e2e/finishing-help.spec.ts`: add four browser checks for clipped
  controls, the complete guide fitting on a laptop, and mouse/keyboard panel dismissal.

Fresh verification:

- The two new clipping checks failed before the source fix and passed afterward.
- Unit tests: 51 files, 442 tests passed. Lint and production build passed.
- Full development browser suite: 69 passed, 1 on-demand screenshot test skipped.
- Two subsequently added help/dismissal browser checks: 2 passed.
- Focused production-preview checks with CSP: 9 passed. This was not a full production matrix.
- Coverage includes Copy → Paste → Undo, Enter/Shift+Enter, grouped move/alignment, Find/Replace,
  and placing text, date, checkmark, image, and signature before PDF export.
- Inspected `output/ui/tool-panel-1024.png` and `output/ui/finishing-guide-1024.png` visually.
  The guide's three primary steps and the open shape choices are reachable without clipping.
- Existing warnings remain: large production chunks and W-9 font fallback warnings.

Development server remains at `http://127.0.0.1:5173/`. This bounded improvement is implemented
and checked; no claim is made that the whole product is now the best PDF editor. Do not restart
these fixes after compaction unless new evidence reproduces a problem.

## Follow-up usability review (2026-09-07)

Requested: run broader checks and assess whether the UI is intuitive. No product code, Git state,
or user document was changed during this review; this work-log entry records the new evidence.

- Full production-preview browser suite: 71 passed, 1 optional screenshot-generation test skipped
  (72 total, 2.0 minutes). This supersedes the earlier limitation to nine production scenarios.
- Inspected the live layout and fresh sample screenshots for text completion, grouped alignment,
  and the Save output menu. The user's in-app viewport measured 738px wide while the document
  layout requires 1024px, explaining the off-screen right-hand controls in that panel.
- Manual sample-file selection through the in-app browser automation timed out; native Codex
  app control was unavailable and Chrome browser control was unavailable. Do not present the
  automated workflows as a completed independent manual editing session.
- Positive design findings: visible everyday tools, on-page text Done, distinct group selection,
  and a prominent Save PDF action at supported laptop widths.
- Usability findings at the time of this review (now addressed by the latest local change): the hard minimum width clips controls in a
  narrow desktop panel; the selected-item panel obscures paper at 1024px; repeated More labels
  have different meanings; tiny utility labels and the combined Fit/percentage label need clarity.
- The subsequent user request authorized fixing these findings, not restoring mobile layouts or
  redesigning unrelated UI.

## Previous verified remote state

- Repository: `SyedAkramaIrshad/leafpdf`
- Branches: `main` and `feature/next-level-workbench`
- Verified product commit: `79ec78e4ea0c6f60a5b57249896f93779e136c62`
- GitHub Actions: run `34017479018` passed both `test-and-build` and `e2e` jobs.

Both remote branches were confirmed at that commit after non-force fast-forward pushes. It contains
the laptop-first editor work, explicit text completion, Copy → Paste → Undo history behavior,
grouped selection/alignment, synchronized tests, current public documentation, screenshots, and CI.

## Previous release cleanup

- Removed obsolete phone-width expectations and preview captures from tests and release tooling.
- Preserved the labeled desktop tool rail at the minimum supported 1024 px width.
- Raised the top bar above side panels so the More menu remains clickable.
- Made toast bodies click-through while keeping their dismiss buttons interactive.
- Updated README and contributor/release language to state the 1024 px laptop/desktop boundary.
- Kept hosting guidance provider-neutral and local-first.

## Previous release verification

Evidence completed during the previous release cleanup:

- Unit tests: 51 files passed, 442 tests passed.
- Lint: passed.
- Production build: passed with the documented large-chunk warning.
- Export verifier self-test: passed every deliberate failure case.
- Development Playwright matrix: 67 passed, 1 on-demand screenshot test skipped.
- Production-preview Playwright matrix with CSP: 67 passed, 1 on-demand screenshot test skipped.
- Nested-path/offline hosting workflow: 1 passed.
- README screenshot generation: 1 passed; both images inspected at original resolution.
- Desktop preview generation: five states captured and inspected.

The previous cleanup and product-code pushes were completed through the verified product commit
above. The latest desktop-usability commit is separate and targets the feature branch, not `main`.

## Continuation guardrails

- Do not restart Copy → Paste → Undo or text-Done implementation unless a fresh test reproduces a
  defect.
- Do not restore mobile UI or mobile screenshots. Preserve the subsequently authorized compact
  desktop-pane layout; it does not authorize phone-specific controls or behavior.
- Do not confuse PDF phone-number fields/links or the PDF 32000 specification with mobile support.
- Preserve unrelated desktop behavior and the local-only privacy boundary.
