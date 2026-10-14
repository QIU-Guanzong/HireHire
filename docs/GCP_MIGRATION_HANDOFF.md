# HireHire GCP migration handoff

This is a local migration candidate for the owner's existing GCP server and `https://hire.astock.top`. It is not a deployment receipt. The owner authorized migration and continued development; this step does not enable production management, change IAM or DNS, provision a server, or publish another Sites version. Historical Sites instructions in `AGENTS.md`, `README.md` and `CLOUD_HANDOFF.md` describe the preserved platform; the owner's explicit GCP decision supersedes their hosting choice.

## Runtime and storage

The runtime is the existing locked Next.js version on Linux Node.js ≥22.13, started through `scripts/node-server.mjs`. The built-in SQLite must also contain the WAL-reset fix: version ≥3.51.3 or the reviewed fixed backports 3.50.7/3.44.6; startup rejects an unpatched version. The cloud runtime's isolated in-memory read reported SQLite `3.53.3`; verify the actual receiving Node binary, not merely its major version. [SQLite WAL-reset release notes](https://sqlite.org/wal.html#walresetbug).

The custom server owns two distinct transport channels: public HTTP bound to `127.0.0.1`, and an optional private Unix management socket. It sets a process-local request context before handing a request to Next. Headers, cookies, request bodies and URL parameters do not select the management channel or authenticate a person.

