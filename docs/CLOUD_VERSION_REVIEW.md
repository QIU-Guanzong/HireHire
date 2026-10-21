# Brand version local review

The header and health endpoint use the application version from `package.json` (1.1.0). The quiet version badge remains visible at desktop and 320/360/393px widths. Its hydrated `正式站` / `預覽` text describes the browser entry point; it is not deployment verification or an authorization boundary. Without JavaScript the version is visible and no release mode is asserted.

Shared workspace CSS now enters through the root layout. The previous production RSC manifest preloaded a missing CSS-only JavaScript chunk on employer, jobseeker and admin pages. The same missing preload existed in the preserved 7427 Worker archive. Moving the existing stylesheet import fixes the generated references without changing CSS rules or filtering browser errors.

Local checks completed before this commit: TypeScript, 683 isolated API/PDF assertions, production Worker build and 39 browser assertions passed. Browser checks used synthetic responses and loopback transport only, including virtual canonical/preview hostname classification, keyboard focus, reduced motion and no-JavaScript SSR. All contexts closed; no console errors or mutations. Evidence is retained under ignored `work/version-badge-20261014/`.

This is unpublished cloud development after visual commit `2c3b82589ba99ee64b1b6795480f9b3356c2c848`. It does not alter the publisher-confirmed V4 release (GitHub 7427, Sites source 9772). No push, production data, Sites deployment or DNS change occurred. The owner subsequently authorized a separate GCP migration branch; existing Sites storage and release artifacts remain rollback evidence.
