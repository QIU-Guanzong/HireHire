# HireHire product boundaries

家合僱傭 helps households describe their needs and browse approved public profiles, while jobseekers register through a separate form. Staff manage private registrations, matching and authorized PDFs.

- The public catalogue shows only consented, staff-published profiles. Zero public results say nothing about private registrations or unpublished profiles.
- Catalogue states are: an unfiltered successful empty response, no matches for retained filters, and available public results. Loading, request failure and an out-of-range page remain separate states.
- Employer enquiries can begin without choosing a candidate. Preserve supported service, district and work-arrangement prefills; never convert a search term into personal information.
- Required fields remain defined by the existing shared validation. Optional details can be left blank. Show errors near fields and in the existing summary; preserve inputs after validation or submission failure. A confirmed receipt explains how the team will contact the user next.
- Maintain explicit consent, idempotency, photo protection, optimistic version checks and public/client/full PDF separation. No payment or identity changes are part of catalogue UI work.
- Development uses local synthetic fixtures and intercepted mock responses, never real people or production form submissions. Production changes require the existing publishing owner and separate review; a draft PR is not a deployed release.
