# Local admin PDF preview review

## Scope and provenance

This local-only batch continues `06648e1eec66d6a42166cf4e955649ea029c06a0` in `/workspace/HireHire`, branch `codex/admin-pdf-preview-20261013`. The existing Sites identity, APIs, authorization, PDF renderer and dependencies are retained. No production data, credentials, push, PR, merge or deployment is involved.

The confirmed gap was immediate download from both registration and matching exports, without a chance to inspect the selected version and people. Matching exports also lacked a loaded-employer identity guard: a newly selected employer could briefly inherit the previous employer's count, snapshot and batch.

## Behavior

- Registration selection, filtered batches, record details and employer matches open one shared private PDF preview.
- The request captures the exact version, IDs or filters, employer, batch and snapshot. The dialog shows that scope and the locally generated PDF.
- The existing authorized API generates the file once. Download uses that same retained Blob and filename after the staff member checks the version and objects; it does not issue a second generation request.
- Search, selection, version, batch, list refresh and relevant record changes invalidate the previous preview. Matching counts must belong to the currently selected employer before preview is available.
- Closing or cancelling aborts the request. Late results cannot restore an old preview. Error retry retains the captured scope and version; it never changes to the complete version automatically.
- The native modal keeps background controls out of keyboard navigation. Closing returns focus to the preview action; closing a PDF preview inside record details preserves the detail drawer.
- Preview URLs are released when closed, replaced, invalidated or unmounted. Download URLs are created from the same Blob and held briefly so closing the dialog does not interrupt the browser download, then released; leaving the component releases all owned URLs and timers.

## Validation

The implementation passed the required serial type check, all **610 in-memory API/PDF checks**, and build. The scoped generator rendered **14 actual PDFs** (16 manifest keys) through the existing authorized API using synthetic records and local fonts. No new renderer, dependency or API was introduced.

**156 browser assertions** passed for selected/all/detail/matching exports, explicit client/full modes, unchanged acknowledgement on new previews, exact record references, SHA-256/text equality and same-Blob download without a second API request. Coverage includes duplicate clicks, 503/non-PDF/empty/mislabeled responses, local 403 without retry, pending cancellation, search debounce/list error, ready selection invalidation, employer-count ownership, cross-page IDs, nested Escape/focus, 360px touch emulation and bounded URL cleanup. The actual desktop and mobile screenshots were inspected with the native PDF content visible.

**10 additional lifecycle assertions** passed against the current transformed hook in a temporary browser component harness: unmount releases both preview and held download URLs, cancels timers, restores scroll, aborts the pending request and rejects its late result. This harness mocks only development HMR transport to isolate component lifetime; it is not a production page or an acceptance claim for real navigation/accounts.

The main browser tests mock authorized sessions/lists and existing export responses using those actual scoped PDF bytes; the browser does not call the real database handlers. The separate API checks and generator exercise those handlers. All HTTP requests stay on loopback or use locally fulfilled fonts; browser-internal PDF viewer resources are explicitly allowed by their local scheme and built-in extension ID.

The first browser attempt exposed an overly broad test network rule which blocked the built-in viewer, producing a blank preview. Its local resource URLs were recorded, the rule corrected, and all browser checks rerun. The lifecycle harness initially lacked development HMR transport isolation; its failed attempts are retained with the successful isolated run. Neither issue required a product authorization or PDF rendering change.

Evidence lives in ignored `work/pdf-preview/`: `api-pdf-report.json`, `fixture-manifest.json`, `browser-report.json`, `unmount-report.json`, command logs, resource measurements, inspected screenshots, representative actual downloads, and the final delivery/cleanup receipts. Duplicate preview file copies may be removed only after hash comparison with retained files and are enumerated in the cleanup receipt.

## Limits and next priorities

Preview supports human inspection; it does not establish complete anonymization. The preceding contact masking rules and limitations still apply. The acknowledgement controls the application download action; native viewer save controls are browser features. Native PDF viewing depends on the browser; text extraction and byte equality provide separate verification of downloaded content. A desktop or 360px browser viewport does not establish physical-phone, screen-reader or production-account acceptance.

Priorities for a following bounded batch:

1. Verify the PDF preview and file opening on actual supported mobile browsers and with a screen reader, especially longer multi-person documents.
2. Improve filtered/matching batch object summaries if staff review shows that count/filter labels and the document itself are insufficient to distinguish people.
3. Prepare a separately authorized release review of the accumulated local changes, preserving the existing Sites project and currently closed production admin gate.
