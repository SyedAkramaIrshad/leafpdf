## Summary

<!-- What problem does this change solve? Keep the scope to one coherent change. -->

Related issue: <!-- Example: Closes #123 -->

## User-visible behavior

<!-- Describe exactly what a LeafPDF user can now do or what changed on screen/export. -->

## Privacy boundary

- [ ] PDF bytes, annotations, signatures, recovery data, and extracted content stay in the browser.
- [ ] No real personal PDF, signature, ID, offer letter, confidential document, credential, or secret is included.
- [ ] Any new persistence, permission, or network behavior is explicitly described above. If none, state that.

## PDF compatibility

- [ ] Preservation, rebuild, form, signature, redaction, encryption, and export implications were considered.
- [ ] Any unsupported or lossy behavior is named to the user instead of being silently ignored.
- [ ] The original PDF is never overwritten.

## Verification

<!-- Check only commands that actually ran and include relevant counts or failures. -->

- [ ] `npm run lint`
- [ ] `npm test -- --run`
- [ ] `npm run build`
- [ ] Deterministic fixtures and `npm run test:e2e` when browser or PDF behavior changed.
- [ ] Production-preview E2E when CSP, workers, assets, or build behavior changed.
- [ ] Export verifier or real-world PDF evidence when preservation/export claims changed.

## Visual evidence

- [ ] Screenshots are attached for visual changes at desktop and the minimum supported 1024 px width.
- [ ] No screenshot contains a private document, signature, identity detail, credential, or secret.
- [ ] Not applicable; this change has no visual effect.

## Limitations and follow-up

<!-- Name what this pull request intentionally does not solve. -->
