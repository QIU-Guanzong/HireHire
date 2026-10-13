# 家合僱傭 cumulative release candidate review

Reviewed locally in the independent cloud Linux workspace `/workspace/HireHire` on 2026-10-13. This is an app **1.1.0 release candidate**, with no push, saved Sites version, deployment, production read/write, permission retry or new Site/storage resource. The final source SHA, tree, file hashes, backup hashes and check receipts are in `work/release-candidate/delivery-receipt.json`; that ignored evidence is separate from the public source.

## Scope and preserved history

The reviewed public root is `8612c9d2a004cd24ba886d6e3d373e71ac6bcaba`; the accumulated feature tip under audit was `135fb34db86d3eaf6416ed18f12a1953e814e188`. The dedicated candidate branch is `codex/release-candidate-audit-20261013`. The original root and every intervening commit remain ancestors; no history was rewritten.

The cumulative changes retain the existing platform and add review-to-edit form navigation, restored existing hosting metadata, default client PDF exports, public navigation/search/filter/sort improvements, interrupted intake recovery, current-search export scope, contact-text masking/versioned filenames, and shared private PDF preview before download. See the corresponding `CLOUD_*_REVIEW.md` documents for each change's earlier evidence.

This round makes six confirmed corrections, rather than adding another feature:

| Trigger | Result after correction | Origin |
| --- | --- | --- |
| Phone values adjacent to ASCII commas in client PDF free text | Contacts are masked; punctuation and neighbouring prose remain | Cumulative redaction change |
| A contact followed by a working clock or bare decimal value | Clock remains intact; an adjacent bare decimal is separated only when a complete known contact establishes its boundary | Cumulative redaction change |
| A new catalogue request fails after a previous successful search | Old successful count is no longer announced for the failed scope | Present in public root |
| A saved page number is beyond the remaining public results | A clear return-to-first-page action preserves applied filters and sort | Present in public root |
| Intake accepts `38.0` or `038.00`, then staff creates a public draft | Public age becomes `38`; original and private intake values remain unchanged | Present in public root |
| A sort value names an inherited object property | API returns 400 instead of reaching a SQL error and 503 | Present in public root |

An independent review also caught an intermediate regression in the decimal correction: unfamiliar dotted international/grouped phone numbers could leave a trailing group. The final correction does not split such numbers, and both unlabelled grouped numbers and labelled international numbers are in the actual PDF regression corpus. The failed intermediate probe is retained in ignored evidence, not presented as a passing result.

## Verification and practical limits

Required checks ran serially on the final application inputs: TypeScript, the complete isolated API/PDF suite, and `npm run build`. The API/PDF suite passed **683 assertions**, retaining the original 123 checks plus accumulated checks. It uses in-memory SQLite, memory object storage, synthetic data and Poppler text extraction. The final numeric count and resource measurements are recorded in the delivery receipt.

The independent browser closed loop passed **125 assertions**, covering actual current API handlers and generated PDF bytes through a local adapter; it did not substitute static catalogue or PDF responses. It used desktop and 360px touch emulation, keyboard interactions, reduced motion, browser accessibility-name inspection and reviewed screenshots. It covered:

- Published-and-consented search, sort, filters, history/detail return, saved profiles, ordered comparison and public PDFs; honest empty state, unavailable results and page recovery.
- Both independent registration forms, review correction, consent retention, portrait ownership, deliberately lost accepted response, byte-identical retry/key, one record and original receipt, and removal of the accepted opt-in draft.
- Staff publication followed by employer selection, the separate employer form and one intended automatic pair; admin search/detail correction, 409 preservation and reviewed overwrite, and blocked exports while a new search is pending.
- Client/full record and matching PDFs: exact recipients, useful fields, privacy separation, acknowledgement gating, reviewed Blob equal to downloaded bytes by SHA-256, one export request and preview URL release.
- Withdrawn public consent immediately closing list, detail, photo, single PDF and comparison PDF; anonymous 401 and unapproved 403 for both private PDF modes.

The browser run added exactly two intended registrations to its six-record synthetic seed. The final two matches consist of the seed pair plus the intended new pair. All eight records, six publications, two matches, two photos and two memory objects were removed by exact IDs; the in-memory database was closed. No production submission was made.

The final compiled Worker passed **484 artifact/runtime assertions**, checked separately with installed Miniflare/workerd, an empty ephemeral D1/R2, the two existing schema migrations, local ASSETS, GET-only requests and a rejecting outbound handler. Health/schema/version, public empty state, root HTML, CSS/font bytes, admin closed state and unchanged artifact inventory are checked. Direct Miniflare requires `assets.routerConfig.has_user_worker: true`, normally derived by Wrangler from `main`; the initial harness 404 and its correction are retained. This check does **not** exercise the hosted Sites identity-header boundary or deployed bindings. An unconfigured local allowlist denying a supplied synthetic identity is not proof that a production gateway rejects forged headers.

