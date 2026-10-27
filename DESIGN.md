# HireHire design rules

This document records the existing product baseline and the owner's 2026-10-27 request for clearer frontend/backend behaviour and natural language. It does not authorize a redesign, new business features or a production release. Read [requirements and acceptance criteria](docs/REQUIREMENTS.md) and [AGENTS.md](AGENTS.md) together.

## Tasks, layout and accessibility

- Keep the warm yellow and purple service brand, existing typography, spacing and plain CSS. Reuse Next/React components and the current lockfile; no replacement UI stack or global tools.
- Treat employer enquiries and jobseeker registration as separate tasks. In an unfiltered public catalogue with zero results, make the employer-needs link primary and jobseeker registration secondary. Reduce the emphasis of empty saved/compare controls and omit sorting when there are no results.
- A filtered zero-result response means only that the current conditions matched nothing. Preserve those conditions, allow individual removal and provide a clear-all action. Do not imply that private records are absent or the search is broken.
- Retain the existing mobile filter disclosure, readable candidate summaries, profile links, saved lists and comparison. Never invent public candidate profiles or statistics.
- Use Traditional Chinese and English for fixed public interface text. The current private administration interface uses Traditional Chinese. Keep names, submitted answers and free-text queries verbatim; a locale switch must not translate or rewrite them. See `components/locale-provider.tsx` and `lib/i18n.ts`.
- Keep keyboard focus visible, respect reduced motion, and aim for 44 CSS px primary touch targets as a project target. Ordinary text contrast must reach 4.5:1; large text 3:1.
- Review matching local before/after states at 1440×900 and 390×844, with an additional 360px workflow check as required by AGENTS, the same synthetic data and locale. Preserve original evidence; screenshots alone do not establish interaction correctness.

## Complete registration and private follow-up

The primary journey is candidate selection (optional) → employer/jobseeker form → review → submission receipt → authorized staff follow-up. Each transition must describe its actual state, not the desired eventual result.

| State | UI requirement | Source / check |
| --- | --- | --- |
| Editing | Retain answers when going back; saving a browser draft is opt-in. Warn if persistence fails. | `components/intake-form.tsx`; draft and locale regression scripts |
| Submitting | Prevent concurrent clicks; retain the exact attempt and attachment claim. | Submit handler; `scripts/intake-response-check.mjs` |
| Unconfirmed result | A timeout or malformed success response is not a rejection. Keep the original envelope/key; offer an explicit confirmation retry, without an automatic new submission. | Submit handler and `/api/intake` idempotency contract |
| Confirmed receipt | Show success only for a successful HTTP response with a non-empty string reference. Clear only the owned draft. A receipt means the registration was stored, not that staff contacted or placed someone. | `app/api/intake/route.ts`; response regression |
| Staff correction | Preserve the draft on a failed or unconfirmed save. Use the existing version for conflict detection; require review of newer data before overwriting. | `components/admin-workspace.tsx`, `lib/admin-request.ts`, record PATCH route |
| Publication | Explicit current applicant consent and staff publication are both required. Private data and internal notes never become public merely because a record was saved. | Candidate routes, `lib/server.ts`, `AGENTS.md` |

A browser-local saved/compare selection is not an account-level favourite. Separate list writes are not a transaction; do not promise every in-memory selection survived a storage failure. An administrator interface being implemented does not mean it is enabled in production.

## Language rules that can be checked

Use the owner's existing product wording and Hong Kong Traditional Chinese conventions. Locale and register are separate: selecting Traditional Chinese is not permission to introduce Taiwan-specific terminology or convert text into Cantonese by character substitution. Keep a consistent term for the same action (for example, 登記, 收藏, 比較); do not alternate synonyms to make routine controls seem more varied. These rules apply to UI copy; they do not rewrite submitted text.

- Start with the result or required action. Omit empty introductions, ceremonial closings and mechanical praise. Do not pretend an automated interface is a person. This adapts [Fluent 2 content engineering](https://fluent2.microsoft.design/content-engineering) to state-driven UI.
- Write from the user's task, use short concrete sentences and consistent terminology. Preserve useful detail instead of shortening an error into a vague label. See [Ant Design copywriting](https://ant.design/docs/spec/copywriting-cn/).
- For known validation failures, name the affected input and how to fix it. For an uncertain write, say the result is unconfirmed and explain how to check it. Never invent the cause of a network/server error. See [GOV.UK error messages](https://design-system.service.gov.uk/components/error-message/).
- “已儲存”, “已提交” and equivalent English success text require the corresponding validated success state. A clicked button, HTTP 200 alone, or a local in-memory change is insufficient.
- Keep necessary “可能” or “未能確認” wording. Any future style checker must warn for human review; it must not delete uncertainty or turn an inference into a fact.

Illustrative acceptance examples (not additional product promises):

| Situation | Avoid | Prefer |
| --- | --- | --- |
| Required telephone missing | 系統異常 | 請填寫電話。 / Enter a phone number. |
| Write result unknown | 已儲存！ / 因網絡不穩而失敗。 | 未能確認是否已儲存。修改仍在本頁，請核對最新資料後再儲存。 |
| Receipt received | 已安排配對並通知僱主 | 登記已提交，followed by the actual registration reference |
| Draft only in memory | 草稿已保留，可以關閉頁面 | Explain that browser storage failed and closing may lose the input; keep the existing recovery controls. |

The 2026-10-27 patch changes the state guard, not these translations: `components/intake-form.tsx` previously treated `{ "reference": {} }` as success; it now retains the unconfirmed attempt. `scripts/intake-response-check.mjs` demonstrates the before/after behaviour. No new prose implies that a receipt or draft was saved without evidence.

## Generated language: conditional guidance, not an implemented feature

This audit adds no model endpoint, paid model, prompt framework or automated applicant messaging. If generated assistance is introduced under a separate confirmed requirement, its first sentence should answer the question, use structure only when helpful, and avoid default three-part summaries, automatic agreement or a closing question. Distinguish sourced facts, inference and advice; do not supply invented reasons, scores, profiles or claims of real-time knowledge. Use synthetic/offline fixtures first and record model/version, locale and observed output when actual model testing is authorized. Until then, real-model quality is unverified.

## Review boundaries

Document checks, handler-level regression, rendered browser interaction, physical-device testing and production acceptance are separate evidence. Record the source SHA and runtime for each. A warning-free style check or a screenshot cannot establish API authorization, durable storage or successful submission. Release checks and private transport requirements remain in [AGENTS.md](AGENTS.md) and [GCP handoff](docs/GCP_MIGRATION_HANDOFF.md).
