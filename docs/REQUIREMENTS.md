# HireHire requirements and acceptance map

## Scope and provenance

This is a source-backed map of the existing product, not a new feature list. Confirmed requirements come from [AGENTS.md](../AGENTS.md), [README](../README.md), the owner's migration instructions, and the 2026-10-27 instruction to document design/requirements and improve frontend/backend reliability and language. [Design rules](../DESIGN.md) contain the applicable official content references. The historical [cloud handoff](CLOUD_HANDOFF.md) describes an older Sites release; current development uses the native Node/GCP path.

Audit base: `699bf7a245e628d616a668585be0c5d1138c810b`, tree `c1d048b78d3bace2ecc3a469c4acd236b0e82af1`. The preceding operations handoff records 1.2.0 + `37b8fe4` as deployed, with registration enabled and management disabled. This document does not independently recheck production. The local receipt-validation patch described below is newer and is not a deployed change.

## Confirmed product requirements

| Requirement | Current implementation and source | Acceptance criteria |
| --- | --- | --- |
| Distinct employer and jobseeker tasks | `/employer`, `/jobseeker`, `components/intake-form.tsx`, `lib/fields.ts` | Correct fields, conditional sections, review/back, retained original text; both public locales; keyboard and narrow screens |
| Public catalogue contains approved people only | `app/api/candidates/`, `components/candidate-collection.tsx`, `lib/server.ts` | Current public consent plus published state; withdrawal blocks public profile/photo/PDF; no invented profiles or counts |
| Browser-local shortlist | `components/candidate-common.tsx`, collection/detail components; `/saved`, `/compare` | Maximum 30 saved / 3 compared; selected IDs carry into employer form; storage failure remains visible; no claim of account synchronization |
| Private registration and photo handling | `/api/intake`, `/api/intake-photo`, `lib/server.ts`, private file store | Idempotent receipt, photo ownership and expiry, same-origin/size validation; no private photos under the public release directory |
| Authorized daily management | Private `/admin` pages; `lib/admin-request.ts`, `lib/admin-response.ts`, admin routes | Anonymous/public or forged identity denied; loaded lists, detail, correction, follow-up, conflicts and recovery checked with synthetic private access only |
| Publication is a separate staff action | `/admin/candidates`, candidate routes | Applicant consent cannot be granted through an administrator correction; draft/save alone never publishes a person |
| Matching and PDF work | `/admin/matches`, PDF routes, `components/private-pdf-preview.tsx` | Persisted stages/versions; authorized client/full modes; deterministic batch ordering; 100 accepted and 101 rejected for record/match batch limits |
| Accurate service/contact/pricing information | `/services`, `/process`, `/fees`, `/faq`, `/contact`; settings routes | Owner-supplied values only; missing values accurately marked pending; no invented prices, phone numbers or guarantees |
| Public bilingual UI; preserved personal text | `components/locale-provider.tsx`, `lib/i18n.ts` | Fixed public text switches zh-Hant/en without translating names/answers; admin currently remains zh-Hant |

Payments, contract signing, automatic outbound notifications, public administrator access and model-generated replies are not introduced by this task. The administrator identity setup remains deliberately deferred.

## Registration → private record contract

1. The frontend prepares `kind`, form `data`, an idempotency key, selected candidate IDs and an optional photo claim. It preserves one exact uncertain-submission envelope for explicit retries. Current key validation is 16–100 characters from letters, digits, underscore and hyphen (`lib/server.ts`).
2. `app/api/intake/route.ts` validates origin/body/fields and compares the normalized envelope hash. A matching previous request returns HTTP 200 with its original `{reference}`. Reusing the key for different content returns 409. A new committed registration returns HTTP 201 with `{reference}`. A retry receipt is looked up before rejecting an already-used/expired photo claim.
3. The transaction creates the private record and any selected-candidate matches. Initial record status is `新登記`; selected matches begin `待聯絡`. Registration or consent does not publish a profile. The server is authoritative for candidate availability and photo ownership.
4. The frontend accepts a receipt only when HTTP is successful and `reference` is a non-empty string. It does not require a rigid reference prefix, and tolerates extra response fields. Malformed HTTP-success payloads retain the original attempt/key/photo and show uncertainty. No automatic second write is sent. The existing 30-second submission deadline includes reading the JSON body.
5. An authorized operator reads `/api/admin/records` and the record detail route. The list returns `records,total,counts,page,pageSize,asOf`; `total` is filtered while aggregate counts have their own broader scope. Do not present them as interchangeable.
6. A correction supplies `expectedUpdatedAt`. The server compares the precise record version and returns 409 on a conflict. It preserves original submitted answers, validates status/notes/data and does not grant applicant public consent. The client retains the editing draft on failure and requests conflict review instead of blind overwrite.

