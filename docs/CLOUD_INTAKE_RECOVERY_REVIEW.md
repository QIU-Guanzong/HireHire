# Interrupted intake and export consistency — cloud review

Local batch on 2026-10-13 in `/workspace/HireHire`, based on `b64eac531fbe41c0a213086c420c910f757871e5`. Branch: `codex/intake-recovery-export-consistency-20261013`. `AGENTS.md`, README and the cloud handoff were read; no repository skill files were found. Existing locked dependencies were reused.

## Goal and observed gaps

Keep an accepted registration retryable after interruption, and keep customer PDF exports aligned with the administrator's current search. The existing 73 form checks covered ordinary drafts and retry after a request failed; the 49 admin checks waited for settled results before exporting. Neither covered these two windows.

The new browser harness reproduced the first bug before the fix: the real isolated intake API returned `201`, but the opt-in local draft still had `pending:false` while that receipt was withheld. Closing the tab could lose the session attempt; restoring and editing could create another key and registration. After the fix, the saved original attempt and data are durable before the request leaves the page.

The admin audit found that the search input updates before its 300ms debounce changes the API query. Export buttons still used the previous query and selected IDs during that interval. The fix tracks the requested and loaded query/kind/status/page, hides mismatching rows and disables list exports until they agree. The download handler also checks the current scope. Paging within a query retains selections; query/kind/status changes still reset them. Single-record exports require a completed detail read whose ID matches the intended record.

## Implementation

`components/intake-form.tsx` synchronously stores the current key, answers, photo ownership and candidate IDs as a pending draft before `fetch`, only when the user opted into draft storage. Restored pending drafts return to the locked confirmation page and focus its heading. Retry uses the original payload/key; an explicit client error unlocks corrections, and a confirmed receipt clears draft/attempt data. A pending saved draft cannot be unchecked before its receipt is resolved. Users who did not choose storage still get no personal draft saved.

`components/admin-workspace.tsx` tags accepted list responses with their scope and checks immediate control values as well as loading/error state. Detail read failures, pending reads or wrong returned IDs block the detail export. Authentication, consent, API validation, PDF renderer, database schema and production configuration were not changed.

## Acceptance and evidence

- New closed-loop browser checks: **47 passed**. Both forms use actual API handlers against in-memory SQLite and object storage. A jobseeker's accepted photo registration is interrupted by closing the tab; an employer's accepted selected-candidate registration is interrupted by reload. Original keys/payloads and receipts match, exactly one record remains for each, the photo attaches to the original record, and the employer has one match. Duplicate submit events, a definitive `400`, opt-out storage, restored focus, 360px layout and delayed/failed admin search are covered. An actual client PDF contains only the newly searched identity and excludes dedicated contact/consent fields.
- Existing form regression: **73 passed**, retaining draft compatibility, correction, photo and consent behavior, client validation, keyboard focus and identical lost-response retry payloads.
- Admin/PDF browser regression: **59 passed**, retaining the original 49 and adding delayed/failed/wrong-ID detail reads and exact cross-page selection. Includes real isolated-renderer PDF bytes, explicit full mode, denied UI, 360px and reduced motion. Its administrator session and records are synthetic mocks, unlike the new in-memory handler bridge.
- `node node_modules/typescript/bin/tsc --noEmit`: passed.
- `node scripts/platform-check.mjs --unit`: **222 passed**; the suite count is unchanged because this batch changes UI timing, and the new behavior requires browser interruption tests.
- `npm run build`: final Worker build passed.

The first fixed-code harness attempt failed because its PATCH helper omitted `Origin`; the existing same-origin check correctly returned `403`. Only that test adapter was corrected. No external blocked permission or connection was retried. The original bug failure, adapter failure and passing reports are preserved separately.

Actual mobile pending-confirmation, desktop admin and client PDF screenshots were inspected. Evidence, scripts, input fixtures and resources are under ignored `work/intake-recovery/`. Synthetic records are removed by their exact IDs and object storage is cleared before closing the in-memory database. No production API, database or account was read or written. A later environment-disconnection notice was checked with fresh commands: the same host/workspace and running type-check tool were available; execution continued there.

Resource receipts record elapsed time, child CPU/RSS and sampled container memory for each check. Container figures include the execution runtime and earlier work; they are not presented as this batch's exclusive allocation. Browsers and builds ran serially. Preview and Worker processes are stopped before delivery. Existing navigation/search browser suites were not repeated because their code is unchanged. Physical phones, screen readers, real production accounts and cross-device draft recovery were not tested. Browser storage denial/clearing still prevents durable tab recovery; the form retains its in-page fallback.

## Next proposed goal

The isolated probe confirmed a separate existing PDF privacy gap: a contact address and phone embedded in `schedule` remain in the client PDF even though dedicated phone/email fields are excluded. This batch leaves the renderer unchanged. The next bounded batch should sanitize contact values in client free text and structured work experience while retaining dates, pay, work content and the authorized full PDF/raw records. Acceptance should cover both client record and matching bundles, embedded contacts in several fields, unchanged useful numeric/date values, unchanged full data and authorization. Do not describe the current client PDF as automatically anonymizing arbitrary free text.

## Delivery state

This batch is a local source commit, patch and verified incremental bundle, with the previous upgrade preserved as its base. No GitHub push, credentials, new account/permission, Sites mutation, merge or deployment occurred. Existing connection/write restrictions were not retried. The owner can review this batch before arranging the next one.
