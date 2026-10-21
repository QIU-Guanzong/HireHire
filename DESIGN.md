# HireHire design rules

These rules record the existing product baseline; they do not authorize a redesign.

- Keep the warm yellow and purple service brand, existing typography, spacing and plain CSS. Reuse Next/React components and the current lockfile; no replacement UI stack or global tools.
- Treat employer enquiries and jobseeker registration as separate tasks. In an unfiltered public catalogue with zero results, make the employer-needs link primary and jobseeker registration secondary. Reduce the emphasis of empty saved/compare controls and omit sorting when there are no results.
- A filtered zero-result response means only that the current conditions matched nothing. Preserve those conditions, allow individual removal and provide a clear-all action. Do not imply that private records are absent or the search is broken.
- Retain the existing mobile filter disclosure, readable candidate summaries, profile links, saved lists and comparison. Never invent public candidate profiles or statistics.
- Use Traditional Chinese and English for fixed interface text. Keep names and free-text queries verbatim.
- Keep keyboard focus visible, respect reduced motion, and aim for 44 CSS px primary touch targets as a project target. Ordinary text contrast must reach 4.5:1; large text 3:1.
- Review matching local before/after states at 1440×900 and 390×844, with the same synthetic data and locale. Preserve original evidence; screenshots alone do not establish interaction correctness.