Primary sources: `components/intake-form.tsx`, `app/api/intake/route.ts`, `app/api/admin/records/route.ts`, `app/api/admin/records/[id]/route.ts`, `components/admin-workspace.tsx`, `lib/admin-request.ts`, `lib/admin-response.ts`.

### Failure/recovery acceptance

| Condition | Required result |
| --- | --- |
| Submission response headers or body stall | Bounded completion; no false receipt; original envelope/key retained for an explicit retry |
| 200 response has missing/object/array/empty reference | No success screen or owned-draft deletion; same key and identical payload on retry; one final confirmed cleanup |
| Definite validation rejection | Specific known field feedback where available; preserve answers for correction |
| 408, 425, 5xx or network uncertainty | Do not assume a write failed; no fresh-key automatic retry |
| Rapid repeated clicks | One in-flight request, no duplicate receipt cleanup |
| Another tab owns a newer draft | Late success/failure must not delete or overwrite that draft |
| Web Locks/storage unavailable | A readable saved draft can be restored into memory; no unsafe unlocked overwrite and no promise of durable saving |
| Admin request is interrupted or has invalid DTO | Keep the local draft/version; indicate unconfirmed save and require checking current data before retry |
| Private PDF makes continuous stream progress | Native stream path uses an inactivity deadline, not an absolute 60-second total limit; stalled headers/body/error responses and cancellation still finish |

The private PDF no-reader compatibility fallback retains an absolute 60-second limit. It must not be advertised as supporting indefinitely slow continuous streams. A local/browser test is not evidence of arbitrary custom transports.

## Storage and access boundaries

- Native entry: `scripts/node-server.mjs`; runtime adapters under `lib/node/`. Public HTTP does not accept client-supplied administrator identity. Private management uses an independently enabled Unix socket with verified OS access, fixed origin and permissions. That OS/SSH access is not a verified personal IAP user identity.
- Registration writes and management enablement are independent controls. Do not enable production management for acceptance tests, or infer that admin access must be open because public registration works.
- SQLite and private photos live outside release/public directories under the operator-configured persistent data root. Storage path/owner/mode/symlink checks and immutable migration hashes remain in force. Temporary-root checks are not proof that every other filesystem is persistent.
- UI photo selection accepts JPEG/PNG/WebP up to 8 MiB and converts a longest-edge-800px image to JPEG. The upload endpoint independently accepts JPEG/PNG up to 2 MiB and dimensions up to 1600px; an unclaimed upload has a 24-hour use period. Client checks do not replace server validation.
- `scripts/node-data-backup.mjs` provides the existing stopped-writer backup/restore workflow. Release acceptance needs a consistent SQLite image, private photos, hashes and offline restored readback. A backup on the same disk is not off-host disaster recovery.
- Never include credentials, browser sessions, real applicant fixtures, databases or private photos in source/test handoffs. Full/private PDF acceptance uses synthetic data only.

## Initial local audit: actual evidence and remaining work

The local patch fixes one demonstrated defect: before the patch, HTTP 200 `{reference:{}}` entered the success branch and cleared the draft/attempt; after the patch it remains unconfirmed. There are no schema, permission, dependency, price or wording changes in that patch.

The initial handler-only audit, frozen as `ba159453`, has the following evidence under ignored `work/design-contract-audit-20261027/`, separate from source. Subsequent browser/build follow-up is recorded in its own dated receipt; the initial counts below are not substitutes for that evidence:

- `intake-response-before.json`: 3 assertions reproduce the original defect.
- `intake-response-after.json`: 146 assertions execute the actual extracted submit handler with deterministic in-memory adapters. Both kinds, malformed receipts, same-envelope retry, valid 200/201, rejection/uncertainty policy and rapid clicks are covered. This is not a React render or browser test.
- Existing administrator request and response checks: 64 and 119 assertions respectively; TypeScript `--noEmit` passed. These are local results, not new production or Linux acceptance. Handler checks used local Node 26.9.0; production runtime is separately pinned by release procedures.