Ship the custom server, `lib/node/*.mjs`, the complete `.next/server` and `.next/static` trees and allowlisted root runtime manifests, `public`, the two original SQL migrations, `next.config.mjs`, the offline `scripts/node-data-backup.mjs` utility and this handoff, and locked production dependencies. Next documents that standalone output does not trace a custom server; its generated `server.js` cannot replace this entry. No TypeScript compiler is needed to load the packaged `.mjs` configuration. [Next custom server documentation](https://nextjs.org/docs/app/guides/custom-server).

`HIREHIRE_DATA_ROOT` must identify a confirmed persistent private directory outside the release, public assets and temporary filesystems. SQLite implements the D1 subset used by existing APIs, including prepared statements, results, change counts and transactional batches. It retains the original migration bytes, checksums and business schema; a database with an unknown schema or missing migration journal is refused instead of silently adopted. Database files use mode `0600`. Private photo objects use directory mode `0700`, file mode `0600`, constrained UUID keys and bounded atomic writes. No photo directory is exposed as a web root. The deployed mount and backup policy remain operational checks; an absolute path alone does not prove persistence.

The licensed CJK font and its OFL notice stay in `public/fonts/`. PDF rendering reads the fixed local font asset, without a self-request or public network download. Existing consent, publication review, original submissions, idempotency, optimistic conflict handling, private photo ownership and expiry, and public/client/full PDF field separation remain protected behavior.

`/api/live` reports process liveness and the server-configured release channel. `/api/health` checks all six business tables, object storage readiness and font availability. Both are read-only. Neither endpoint verifies a production administrator or network reachability from a Hong Kong phone. The release channel defaults to `preview`; operations explicitly selects `production` only in the reviewed production configuration. A hostname is not used as proof of a deployed release.

## Default closed management

Management remains disabled unless the operator explicitly supplies all enablement settings below. Sites login and the former `oai-authenticated-user-*` identity headers are not an authentication mechanism on GCP. Public requests cannot gain management authorization using a complete forged Sites, Google or internal identity header set.

The optional management listener requires a socket owned by the service OS UID, mode `0600`, in its service-owned `0700` parent. Its directory ancestry is checked for unexpected ownership, symlinks and group/other write access. Existing socket paths are not automatically deleted or adopted. The owner and operations coordinator must approve the actual OS access mapping, IAP/SSH access scope and operator label before enabling this listener. Root, the same OS UID, and anyone allowed to act as that UID form its access boundary. This is an OS transport authorization boundary, **not verification of the individual IAP user's identity**; the configured label is not a browser-supplied identity or an independent personal audit trail.

An existing IAP/SSH channel can forward a local loopback port to the remote Unix socket after the OS access review. A bare loopback TCP management port is not treated as an authenticated person. No new OAuth credentials or administrator email are inferred, requested again, or embedded in source. If separate per-person web identity is required, it needs a separately reviewed authentication design and configuration.

| Runtime setting | Purpose / default |
| --- | --- |
| `NODE_ENV=production` | Production Node execution; no preview login. |
| `HIREHIRE_APP_ORIGIN=https://hire.astock.top` | Fixed allowed public authority and mutation Origin. No path or credentials. |
| `HIREHIRE_LISTEN_HOST=127.0.0.1` | Only supported public bind; never `0.0.0.0`. |
| `HIREHIRE_PORT=8038` | Selected public loopback port for the migration; the parser's fallback is `3000`. |
| `HIREHIRE_DATA_ROOT` | Reviewed persistent private storage path outside code releases. |
| `HIREHIRE_RATE_LIMIT_SALT` | Server-only secret, minimum 24 characters; runtime file only. |
| `HIREHIRE_WRITES_ENABLED=false` | Default closed intake, photo and management mutations; explicitly enable only after cutover checks. |
| `HIREHIRE_RELEASE_CHANNEL=preview` | Default local/candidate channel; set `production` only in the reviewed live service configuration. |
| `HIREHIRE_TRUST_LOCAL_PROXY=false` | Dedicated proxy IP header is untrusted by default. |
| `HIREHIRE_MANAGEMENT_ENABLED=false` | No management socket by default. |
| `HIREHIRE_UNIX_ACCESS_CONFIRMED` | Required explicit OS/IAP/SSH access-scope confirmation when enabling management. |
| `HIREHIRE_MANAGEMENT_SOCKET` | Reviewed normalized absolute Unix socket path. |
| `HIREHIRE_MANAGEMENT_ORIGIN=http://127.0.0.1:8039` | Selected local origin of the approved IAP/SSH forwarding port. The VM does not listen on management TCP `8039`. |
| `HIREHIRE_OPERATOR_SUBJECT`, `HIREHIRE_OPERATOR_NAME` | Explicit reviewed operational principal labels; not personal IAP identity. |

`HIREHIRE_LOCAL_QA` and `HIREHIRE_ALLOW_TEMPORARY_DATA_FOR_TESTS` belong only to synthetic isolated tests. They must be absent or false in production. No environment file, salt, private data, database, browser session or OS access configuration is included in the artifact. Do not put any secret in `NEXT_PUBLIC_*`, `next.config` environment fields, build logs or Git. Next distinguishes server-only runtime environment variables from values compiled for browser access. [Next self-hosting documentation](https://nextjs.org/docs/app/guides/self-hosting).

The public server strips inbound identity and forwarding headers and replaces the authority headers from its fixed configuration. Mutation Origin checks remain enforced. When writes are disabled, mutations that pass the Origin check return `503`; anonymous management requests first fail authorization with `401`. Intake retry, upload and management writes cannot silently run during the frozen cutover stage.

Client IP rate limiting uses the transport peer unless a reviewed local proxy mode is explicitly enabled; that mode accepts only a single valid dedicated IP header from the loopback proxy, and never supplies a management identity. Review which local processes can reach the public port and how the proxy overwrites that header before opting in. With proxy trust disabled, public clients behind the proxy share the peer IP bucket; that is a known operational limitation rather than trusted user-supplied forwarding data. Before opening real registrations, operations must establish and verify the dedicated-header overwrite and loopback boundary, then explicitly enable proxy trust; arbitrary Cloudflare and `X-Forwarded-For` headers stay ineffective.

## Build provenance and package

Run source validation and the Next production build serially in the cloud execution environment. Record the build receipt immediately after the successful build; do not claim this command ran a build or tests:

```sh
node scripts/package-node-release.mjs --record-build=work/gcp-migration/build-provenance.json
```

The receipt records the actual HEAD at build time, source input hashes, Next build ID, key manifest hashes and a digest of all allowlisted runtime build output files. Its fingerprint includes tracked and nonignored untracked build/runtime inputs, while excluding documentation and check/packaging scripts. If only those excluded files change before the final candidate commit, run the same receipt command afterward: it checks that source inputs and build outputs are unchanged, records the clean final source SHA/tree, and retains the actual `builtSourceCommit`. If runtime inputs or build bytes changed, the existing receipt is refused; validate a new build and use a new receipt path. Never relabel a changed build as already accepted.

After all required checks and a clean candidate commit, package that exact full SHA:

```sh
node scripts/package-node-release.mjs \
  --candidate=FULL_ACCEPTED_GIT_SHA \
  --build-receipt=work/gcp-migration/build-provenance.json \
  --release-id=REVIEWED_RELEASE_ID
```

The script refuses a dirty checkout, a different HEAD, changed inputs/build bytes, unsupported dependency sources or a reused output directory. It assembles only allowlisted runtime files under ignored `work/gcp-migration/<release-id>/runtime`, then installs production dependencies there with the existing lockfile using `npm ci --omit=dev --include=optional --ignore-scripts --no-audit --no-fund`. Only HTTPS `registry.npmjs.org` tarballs with locked integrity are accepted. Operator npm credentials and app environment variables are not passed to installation; lifecycle scripts do not run. Linux native optional dependencies come from the locked registry packages. Confirm that the receiving VM has the package's Linux architecture, compatible libc and supported Node version before using it; the receipt also records the built-in SQLite version for comparison.

Deliver the archive **and** the external `package-manifest.json` and `package-receipt.json` through an available native file attachment/download channel or an authorized GitHub artifact. The receipt records the full source SHA/tree, actual build source, build ID, input digest, lockfile hash, architecture, archive SHA-256 and bytes. The manifest covers every packaged regular file and dependency symlink, including `release-provenance.json`; it is external so it can record the archive's complete file list without a self-referential hash. A local filesystem path alone is not a usable handoff to Air. No archive, upload, actual test count or deployment success is claimed by this document.

The artifact is a Node release rather than the previous Worker archive. The development Git commit and old Sites publishing commit are distinct provenance; keep both and the original rollback evidence. Extract into a new reviewed release directory, verify archive and manifest hashes, and check packaged HTTP behavior before activation. Do not run another build on Air to recreate candidate bytes.

## Operations review templates

These are review examples only. Replace placeholders using the existing server layout after checking ports, owners, mounts and current services. They are not installed or enabled by this development step. No real server identifiers or secrets appear here.

```ini
# Example systemd service; existing OS user and paths require operations review.
[Unit]
Description=HireHire Node application
After=network.target

[Service]
Type=simple
User=REVIEWED_SERVICE_USER
Group=REVIEWED_SERVICE_GROUP
WorkingDirectory=/REVIEWED_RELEASE_DIRECTORY
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
EnvironmentFile=/REVIEWED_PRIVATE_RUNTIME_ENV_FILE
ExecStart=/REVIEWED_NODE_BINARY /REVIEWED_RELEASE_DIRECTORY/scripts/node-server.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Keep the environment file root-controlled and private, with no values in the unit or repository. Run as an approved non-root service user. Provision and review the persistent data directory before startup; it is separate from release extraction. If management is later approved, the socket parent must be owned by that user with mode `0700`; review who can SSH or switch into the same UID. Do not expose the socket through the public reverse proxy.

The publishing task owns the existing nginx/TLS integration; no nginx file is created or changed by this candidate. Its public upstream is `127.0.0.1:8038` with the fixed `Host: hire.astock.top`. The management Unix socket must not be included in a public proxy upstream. The approved IAP/SSH tunnel would expose it only on the operator's local `127.0.0.1:8039`, with that exact local Origin.

The selected management path for the operations contract is `/run/hirehire-management/admin.sock`. Provision its parent as mode `0700`, owned by the reviewed non-root service UID; the application creates and verifies its socket as that same UID with mode `0600`. Use `HIREHIRE_MANAGEMENT_SOCKET=/run/hirehire-management/admin.sock` and `HIREHIRE_MANAGEMENT_ORIGIN=http://127.0.0.1:8039`. Do not replace this with a VM listener on TCP 8039. If the existing VM needs a different reviewed path, update the operations contract explicitly rather than opening broader permissions.

An approved existing IAP/SSH session can use this forwarding shape (reviewed VM/zone/SSH account placeholders, no credentials):

```sh
gcloud compute ssh EXISTING_VM --zone EXISTING_ZONE --tunnel-through-iap -- \
  -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8039:/run/hirehire-management/admin.sock
```

Open `http://127.0.0.1:8039/admin` on the operator device. The remote SSH account must already be authorized to access the socket under the reviewed OS mapping; a different UID is correctly refused. This command neither grants that access nor verifies a personal web identity. Closing the tunnel removes the operator-device entry; navigating away from the app is not an authentication logout. Keep the listener disabled until the mapping is confirmed.

The Node entry strips identity headers itself; nginx is not an identity verifier here. Review inherited nginx locations and caching rules so APIs, private photos, PDFs, HTML and RSC responses cannot bypass the intended route or use a shared cache. Preserve Next's `Vary` and `Cache-Control` behavior; disable proxy buffering for streaming. Fingerprinted static assets may retain the immutable headers emitted by Next. Never add a public filesystem alias for private object storage. Keep dedicated IP header `X-HireHire-Client-IP` cleared when proxy trust is disabled. If proxy IP trust is approved later, overwrite it with exactly one valid IP from the reviewed client-address source; lists, duplicates, missing or malformed values are not trusted by the Node entry. Do not append a browser-provided value or trust arbitrary `X-Forwarded-For`. Review upload limits and bounded upstream timeouts without weakening the API's photo/PDF limits. [Next reverse proxy and streaming guidance](https://nextjs.org/docs/app/guides/self-hosting).

## Cutover and rollback prerequisites

Operations reported the existing GCP disk expanded from 70 to 100 GiB and verified usable filesystem space. The coordinator's read-only check at 02:56 UTC on 2026-10-14 reported zero rows in `candidate_publications`, `intake_photos`, `intake_rate_limits`, `intake_records`, `record_matches` and `site_settings`, with no truncated result. This is a historical report, not this candidate's current production database read.

Before cutover, retire the old Sites entry under the separately authorized publishing operation: old `GET`/`HEAD` requests redirect with `303` to the formal domain and writes return `503`. Recheck all six old tables after write retirement. If any rows appeared, stop the empty-database cutover and design a reviewed, consistent data/object transfer; never drop or reset live tables to preserve the empty assumption. Unknown R2 orphan objects have not been inventoried: preserve the old site and its storage instead of declaring them empty or deleting them. Do not attach old D1/R2 credentials to the Node artifact.

Bring up the Node service with `HIREHIRE_WRITES_ENABLED=false` first. Verify readiness, release provenance, the public identity/header denial rules, expected empty schema and reviewed proxy client-IP behavior. Only after the old six-table recheck and these checks pass may the publishing operator explicitly set `HIREHIRE_WRITES_ENABLED=true` and restart to open the new registrations. A failure leaves both activation and new writes paused, with the old release/data preserved. This document does not perform the old-site retirement or approve its live configuration.

Retain the existing Sites V4 and its source/archive as rollback. Its reviewed development source is `7427a150982357f93c0f49e4720319dd7d1c75d2`; Sites publishing source is `9772f272c76a161328a6844b51d6b0db8d537ee5`, both reported with tree `1721f8461f133575458cbcec26a8be0bbc1c50ec`. New cloud visual and version commits are separate, unclaimed deployment states. Do not create another Sites project, publish a Sites version, delete its D1/R2 bindings, or change DNS in this local migration step.

## Persistent backup and restore

Use a separate private persistent backup destination; verify its actual mount and available space. A release archive is **not** a database/photo backup. Stop the reviewed HireHire service and confirm its owned public listener/socket have stopped before a coordinated SQLite/photo snapshot. If stopping fails, if another writer exists, or if any backup/verification command fails, leave activation stopped and preserve the prior release and original data. Do not reset a database, delete an original WAL, or switch releases after a failed backup.

SQLite WAL writes can remain outside the main `.sqlite` file. Copying that one live file is insufficient. The packaged `scripts/node-data-backup.mjs` copies the paused source DB/WAL/SHM into a private staging directory, then uses Node's built-in SQLite and `VACUUM INTO` on that staged copy. It creates a consistent database image including committed WAL contents without opening the source SQLite connection or writing its shared-memory file. It copies the matching private photo files, validates hashes/migration checksums and publishes the new snapshot directory only after verification. No external SQLite CLI is required.

Use the reviewed service OS UID. Both backup and restore destinations must initially **not exist**. These example commands are for the publishing operator after stopping the service and verifying no writer remains; they have not been run against production. `--offline-confirmed true` records the operator's assertion and does not stop a process or prove that an application is offline.

```sh
node scripts/node-data-backup.mjs backup \
  --data-root /REVIEWED_ACTIVE_PRIVATE_DATA_ROOT \
  --backup-root /REVIEWED_NEW_PRIVATE_SNAPSHOT_DIRECTORY \
  --offline-confirmed true

node scripts/node-data-backup.mjs restore \
  --backup-root /REVIEWED_VERIFIED_PRIVATE_SNAPSHOT_DIRECTORY \
  --data-root /REVIEWED_NEW_PRIVATE_RESTORE_DIRECTORY \
  --offline-confirmed true
```

The snapshot's private `manifest.json` contains format version, timestamp, SQLite version, the immutable migration checksums, and every backed-up file's name, bytes and SHA-256. It covers `hirehire.sqlite` and constrained `private-objects/intake-photos/<uuid>` object paths. CLI stdout reports summary counts/bytes and the manifest hash, rather than raw rows or an object list. The tool checks private ownership/modes, symlinks and existing destinations; the receiving operator still verifies its actual persistent mount and stopped service. Never pass `--allow-temporary-for-tests true` in production. Do not upload the snapshot or row data into the public code artifact, GitHub or chat. Arrange a protected off-VM copy and retention policy with operations; a second directory on the same disk alone is not disaster recovery. SQLite documents WAL behavior and consistent `VACUUM INTO` snapshots. [SQLite WAL](https://sqlite.org/wal.html), [SQLite VACUUM INTO](https://sqlite.org/lang_vacuum.html#vacuuminto).

For restore, keep the application stopped. Verify the saved manifest, database integrity, foreign keys, migration-journal checksums, object ownership/modes and row/object relationships in an **empty new private persistent directory**; do not overwrite the active data root or attach a backup to a running SQLite connection. Copy both `hirehire.sqlite` and the matching `private-objects` into that new directory. No source WAL sidecar is required for the verified `VACUUM INTO` image; leave original database/WAL/SHM files untouched. Point the reviewed runtime environment at the restored directory and start the known release with management still disabled. Verify readiness, expected counts, persistence after restart and private access denial before reopening writes. If any restore check fails, stop the candidate and return to the preserved data/release instead of deleting evidence or forcing schema adoption.

Activation requires operations to verify the package on the existing VM, filesystem persistence and backups, reviewed service identity and configuration, proxy/TLS behavior, and public/admin denial rules. Keep management disabled until its actual access mapping is approved. Recheck both independent forms, uncertain-response retry, persistence after restart, consent withdrawal, private photo/PDF access and customer/full PDF separation using synthetic isolated data before activation. After any separately authorized cutover, verify HTTPS, release provenance, public health, private access denial and real Hong Kong network reachability. Browser emulation does not establish physical-phone or screen-reader acceptance.
