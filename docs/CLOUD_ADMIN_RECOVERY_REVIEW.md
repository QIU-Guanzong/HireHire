# Admin response recovery candidate — 2026-10-25

Baseline: PR8 commit `5ed68e39c2d102890d8ba0baa7e6559795d04512`, tree `1b39aa5eff0d142d353bf730d5283c80000e855f`. This separate candidate does not modify PR8 or include PR9's storage patch. Production deployment is not claimed.

## Reproduced defect and change

The previous shared admin request helper converted failed JSON parsing into `{}` even for a successful write response, allowing callers to treat an unconfirmed result as success. Fetch and response-body consumption had no deadline, leaving saving/loading states indefinitely blocked when the connection stalled. The registration workspace had its own equivalent request paths.

The new shared helper bounds response headers and JSON consumption to 20 seconds, composes caller cancellation with its own controller, and always removes its timer/listener. It rejects malformed, empty or non-object successful JSON. It does not validate every endpoint-specific object schema. Known HTTP error statuses and string field errors remain available, including 401/403 access denials and 409 optimistic-version conflicts, even if an error body is malformed or stalls.

Writes are never automatically retried. Transport failure says that saving is unconfirmed, rather than asserting that the server rolled it back. Existing editors retain their in-memory drafts and original expectedUpdatedAt; an explicit retry can produce a conflict and requires comparing the latest version. Late transport completion cannot become a successful caller result after timeout. The same helper now covers registration session/list/detail/update requests as well as existing candidate, match, settings and record-picker callers. Server authorization, writes switches, storage, prices and consent rules are unchanged.

## Completed checks

- Original implementation: two isolated reproductions confirmed malformed-success acceptance and absence of a deadline.
- `node scripts/admin-request-check.mjs`: 64 transport assertions passed, including headers/body stalls, external cancellation, late response, network failure, 400/401/403/409/503 preservation and no automatic retries. Fetch is synthetic; no sockets or customer records.
- `node scripts/admin-recovery-browser-check.mjs` with existing esbuild, Playwright and Chrome: 118 assertions passed on actual React components against a loopback synthetic API. Covers settings, employer and jobseeker registration edits, match follow-up, candidate drafts, malformed success, both stall stages, 403, original version retention, conflict comparison and confirmed recovery. Candidate publication stays disabled without consent; unconfigured/unauthorized UI gates do not fetch private records. No unexpected requests or uncaught browser errors.
- The browser harness accelerates only the 20-second request timer to 250 ms; the transport test separately asserts its production value. Test session data is synthetic and does not configure production management.
- TypeScript no-emit passed. The existing 688 in-memory business/API/PDF checks passed, covering permissions, same-origin rules, role consistency, version conflicts and consent withdrawal. These do not replace actual Linux transport acceptance.
- Existing whole-repository lint baseline remains 50 errors and 13 warnings. Normalized diagnostics match PR8; new helper and regression scripts have no lint diagnostics. No rule was disabled.

To run the browser harness, provide `--esbuild=/absolute/path/to/esbuild/lib/main.js`, `--playwright=/absolute/path/to/playwright-core/index.mjs`, and `--chromium=/absolute/path/to/browser` if those test tools are not directly resolvable. `--surface=settings|records|matches|candidates` limits a focused investigation. Tests close their temporary browser, connections and loopback server. Receipts live under ignored `work/admin-response-recovery/`, including intermediate harness corrections; they are not production data.

## Remaining validation

Independent review, full application build, Linux HTTP/Unix management transport and release acceptance are still outstanding for this new candidate. No CI or production deployment was performed. The existing low-privilege Linux EACCES/shared-operation supervision issue remains pending; this candidate does not change identities, permissions or the blocked path. Drafts remain in memory, not durable recovery across closing the admin page.