Before releasing this new patch, obtain independent review and the applicable rendered form/browser and exact-runtime release evidence. Previous Linux/full-page tests belong to the preceding release and are not credited to this patch. No real-model, physical-phone or real-user acceptance was performed in this audit. Lint is not reported as green: the preceding release recorded 49 errors / 11 warnings repository-wide, and those totals have not been re-measured here. A scoped check of the changed component reports 4 errors / 3 warnings with exactly the same diagnostic messages as the base (line locations shift); the new response harness has 0 errors / 0 warnings. See `scoped-eslint-comparison.json`.

The initial audit recorded the photo upload deadline as a source-observed follow-up. It was subsequently reproduced and addressed in a separate local candidate based on PR15; this does not change PR15 or the deployed version.

### Photo upload recovery: separate local candidate

| Transition | Contract and acceptance |
| --- | --- |
| Select → decode/encode | A single 30-second deadline starts before processing. A stalled decoder or canvas callback releases the UI and source object URL without starting a network upload. Oversize/type validation remains unchanged. |
| Request/response body stalls | Abort and settle the stage even if an underlying promise ignores cancellation. Show an unconfirmed result; preserve existing photo, form text and registration attempt. Do not automatically retry. |
| Successful upload response | Accept only an object with string `id`/`token` matching the format accepted by `validateIntake`. Extra response fields are tolerated. Invalid/missing/object/array credentials cannot replace or enter the saved photo claim. |
| Explicit reselect | Start one new photo request, including for the same file. A synchronous ref prevents queued file events and submission during an active upload. Replace the prior photo only after confirmed success; registration key remains unchanged until the existing registration logic requires a new envelope. |
| Unmount or draft restore/restart | Revoke upload ownership before aborting. Late completion cannot update the replacement form/draft. Restore retains the selected saved draft's claim; restart clears its owned draft/form while preserving the existing session-attempt policy. |
| Completed upload | Clear the deadline/listener; a later clock tick must not turn confirmed success into an error. |

Backend contract remains `POST /api/intake-photo` → HTTP 201 `{id,token}`. Upload and intake are different operations: uploads are not idempotent and may leave unclaimed private objects after a lost response. Unclaimed metadata expires after 24 hours; cleanup is opportunistic during later uploads, not a guaranteed scheduled deletion at exactly 24 hours. Existing photo ownership and atomic attachment checks remain unchanged. No backend endpoint, schema or cleanup policy changes in this candidate.

Reproduction: actual React/Chrome header/body stalls, 22 baseline assertions; a second counterexample demonstrated late attachment after restore/restart (14 assertions). Fixed browser checks and the helper's cancellation/listener probes are saved separately under ignored `work/photo-upload-recovery/`; see the candidate completion receipt for final counts and source hashes. Generated pixels and a loopback receiver only; no backend registration or real photograph is used. The component browser fixture is not full Next/Linux validation. This correction is appended to PR15 as a separately reviewable commit; the combined head needs fresh Linux validation and is not deployed.

### New full-page evidence and remaining Linux gate (2026-10-28)

- Exact application source/build ID `31a851f6cd7681f97320152bfb6eac34981766e7`, tree `063896857bf14ba0cceca5f17c62155666dc8c6b`: fresh build passed; native Node service returned that identity and ready health. No prior build or test result was relabelled.
- `scripts/intake-photo-browser-check.mjs --upstream=http://127.0.0.1:<isolated-port>`: 22 real Next-page scenarios, 264 assertions, production CSS and actual locale provider. Both languages and 360px/1440px; processing/network/body stalls, malformed photo claims, retry, navigation cancellation and draft switching. Generated pixels and synthetic response claims only; no backend photo or registration writes reached the app.
- Application runtime was macOS Node 22.23.3 / SQLite 3.53.4. Registration and management stayed disabled. Application exit 0, application/receiver listeners closed, six isolated tables empty. Receipts live under ignored `work/photo-upload-recovery/resume-20261028/`. The component fixture's 244 assertions are earlier evidence and are not added to this count.
- Exact-source Linux validation remains pending. The latest read-only `/data` check found 6,638,690,304 bytes free against the unchanged 8,589,934,592-byte full-build gate; shortage 1,951,244,288 bytes. Cache cleanup has not been approved or performed. This observation is time-specific, not a release reservation or permission to start a server task.

The new harness proxy initially allowed a network-path URL to change its upstream target. Independent offline review reproduced that test-isolation defect before publication. The proxy now rejects a different origin or embedded credentials before opening a request; nine offline positive/negative cases cover the boundary. The built-page suite was rerun after this guard. No application code or upload API changed.
