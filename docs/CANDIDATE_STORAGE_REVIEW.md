# Candidate selection persistence warnings

Base: `7b672c521156574b7e5c059f961c34fb06e920cd` (`validation/pr8-pr11-20261026`). This independent candidate does not include the frozen PDF progress revision.

When localStorage rejects a write, the selection hook already supplies a bilingual failure message. Its callers immediately replaced that message with a success or comparison-limit message. The write helper now reports persistence success; callers only announce success when that result is true. Unavailable-profile cleanup still attempts both lists, even when the first write fails, and retains the warning if either fails.

No keys, persisted format, public/private permissions, backend contracts or PDF behavior change. Current-page selections may remain in memory after a failed save; refresh restores the actual persisted value. This is not a transaction across lists/tabs and does not promise that failed writes survived refresh.

## Reproduction and checks

`scripts/candidate-storage-browser-check.mjs` uses actual React components, synthetic loopback GET responses, and injected quota/security failures. It never submits registrations. Pass `--expect-warning-bug` against the base source to reproduce the misleading messages. The script takes explicit `--esbuild`, `--playwright`, `--chromium`, and `--output` paths; dependencies are not bundled.

Corrected base run: 69 assertions reproduced warning replacement in 12 actions, both languages. Fixed run: 209 assertions passed across quota failure, security denial and normal persistence, including partial two-list failure, refresh, and explicit recovery. Component checks isolate CSS; they do not establish full application or Linux acceptance.

TypeScript passed. Platform unit checks passed: 688 checks and 20 admin response contracts, including synthetic PDF checks. Lint remains 50 existing errors and 13 warnings; per-file/rule/severity counts exactly match the base. There are no new lint diagnostics and no rule suppression.

Full build and native local application browser evidence are recorded separately with the exact commit. No CI, production writes, server control, merge or deployment is part of these checks. The shared Linux execution/owner blockers remain unresolved.
