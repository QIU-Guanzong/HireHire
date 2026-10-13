# Public navigation and search — cloud review

Local review on 2026-10-13 in `/workspace/HireHire`, based on `ae829189f23888107a7bbbca303e388d2c99e30a`. Branch: `codex/public-navigation-search-20261013`. Existing form and client-PDF upgrades remain in the branch history. This batch improves navigation, public search and the path to registration.

## Resulting behavior

The former flat navigation now has separate page links and disclosure buttons for candidate search and employment services. Each group includes the five existing service categories; candidate services lead to filtered results and service links lead to the real service sections. Saved candidates, comparison, process, fees and FAQ are reachable in the appropriate group. Both independent registration entries remain available on mobile. Escape closes one level and restores its trigger; outside pointer, focus leaving, navigation, history, page restoration and breakpoint changes reset the menu. Native links remain usable without JavaScript. No new business categories or content claims were added.

The homepage adds a skill selector to the existing service and candidate-type quick search. The catalog adds education, age range and skill filters, plus earlier-update and age sorts: ten filters and seven single-choice sorts in total. Keyword search now includes the displayed public reference; `%`, `_` and backslash are treated literally. Current applicant consent and staff publication still gate all results, profile data, portraits and public PDFs.

Applied values appear as removable chips. Users can reset sorting or all conditions, see pending edits, and preserve unsent input while sorting or paging. Repeating the same canonical search adds neither a history entry nor an API request. Loading hides old selectable cards; canceled replies cannot replace restored results or move focus. Mobile apply and clear actions focus the visible result heading before collapsing the filter panel.

Profile links carry a canonical search return path. The back link and breadcrumb retain those choices; return targets are restricted to the candidate catalog and its valid query values. Empty results lead to employer registration with supported service, district and work-arrangement prefill. Existing saved lists, three-person comparison, public PDFs and candidate IDs passed to registration were retained and exercised, without rebuilding them.

## Function evidence and remaining gaps

The requested [My Sweet Home reference](https://www.mysweethome.hk/) was reviewed independently on 2026-10-13, 13:41–14:00 UTC. The supplied observations include desktop menus and a 500×761 narrow viewport without a mobile user agent. Those observations do not establish 360px or physical-phone behavior. Contact initially timed out and later opened; a browser-permission block when examining HireHire's live mobile menu is not an application failure. The local measurements below are separate from that reference review.

| Area | Reference observation | HireHire result in this batch |
| --- | --- | --- |
| Navigation | Five groups and nested service links operated | Two real service/search groups, nested five-service links and both registration entries; local desktop, touch and keyboard checks passed |
| Quick search | Five fields, including a working skill search | Three fields: service, candidate type and skill; catalog has age and nationality. No independent overseas-country field was invented |
| Detailed search | Education, experience, language, age, skills and certificates visible; individual sort ordering not fully verified | Three additional public-field filters and three sorts; all seven actual API orders verified across pages. No religion, marital-status or fabricated view-count filter |
| Detail and comparison | Detail chapters and one-/three-person comparison observed; personalized AI, fourth-person limit and persistence not fully verified | Existing public detail, saved persistence, zero/one/two/three comparisons, fourth-person limit, share URL, removal, unavailable state and PDF/registration path verified with synthetic fixtures |
| Services and content | Fees, FAQ, country processes, English, news and branches seen | Existing five services, process and FAQ retained. Additional country-specific, language and knowledge-center content needs a separate scope and verified business sources |
| Administration and PDF privacy | Private reference backend not inspected | Existing admin gate and public/client/full separation preserved; complete isolated suite passed |

Navigation follows the native-link/disclosure approach and Escape/focus behavior described by the [W3C APG navigation example](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/). The existing mobile filter disclosure keeps applied conditions visible outside the panel. The [GOV.UK Details guidance](https://design-system.service.gov.uk/components/details/) was also read when reviewing disclosure visibility; this round does not claim assistive-technology certification.

Company contact details, prices and included services still require owner confirmation. Licenses, qualifications, training, branches, activities, privacy/terms text, language content and approved public candidate data must use actual business information. No reference-company facts were borrowed. This batch does not establish comprehensive feature parity or aesthetic approval.

## Verification

All checks ran serially in this Linux container, with project-local dependencies and synthetic fixtures:

- `node node_modules/typescript/bin/tsc --noEmit` — passed after the final focus fixes.
- `node scripts/platform-check.mjs --unit --public-search-only` — 69 new focused checks passed.
- `node scripts/platform-check.mjs --unit` — 222 checks passed: the original 123, previous 30 client-PDF checks and 69 search checks.
- `npm run build` — final Worker build passed.
- Chromium navigation — 90 checks passed, including desktop, 360px touch emulation, keyboard, reduced motion, both sides of the 700px breakpoint, focus-neutral resizing and no-JavaScript navigation.
- Chromium search and existing collection journey — 116 checks passed, including ten filters, seven sorts, pending input, canonical history, Back/Forward/reload, delayed reply cancellation, empty/error/retry, safe returns, saved persistence, comparison limits/removal/unavailability, public PDF downloads and one intercepted synthetic employer submission.
- Existing intake browser regression — 73 checks passed against the upgraded layout, including both forms, confirmation edits, drafts, photos, consent and unchanged retry payloads.

API tests call the real handlers and PDF renderer with in-memory SQLite and object storage. `pdftotext` checks public/client/full data separation and actual identities/order. Exact fixture IDs are removed in `finally`; no production endpoint, account or data is used. Browser API responses are approved public DTO fixtures; PDF transports use actual rendered synthetic PDFs. Browser submissions are intercepted, with zero real database writes. These checks do not establish real-account, screen-reader or physical-phone acceptance.

Actual desktop/mobile search, comparison and navigation screenshots and a rendered public PDF were visually inspected. Full-page screenshot capture briefly resized Chromium to 1×1px, correctly triggering breakpoint reset; a fixed-viewport screenshot confirms the desktop submenu stays open. This tool effect required no product change. The two actual UI defects found during testing—700px row overlap and focus loss when resizing—were fixed before the passing navigation run.

Evidence is retained in ignored `work/navigation-search/`: focused/full reports, serial logs, browser runners and reports, synthetic PDFs, input snapshot, screenshots and screenshot-event diagnosis. Earlier commits and delivery patches remain intact. The task-owned preview, Worker and browsers are stopped before delivery.

## Delivery state

This is a local reviewable source upgrade, with a commit, patch and incremental bundle. No GitHub push, merge, Sites mutation or publication occurred. GitHub write authentication is unavailable; no credentials were configured. The earlier Library transfer failed on a network request before preparation, and was not retried. The existing Sites project linkage remains unchanged. No administrator setup, payment flow, identity review, migration or production data change is included.
