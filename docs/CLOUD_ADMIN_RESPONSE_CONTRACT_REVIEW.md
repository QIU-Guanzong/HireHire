# Admin endpoint response contracts — independent candidate

Baseline is frozen PR10 `07924a82ceb61d22418c65057f945df6df898512`, tree `c2407abfeeabf2a5fe0aec7d754574fbd0ec70ae`. This candidate adds endpoint response validation; it does not change PR8/9/10 branches, server authorization or deployment settings.

## Reproduction

PR10 still accepted a successful JSON object `{ "ok": true }` for `PATCH /api/admin/settings`. The settings editor replaced its draft/original state with that object. A real React/Chrome loopback reproduction observed the subsequent missing-fees render failure (`Cannot read properties of undefined (reading 'length')`). The simulated server had already saved before replying, so retrying automatically would be incorrect.

## Narrow change and compatibility

`lib/admin-response.ts` checks the actual JSON contracts used by the shared admin request helper: session, settings, record lists/details, candidate lists/create/details, and match lists/create/update. It verifies required object/array/scalar shapes, timestamps needed by editors, pagination/counts, nested fee/experience entries, and detail IDs against the requested path. Record-list kind filters must match the returned roles. Unknown JSON endpoints need an explicit contract; PDF downloads use their separate existing transport.

The validator returns a boolean and never supplies defaults or rewrites a response. A shape failure uses PR10's existing read-error or unconfirmed-write error before any caller success branch. The 20-second deadline, HTTP error status/fields, cancellation, optimistic version and no-auto-retry behavior remain intact.

Compatibility cases explicitly retained: blank initial settings may have `updatedAt: ''` on GET, but a confirmed PATCH must return a real version; registration data may omit newer questions and include older string/boolean/string-array answers; nextFollowUp/photoId/requestedCandidateIds are optional when absent but checked when present; older candidate salaryNegotiable may be absent; additional response fields remain unchanged. The historical record wrapper is accepted for registration detail callers. No database schema or input normalization changes.

This is structural response validation, not proof that a syntactically valid server response contains the user's intended values or authorization. Business validation and access control remain server responsibilities. In-memory admin drafts still do not survive closing the page.

## Actual validation

- Frozen PR10 direct-helper and real-settings-editor reproductions succeeded without modifying its source.
- 79 endpoint-contract assertions passed, including valid and compatible legacy responses, missing fields, nested wrong types, wrong IDs/roles, initial settings, and no automatic retry after wrong-shaped success.
- PR10's 64 transport assertions passed with a complete valid response fixture.
- 149 real React/Chrome loopback assertions passed across settings, employer/jobseeker edits, candidates and matches. Added wrong-shape 200 responses alongside malformed JSON/stalls/403; drafts and original versions survive, explicit retry detects a conflict after simulated server commit, and explicit comparison/confirmation recovers. No unexpected requests or uncaught browser errors in the fixed run.
- `node scripts/platform-check.mjs --unit --admin-response-contracts`: all 688 original business/API/PDF assertions passed, and 20 successful responses produced by the actual in-memory route implementations passed the new client contracts. This adds a contract check without replacing the existing business assertions.
- TypeScript passed. Affected helper/validator/regression scripts lint clean. The prior whole-repository baseline remains 50 errors/13 warnings; no claim of whole-repository lint passing.

Tests used synthetic data and local transport only. Receipts are under ignored `work/admin-response-contracts/`; existing transport receipts are under `work/admin-response-recovery/`. The browser regression supports `--source`, `--surface=settings --mode=wrong-shape --expect-shape-bug` for the frozen-baseline reproduction and `--output` to keep its evidence separate. Temporary browsers and loopback servers were closed.

Full application build, independent review and Linux deployment acceptance remain outstanding. The existing Linux EACCES/supervision authorization remains pending; no server identity, ACL, service control, CI, merge or production deployment was performed for this candidate.

## Scalar guard review follow-up

Independent review found that `String(value)` admitted single-element JSON arrays for record kind and candidate state. The new regression first failed on `kind: ['employer']`. Both guards now require `typeof value === 'string'` before enum membership. All valid role/state strings remain accepted; arrays (including nested arrays), null, booleans, numbers and objects are rejected in details and aggregate lists. Malformed write responses still reject without retrying.

The expanded contract suite passes 119 assertions (40 additional scalar/detail/list/transport checks), along with TypeScript and affected-file lint. The earlier 64 transport, 149 browser and 688 business plus 20 actual-response results above are retained from the preceding candidate; those larger suites were not repeated for this two-guard correction. PR10 remains frozen; no next work batch or server action was started.
