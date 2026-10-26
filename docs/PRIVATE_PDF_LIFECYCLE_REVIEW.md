# Private PDF preview recovery

Base: reviewed integration `7b672c521156574b7e5c059f961c34fb06e920cd`
(PR8–11 union, tree `ca2a3e828105bf076c3299156a2b3e6280f90f68`).

The preview previously remained busy indefinitely when PDF headers or bytes never
finished. A single 60-second request deadline now covers headers, error JSON,
PDF bytes and the signature check. Expiry cancels the owned request and exposes
an explicit retry; known 401/403 responses still require the operator to close
the preview and check access. No automatic retries or changes to the server's
authorization, PDF fields, request allowlist or download acknowledgement.

The context ref is now updated only after a render commits. Render-time context
comparison still immediately hides a previous document, and cancellation plus
sequence/context checks prevent late responses from recreating it. Download
cleanup captures its URL collection, and modal focus/scroll lifecycle depends
on the stable preview ID rather than response-phase changes.

Validation on Mac, 2026-10-26:

- Baseline browser reproduction: hanging headers and body remain busy beyond
  the test's accelerated deadline. No actual account or registration.
- `scripts/private-pdf-request-check.mjs`: 55 checks; each await, ignored abort,
  late resolution, cancellation, denial bodies, valid bytes and cleanup.
- `scripts/private-pdf-lifecycle-browser-check.mjs`: 33 checks with actual React
  under StrictMode, 360px and reduced motion; explicit retry, close/context
  invalidation, download acknowledgement/duplicate lock and URL cleanup.
- TypeScript and 688 isolated business/API/PDF checks passed.
- Repository lint: 49 existing errors and 11 existing warnings. This batch
  removes one ref error and two effect dependency warnings; no new diagnostics.

The browser harness isolates CSS and uses a minimal synthetic PDF: it verifies
interaction/lifecycle, not PDF typography, full Next rendering or a physical
phone. Its first post-fix run passed 32 functional assertions but incorrectly
classified Chrome's local PDF viewer resources as external requests. The
corrected harness permits only those exact browser-local resource origins in
addition to loopback/blob, and still rejects foreign HTTP(S). Both receipts are
retained under ignored `work/private-pdf-lifecycle/`.

Provide the existing test tools via `--esbuild`, `--playwright`, and `--chromium`
when running the browser script. It owns and closes its loopback server and
browser; `--expect-timeout-bug --source=<baseline>` reproduces the old behavior.
No new dependencies, production requests, data access, CI or deployment.
