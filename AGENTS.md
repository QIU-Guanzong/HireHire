# HireHire development instructions

## Product and source

- The development repository is `QIU-Guanzong/HireHire`. The product is 家合僱傭 at `https://hire.astock.top`.
- Read `README.md` and `docs/CLOUD_HANDOFF.md` before changes. Reuse the existing checkout, lockfile and suitable worktree; preserve unrelated changes.
- Keep the existing Sites project ID in `.openai/hosting.json`. Do not create a replacement website or change DNS for routine development.
- Keep this project separate from A-Stock, RedHorse, ORI and other business repositories, data and credentials.

## User requirements

- Public employer and jobseeker forms; administrator-only management and PDF exports.
- Services: domestic helpers, postpartum care, elderly care, home cleaning and childcare. Customer-facing copy uses natural Traditional Chinese.
- Contact details and prices remain empty or accurately marked pending until the owner supplies them. The administrator email is deliberately deferred; do not ask repeatedly or infer an email from another account.
- Prioritize practical search, readable profiles, complete registration and daily management. Avoid generic marketing slogans, decorative card grids, gradients, artificial statistics, testimonials or sample profiles presented as real people.
- For substantial UI changes, inspect the reference `https://www.mysweethome.hk/` and a small set of primary UX sources. Translate observations into task-specific design, without copying branding or claims.
- Use short CSS state transitions first, respect reduced motion, visible labels, keyboard focus and mobile layouts. Review actual browser screenshots and relevant journeys; tests do not establish aesthetic approval.

## Protected behavior

- Production admin access stays closed until `ADMIN_EMAILS` is explicitly configured through Sites secrets. Never add a production mock login, hard-coded administrator or client-controlled authorization.
- Public profiles require both current jobseeker public consent and staff publication. Old registrations never become public automatically. Admin edits cannot grant public consent on behalf of the applicant.
- Keep public profile/PDF fields independent from private intake data. Public and client PDFs exclude phone, email and internal notes; complete PDFs require admin authorization.
- Preserve intake idempotency, uncertain-submission retry payloads, optimistic version conflict handling, original submissions, photo ownership/expiry and stable PDF batch ordering.
- Existing migrations are immutable. Add migrations for schema changes; never reset a production database.
- Never commit credentials, `.dev.vars`, production/customer data, browser sessions, `node_modules`, databases, builds or `work/` evidence. Never print secrets.

## Validation and release

- Use Node >=22.13 and the existing `package-lock.json`; install with `npm run install:ci`. Do not switch package managers or upgrade dependencies to solve environment setup.
- Relevant checks: `node node_modules/typescript/bin/tsc --noEmit`, `node scripts/platform-check.mjs --unit`, then `npm run build`, serially. The PDF tests require Poppler `pdftotext`.
- HTTP checks only accept loopback: `node scripts/platform-http-check.mjs http://127.0.0.1:5177`. Use synthetic local fixtures and remove only their exact IDs/objects. Do not create valid production test submissions.
- For UI changes, cover desktop, 360px mobile, keyboard and reduced motion. Check the affected workflow, including empty/error/retry/back/success states and PDF rendering when relevant.
- Commit and push validated changes to HireHire. Follow the Sites skill for source synchronization, packaging, saving and publication to the existing public project. A GitHub commit/PR is not a deployed release; report each state accurately.
- If cloud access cannot publish, preserve a reviewable branch/PR and report the specific missing capability. Do not fabricate a deployment result or move the work back to the Mac for heavy tests.

## Resources and cleanup

- Keep task scripts, previews and evidence in `work/`. Record task-owned ports/processes; stop temporary services and browsers after verification.
- Run builds and browser tests serially; keep browser workers bounded. Do not copy whole environments or repeatedly rebuild unchanged inputs.
- Retain the latest verified release, one usable rollback, required evidence and original licensed assets. Delete only confirmed rebuildable or byte-identical temporary files, with exact paths and a cleanup receipt.
