# Client PDF default — cloud review

Local-only continuation on 2026-10-13 in `/workspace/HireHire`, based on `a832cff438e183d30ba807fef6e77ba807e628a4`. Branch: `codex/admin-pdf-client-default-20261013`. Previous source, patches and bundle remain intact.

## Observed gap and change

Both admin interfaces and the matching export API already defaulted to the client PDF. The general `/api/admin/export` API instead returned full private records when `mode` was missing or empty. It now defaults to `client`; full records still require explicit `mode=full` and the existing administrator check.

Client PDFs retain the selected people's names, references and service information, excluding phone, email, consent records and internal follow-up content. No renderer, authorization, publication-consent or database-schema behavior was changed. This round contains no UI redesign or additional export features.

## Verification

New focused checks failed against the previous implementation at the actual PDF text privacy assertion, then passed after the one-line default change. All checks ran serially in the cloud:

- `node node_modules/typescript/bin/tsc --noEmit` — passed.
- `node scripts/platform-check.mjs --unit --pdf-default-only` — 30 checks passed.
- `node scripts/platform-check.mjs --unit` — 153 checks passed, retaining all original 123 checks plus the 30 new ones.
- `npm run build` — complete Vinext/Worker build passed.

The focused checks call the real API handler and PDF renderer against an in-memory SQLite database and mocked assets. `pdftotext` verifies missing/empty/explicit client versions, exact selected or filtered identities, private-field exclusion, explicitly requested full data, invalid versions, anonymous `401` and unapproved-user `403`. Synthetic fixtures are removed by exact IDs in `finally`; no production endpoint or database is used.

Chromium passed 49 browser checks covering search, selected/filtered/detail downloads, explicit full export, empty results, list and PDF retry, dialog focus restoration, 360px mobile, keyboard focus and reduced motion. Downloaded PDFs were also checked with `pdftotext`. The browser used a mocked administrator session and synthetic list/detail responses; download bytes came from the isolated API checks. Every data request was intercepted locally and no browser mutation was permitted. These checks do not establish real-account production acceptance.

Desktop/mobile screenshots and rendered client/full PDF previews were visually inspected. Evidence lives in ignored `work/admin-pdf-default/`, including check logs, `focused-report.json`, `browser-report.json`, synthetic PDFs, previews and the browser runner. The temporary 5177 preview and browser contexts are stopped before handoff.

## Delivery limits

The change is retained as a local commit and patch, with no GitHub push, credential setup, merge, Sites write or publication. Current GitHub write authentication remains unavailable. The previous Library backup attempt failed on a network request before uploads were prepared; saving was not retried and does not block this development round. No production personal data, administrator configuration, payment flow or identity review was read or modified.
