# 家合僱傭 cloud continuation

The owner requested dot cloud continuation on 2026-10-13 and selected **https://github.com/QIU-Guanzong/HireHire** as the development repository. This document transfers the already released platform; do not rebuild it from scratch.

## Verified baseline

- Product: https://hire.astock.top . Public forms, restricted admin.
- App version: **1.1.0**. Existing Sites project: `appgprj_6acdec2bcdfc8191a67ebb95ba0c4cbe`.
- Released application source: `d77562b799c35dc03de43c81641b12fbd68ebccf` (the later handoff documentation commit contains no application changes).
- Saved Sites version: `appgprj_6acdec2bcdfc8191a67ebb95ba0c4cbe~appgver_d0193548dba08191a0ef2e34408535bb`.
- Successful deployment: `appgdep_6ace16dab13481919060af0ed5ebf244`.
- Previous rollback: version 2, source `0ea4193fb2f05443c63a79dd2a6530592484f897`, saved version `appgprj_6acdec2bcdfc8191a67ebb95ba0c4cbe~appgver_77bbf3a3e1c48191a10d24b23343e7f5`.
- Runtime: React/Vinext, Cloudflare Worker, D1 `DB`, R2 `BUCKET`, pdf-lib/fontkit and licensed Noto Sans TC font. `package-lock.json` is the only dependency lockfile.
- Formal contacts/prices are blank. `ADMIN_EMAILS` is deliberately unconfigured in production; the owner said to develop the platform first. Public catalogue has **zero** approved people, with an honest empty state.

## Implemented workflows

- Search/filter/sort/page published candidates, view profile and portrait, save up to 30 and compare up to 3, download public PDFs, carry selected candidate IDs into employer registration.
- Separate multi-step employer/jobseeker forms, conditional service fields, negotiable budgets, structured work history, photo upload, explicit public-profile consent, opt-in local draft, review and idempotent retry after a lost response.
- Private record correction with original data retention, notes/follow-up, version conflicts; candidate draft/review/publication/pause; employer/jobseeker matching, interview/stage tracking; editable contact/fees.
- Single/selected/batched complete and client PDFs, employer matching bundles, portrait/CJK rendering and memory/size bounds. Customer PDF excludes private contact details and staff notes.
- Service, process, fees, FAQ and contact pages. Search-first agency UI and compact admin tables; no invented counts, reviews or contact details.

## Evidence already obtained

Local checks on this exact app source: 123 isolated in-memory API/PDF checks, 31 new HTTP checks and 39 previous HTTP regressions, plus batch boundaries. Browser journeys covered filtering, favourites/comparison, employer selection, lost-response retry, definitive retry rejection, private photo registration, correction, publication consent, matching, client/full PDFs and settings.

Browser layout checks covered public pages and four **loaded, authorized** admin pages at 360px with reduced motion. Live readback confirmed 1.1.0/schema readiness, R2 binding, 34 HTTP assertions, 9 mobile pages, keyboard menu toggle and no browser console errors. Anonymous and forged identity header requests were denied by the private APIs. Invalid production requests saved no records; live intake database remained empty.

These checks used a browser viewport, not a physical phone. Complete valid intake, approved profile/photo and PDF flows were checked locally; no real production administrator or applicant was configured. Do not turn those limitations into a claim of real-account production acceptance.

Local synthetic data and uploaded objects were removed. Temporary Mac server on 5177 and the two task browser sessions were closed. The Mac keeps the V3 deployment archive, V2 rollback and detailed receipts/screenshots under ignored `work/`; these are not automatically available in cloud. Do not copy the Mac's dependency environments, auth sessions or databases.

## Start cloud work

1. Clone or reuse only HireHire. Read `AGENTS.md` and this file. Verify the actual Git remote, current commit, branch, clean/dirty state and cloud cwd/OS before claiming takeover. Preserve any existing cloud changes.
2. Use a dedicated development branch and the current remote main, whose history includes the released baseline above. Install locked dependencies once if absent. The unit tests need `pdftotext`; install the normal platform package if available, or report that precise gap.
3. Run the appropriate baseline checks serially. Read the reference site's real search/profile/compare/registration flows and our current code before selecting the next bounded improvements.
4. Continue the owner's existing request: make the platform useful and more complete. Prioritize observed friction in candidate selection and completing registrations, then the corresponding admin/PDF workflow. Choose concrete gaps supported by inspection; do not introduce payment, messaging, invented profiles, alternative auth or an architecture rewrite.
5. Implement and verify a coherent set of changes, commit/push and prepare a reviewable PR when appropriate. For release, use the existing Sites project and official Sites workflow; verify current live version/ownership first. Keep the public audience and protected behavior in `AGENTS.md`.
6. Return the actual cloud execution cwd/OS, repository and full commit, what changed, checks and limitations, PR/release state and exact follow-up items. No local Mac builds or tests should be requested for cloud-capable work.

HireHire is the owner-selected development source. Sites also maintains its own publishing source repository through its source helper. Do not assume the GitHub development commit and the Sites publishing commit are identical; sync the exact reviewed application content and keep both provenances when releasing. Secrets stay in Sites/session memory, never in GitHub or handoff messages.