Earlier browser harness failures involved a portrait transport type, a label query despite a correct browser accessibility name, and a navigation wait. Their failure and cleanup receipts remain available. They are not extra passing acceptance runs. The successful browser run preceded the final narrow decimal guard; its UI/API interfaces were unchanged, and the changed redactor subsequently passed the complete API/PDF suite and a new build.

**No physical phone, installed screen reader or real production administrator/applicant acceptance was performed.** Touch emulation and accessibility-tree inspection do not establish those outcomes. Native PDF viewer save/open controls remain browser behaviour; the app acknowledgement is a delivery check, not DRM. Contact-text filtering is not complete anonymisation or OCR, and client PDFs retain names.

## Configuration, packaging and recovery

- Package, lockfile, schema, migration SQL/snapshots/journal, build tooling, authentication source and formal-information defaults remain unchanged from the reviewed root. Dependencies use the original npm lockfile; no version upgrade or migration was introduced.
- `.openai/hosting.json` retains only the existing project `appgprj_6acdec2bcdfc8191a67ebb95ba0c4cbe`, D1 logical binding `DB` and R2 logical binding `BUCKET`. The generated Wrangler database ID is a local placeholder, not a production database identifier.
- Build output includes the complete Worker/server/client tree, licensed local font and matching hosting/migration metadata; a client-only static archive would be incomplete. The framework-generated prerender token is never printed in evidence and is not a production account credential.
- The full source bundle contains the dedicated branch from the original root through this review commit, with **no excluded prerequisite range**. Verification starts in a new empty repository before any fetch; restored HEAD/tree, root, original ancestors, commit count, `git fsck --full --strict` and a clean working tree are required. The receipt records the performed result and bundle SHA-256. No restored dependencies or application were run.
- The source bundle excludes Git configuration, credentials, ignored build/dependencies, browser sessions, databases, photos and evidence. The tested Worker archive and synthetic evidence archive are separate local deliverables. The final source commit is linked to every tested non-document input by its file hash; documentation-only additions do not cause an unnecessary repeated build.

To inspect an offline source bundle before restoring it:

```sh
git init /tmp/hirehire-inspection
git -C /tmp/hirehire-inspection bundle verify /absolute/path/HireHire-release-candidate-full.bundle
git -C /tmp/hirehire-inspection fetch --no-tags /absolute/path/HireHire-release-candidate-full.bundle refs/heads/codex/release-candidate-audit-20261013:refs/heads/restored-candidate
git -C /tmp/hirehire-inspection checkout restored-candidate
git -C /tmp/hirehire-inspection fsck --full --strict
```

Use a new empty inspection directory and compare the resulting full SHA/tree with the receipt. Source recovery is independent from a Sites deployment rollback and cannot restore D1/R2 contents.

## Release, rollback and needed information

This candidate is ready for source review and further staffed acceptance; it is not approved or released to production. Before an actual release:

1. Obtain a release instruction for the reviewed source; confirm authorized access, ownership and the current saved/deployed version of the **existing** Sites project through its native workflow. No remote permission was retried in this round.
2. Preserve the existing DB/R2 mapping and immutable migration history. Synchronize exact reviewed application content using the Sites source helper; retain the development SHA and the helper's separate publishing SHA. Prepare, save and deploy a complete Worker archive through Sites, with an agreed release label. No direct production Wrangler deployment or new website is implied.
3. Perform physical-phone, screen-reader and authorized real-account acceptance, including both registration entrances, intake retry, admin publication/consent, private PDF recipient/version checks and hosted authentication boundaries. Use agreed synthetic submissions and exact cleanup only when production testing is explicitly authorized.
4. If operational admin is being enabled, use owner-verified intended ChatGPT login emails for `ADMIN_EMAILS` through Sites secrets. The owner deliberately deferred those emails; keep the gate closed until supplied and do not infer an identity or ask repeatedly. Public phone, WhatsApp, email, address, hours and approved fee items also remain owner-provided information; maintain honest pending values until available.
5. Confirm rollback availability before publishing and record post-release health/version and affected workflows. This round did not read live state; handoff entries below are historical evidence, not current readback.

The handoff records deployed V3, saved version `appgprj_6acdec2bcdfc8191a67ebb95ba0c4cbe~appgver_d0193548dba08191a0ef2e34408535bb`, deployment `appgdep_6ace16dab13481919060af0ed5ebf244`, source `d77562b799c35dc03de43c81641b12fbd68ebccf`. It records V2 fallback `appgprj_6acdec2bcdfc8191a67ebb95ba0c4cbe~appgver_77bbf3a3e1c48191a10d24b23343e7f5`, source `0ea4193fb2f05443c63a79dd2a6530592484f897`. Those Air source hashes are not ancestors in the sanitised public repository, and their Mac archives have not been claimed as present in this container.

For a deployment regression, first pause further publishing and select the confirmed prior saved version through the same Sites project after authorization. Code rollback does not delete, reset or restore business data. D1/R2 data recovery needs a separately authorized backup/recovery operation; none was performed here. There is no new schema change in this candidate.

The highest-value next step is staffed acceptance on a physical phone and a screen reader, followed by a concrete release/rollback review. Payments, identity verification and further feature expansion are outside this review.
