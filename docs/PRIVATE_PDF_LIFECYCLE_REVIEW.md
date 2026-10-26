# Private PDF preview recovery

This revision starts from frozen PR12 head
`0fa9acd3d377d28c51a130a8c0b5e1917ae0f4c1`. That head remains held: its
absolute 60-second deadline canceled a continuously progressing valid PDF at
60,030ms when completion was expected at 64s. The reviewed integration beneath
it is `7b672c521156574b7e5c059f961c34fb06e920cd` (PR8–11 union).

## Request contract

- Wait at most 60 seconds without observable progress. Headers start a fresh
  body window; each **nonempty** byte chunk renews that window. Empty chunks do
  not renew it. There is no overall elapsed-time cutoff for streaming responses.
- Consume both PDF and error JSON through the response's readable stream. A
  stopped error body still preserves the known 401/403 status and cannot offer
  an unauthorized retry. Explicit retry remains an operator action.
- Caller cancellation and idle expiry abort only the owned request, cancel the
  reader, release its lock, and remove the timer/caller listener. Promise racing
  retains a bound even if a custom transport ignores cancellation. Late work
  cannot create object URLs or change the hook's context/sequence checks.
- A transport with no readable body/getReader cannot expose intermediate byte
  progress. Its existing blob/JSON read uses a bounded 60-second body wait after
  headers. This fallback can still reject a slow body whose progress is hidden;
  it is not equivalent to progress-aware streaming. No XHR, credentials, browser
  permissions or alternative service are introduced.
- These are inactivity recovery rules, not a rendering SLA. A server generating
  a PDF without sending any headers/bytes for 60 seconds can still time out.
  API limits remain 100 selected records or 100 matches plus employer (101),
  240,000 text characters, 500 pages, 12MiB encoded/64MiB decoded portraits.
  None of those limits establishes an absolute total-duration product limit.

The hook/CSS and API/PDF content/authorization code are unchanged in this
revision. The earlier `visibleId` change only named the base's existing
`visible?.id` dependency for lint. No popup/new-tab window ownership or cleanup
is claimed; preview/download object-URL cleanup is separate.

## Verification

- `private-pdf-progress-check.mjs`: first reproduced the frozen total-deadline
  defect, then checked streaming/empty chunks, independent header/body waits,
  body and error-JSON stalls, cancellation, denied statuses and fallback.
- With `--maximum-fixtures=<frozen synthetic output directory>`, the same test
  transfers four already-verified 100/101-record PDFs through 294s virtual
  progressing streams and separately tests each stalled body. It does not
  regenerate those unchanged API fixtures or call production.
- `private-pdf-real-stream-check.mjs <synthetic.pdf>` uses real clocks. The same
  4,378,781-byte fixture previously rejected now completes in about 64.16 seconds,
  with all 65 chunks and every byte preserved. This is a synthetic transport,
  not a Linux capacity measurement.
- `private-pdf-request-check.mjs` retains the original 55 fallback/transport
  negative controls. The expanded actual-React browser harness checks normal
  browser streaming, pending unmount, context changes and A/B out-of-order
  completion. `--production-css` loads the exact local build's compiled CSS
  and font; without it CSS is isolated. Neither mode claims full routing,
  popup ownership or a physical phone test.

Use existing authorized esbuild/Playwright/Chrome paths via the browser script's
options, and use only synthetic PDF fixtures. Task receipts stay under ignored
`work/pdf-progress/`. The repository's existing lint baseline is not all green.
Linux supervision and shared deployment ownership remain unresolved; code,
checks, independent review, merge and production release are separate stages.
