# Client PDF contact redaction — cloud review

Local batch on 2026-10-13 in `/workspace/HireHire`, based on `e3e52f176f543117f30e5cb8dd023d780c4f1a35`. Branch: `codex/client-pdf-contact-redaction-20261013`. Existing source, dependency lock and Sites identity were retained. Nothing was pushed or deployed.

## Problem and resulting behavior

Client PDFs excluded dedicated telephone/email fields, consent and internal notes, but emitted contacts embedded in other fields. The previous isolated probe reproduced this in work arrangements. New regression evidence also fails against the old renderer at an actual extracted client PDF containing the embedded phone.

Client record and matching PDFs now mask recognized contact spans as `[電話已隱去]` or `[電郵已隱去]`. The filter covers all visible free-text fields in both forms, including names, location, experience, qualifications, requirements and public-name/introduction fields when present. Structured work-experience country, household, duties and leaving reason are treated before formatting, while their date fields remain unchanged. Matching-person names are also treated before appending the generated reference. Known contacts are collected from every record in the export, so one person's contact mentioned in another person's text is covered.

Only client text is filtered. Typed dates, numbers, booleans and permitted options, generated references, date headings and fixed labels are retained. The original database content and explicitly authorized complete PDFs retain their contact text and internal information; the public-profile renderer is unchanged. No external service or new dependency receives or processes personal data.

## Detection scope and limits

Detection combines known phone/email values with common standalone formats. Cases include email case differences, plus-addressing, spacing/newlines around email separators, delimited Latin/internationalized addresses, Hong Kong local/country-code formats, grouped and labelled overseas numbers, mainland mobile numbers, extensions, supported split-line phone formats, full-width characters, common Arabic/Devanagari decimal digits and internal format characters. A normalized detection projection maps matches back to the original text; other Unicode text and line breaks are retained.

False-positive controls protect dates and year ranges, common decimal amounts, currency/pay context, labelled reference/certificate/order numbers and digits inside larger alphanumeric tokens. A direct phone label takes precedence where numeric prose is ambiguous. Independent bounded matches prevent a phone followed by a date or second phone from becoming one unrecognized long number.

This is conservative text masking, not complete anonymization. It does not inspect photo pixels or OCR, handwritten/spelled-out numbers, arbitrary obfuscation, every numbering plan, addresses, identity numbers or all Unicode mailbox syntax. Unknown internationalized addresses adjoining undelimited prose and deliberately disguised contacts can remain. Dates, amounts and reference contexts can be ambiguous; a human should review a customer copy when sensitive text may be present. Full-width/format normalization is used only for detection, not to rewrite unaffected content or source data.

## Version and download behavior

The matching export filename now contains the actual client/full mode, employer reference and batch. The UI honors this server filename; a missing header uses the request's captured mode, employer ID and batch. The request snapshot also supplies its query, keeping the selection stable while the response is pending. Existing no-store requests/responses, access checks, explicit full selection and PDF content-type checks remain in place. Errors do not trigger a full-version fallback.

An actual screenshot exposed an existing specificity issue: text-input CSS oversized the matching-version radios and squeezed their labels. A scoped selector correction restores compact radios and readable labels with 44px click areas. Desktop and 360px layouts were measured and the final controls visually inspected.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit` — passed.
- `node scripts/platform-check.mjs --unit --client-redaction-only` — **388 focused assertions passed**. The matrix checks each output field in actual record/matching PDFs, common formats and retained numeric/date text.
- `node scripts/platform-check.mjs --unit` — **610 assertions passed**: all prior 222 plus the 388 redaction checks.
- `npm run build` — passed; rebuilt after the scoped radio CSS correction.
- Matching download browser workflow — **37 checks passed**: actual isolated-renderer bytes, client→full→client, filenames, snapshot, in-flight locking, failure retry, non-PDF response, missing filename header, no-store fetches, denied UI, keyboard, 360px and reduced motion.
- General admin PDF browser regression — **59 checks passed**, retaining selected/filtered/detail exports, exact identity/order, explicit full mode, failed-list/download retry and cross-page selection.
- Scoped version-control layout — **2 viewport checks passed**, at 1440px and 360px.

`pdftotext` verifies every free-text fixture marker remains while contacts are masked in client records/matching bundles; full versions retain their original contact text and internal notes. Database snapshots remain identical after export. Default/empty client mode, invalid mode, anonymous and unapproved requests, filenames, no-store PDF/JSON errors and matching metadata are checked. Existing publication, consent, portrait, idempotency and batch-order checks all remain passing.

The initial masking tests caught and corrected overmatching of adjoining Chinese email prose, labelled alphanumeric certificate suffixes, year lists, internal decimal points, and phone/date or phone/phone grouping. Browser verification initially timed out because the batch selector used an overly strict label match; the selector was corrected, with no product behavior bypass. Failure logs and the old-renderer failing regression are retained separately from passing reports.

Browser identity/list responses are synthetic mocks; downloaded bytes come from real isolated PDF handlers. API tests use in-memory SQLite/object storage and exact fixture cleanup. No valid production intake, account, permission or data change occurred. Screenshots and client/full PDF previews were actually inspected; this does not constitute screen-reader or physical-phone certification.

Evidence and bounded resource receipts live under ignored `work/client-pdf-redaction/`. Unchanged form, navigation and public-search browser suites were not repeated; their protected behavior remains covered by the complete API regression. Temporary previews, Workers and browsers are stopped before delivery. GitHub/Library connection restrictions were not retried.

## Suggested next goal

Add a customer-copy preview in the authorized admin workflow that makes the selected people and PDF version easy to verify before download, and supports human review of ambiguous free-text contacts. Preserve the automated masking and explicit full-mode boundary. Use synthetic cases for unchanged-version errors and sensitive image/text limits; do not imply the detector can guarantee removal of all private information.
