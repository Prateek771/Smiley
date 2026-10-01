# Phase 8: Persisted case registration and hospital desk

Status: activated and verified after the Phase 7 access checkpoint. Ready for the root checkpoint; no Git operation was performed by this slice.

## Implemented scope

The protected `/desk` queue and `/desk/new` registration flow connect an owned patient, a curated active cashless policy membership, an encounter in an assigned branch, and an eligible active desk owner. Creating a case persists a `CASHLESS` / `DRAFT` / `REGISTERED` record with version 1, a concrete next action, one immutable `CREATED` event, and an audit entry in the same transaction. Financial amounts and eligibility remain unknown.

The selected policy displays its source category, subcategory, insurer and optional TPA. These relationships come from the policy catalog; the UI does not offer arbitrary combinations.

All reads and writes use the staff session and paired branch permission scope through `withActorTransaction`. Each submitted relationship is checked by the service as well as the database foreign keys. The narrow `smiley_private.lock_case_owner` helper serializes owner assignment against staff deactivation. Client-generated creation keys are scoped to hospital and branch, with a stable payload fingerprint and transaction advisory lock. Exact retries return the original case, including after subsequent case edits; changed payloads return conflict.

Collection APIs exist for cases, patients, memberships and encounters, with a scoped case-detail GET API. JSON writes use the common origin/content-type/body-size guard and generic constraint responses. Protected server actions call the same services. The public `/demo` continues to use fixed synthetic fixtures.

## Verification scope

- Integration tests: linked persistence and NULL amounts; atomic event/audit writes; missing sessions; read-only permissions; cross-hospital and cross-branch denials; wrong patient links; wrong branch encounters; invalid dates; unavailable and inactive policies; stale or wrong-branch owners; concurrent idempotency and later edits; changed payload conflicts; source policy context.
- Playwright desktop and mobile: sign in, register patient, add membership, register encounter, create case, reload, search queue, open/back with filter context; read-only registration denial; assigned branch options; policy context; mobile overflow.
- Lint, route-aware TypeScript check and production build through the root verification commands.
- Inspect desktop and mobile queue, registration and case-detail screenshots using isolated browser sessions. Stop the local server and close the sessions after inspection.

## Current limits

Registration selectors currently return up to 500 recent records per collection. The queue filters search and assigned branch in SQL before returning up to 500 matching cases, and explicitly tells staff when more matches exist. Staff can narrow the filters to find older work. Pagination and dedicated large-catalog search are later work. The UI records draft membership and admission details; it does not calculate insurance eligibility, financial responsibility, insurer authorization or settlement amounts. Only synthetic local seed data is in scope for these checks.

## Results

Tests were activated before production code. The initial 12 integration checks failed because persisted case services were missing; the desktop registration check failed because the starter desk had no registration link. Review regressions reproduced malformed decimal IDs throwing a BigInt SyntaxError, unavailable related catalog records remaining selectable, and the undisclosed queue cap.

- Final targeted Phase 8 integration: 15/15 passed, zero skips. Tests cover the complete linked registration transaction, NULL financial amounts, immutable CREATED event/audit identity, server-derived permissions and hospital/branch scope, relationship mistakes, stale owners, exact concurrent retries, changed-payload conflicts, curated policy context, inactive insurer/TPA/category/subcategory, malformed ID fields, and search/branch filtering beyond 501 newer synthetic cases.
- Final full server suite: 59/59 passed, zero skips, 49.6 seconds.
- Final full Playwright suite: 38/38 passed on desktop and mobile, 1.2 minutes. This includes 12 auth, 18 public synthetic demo, and 8 protected desk/API checks. The first full browser pass identified locator/state assumptions in the new desk tests; the corrected tests select an existing patient before inspecting its encounter branch, use the policy's accessible combobox name, and scope the registration alert to the main region.
- ESLint, route-aware TypeScript, and production build passed after the review fixes. Build generated the protected pages and collection/detail APIs.
- Native agent-browser inspection used an isolated local synthetic session at 1440×1000 and 390×844. Queue, linked case, and selected-policy registration screenshots were inspected; text, controls, unknown financial facts, and policy context remained legible. The mobile queue and registration both measured 390px document width at 390px viewport width. Browser errors output was empty.
- An independent read-only re-review found the shared active-policy predicates and SQL search/branch filtering resolve both reported defects, with no additional actionable issue in that changed slice.

The full dev browser run logged Next.js destination-stream-close messages during aborted navigations and the inherited NO_COLOR/FORCE_COLOR warning. All browser assertions passed; the separate native inspection reported no page errors. These messages are recorded as a development-run limitation, not hidden as failures.

The native browser session was closed and the 3210 development server stopped after capture. Auth regression screenshots now go to ignored tmp/browser/auth, preserving the earlier Phase 6 evidence files.

Reviewed synthetic screenshots:

- [Desktop queue](phase-8/queue-desktop.png) and [mobile queue](phase-8/queue-mobile.png)
- [Desktop case](phase-8/case-desktop.png) and [mobile case](phase-8/case-mobile.png)
- [Desktop registration](phase-8/registration-desktop.png) and [mobile registration](phase-8/registration-mobile.png)

