# Phase 9: Controlled actions and case history

Status: locally complete; exact checkpoint CI promotion is recorded in the execution ledger.

## Delivered behavior

Assigned preparation staff can edit owner, next action, and an IST deadline; mark a draft ready, start preparation, or cancel it with a reason. They can record repeated payer queries and save local response drafts. The case history retains actor, time, version, action, and before/after values. Billing can read the history but cannot perform preparation actions.

Mutations lock the scoped case row and require its expected version. Exact action retries reuse their event; changed payloads or stale versions return409. Case update, immutable event, and audit entry commit together. The edit form reloads all authoritative values when the version changes, while retaining the conflict notice for staff review.

Query references are unique within hospital/case. Additive migration0005 backfills existing internal query numbers into the new external reference, preserving question/response text. SQL and snapshots0000–0004 retain their prior hashes.

## Verification

- Missing implementation RED:10/10 new server checks failed before activation.
- Readiness regression RED: a legacy query on a draft could receive a response before preparation started; the matching state guard now rejects it.
- Two-tab browser RED: after409 and refresh, the old typed next action remained in the uncontrolled field. Version-keyed form refresh corrects owner, deadline, and next action together.
- GREEN:10/10 timeline checks and69/69 full server checks, zero skips. Covers concurrent edits, duplicate actions, malformed IDs, invalid transitions, role/tenant denials, immutable history, and repeated response drafts.
- Fresh isolated `sehospitaldb_phase9_preservation_test`:15/15 database checks; inserted a legacy query before additive migration and verified its identity, question, response, and backfilled reference afterward. Database retained for inspection; development and ordinary test databases were preserved.
- Browser: all 30 existing auth/demo checks passed in the full run; all 16 desk/timeline checks passed after repairing a test fixture collision by selecting fixed seed encounters. Exact checkpoint CI runs all 46 together.
- ESLint, route generation/TypeScript, and production build passed. Reviewed desktop/mobile screenshots show persisted history, repeated queries, and preparation forms without horizontal overflow.

Independent reviews found and verified repairs for malformed BigInt IDs, query-date schema alignment, readiness gating, and stale form values. Reviewed synthetic screenshots are published under `phase-9/`; raw captures remain ignored. Development-mode rapid navigation emits Next.js closed-stream/Gzip listener warnings; production smoke is included in the final Phase 10 checkpoint.

## Limits

Responses remain locally prepared; payer acknowledgement is pending. Payer approval, rejection, financial calculation, and bank receipts are unavailable through this preparation API. Events cannot be edited or deleted, including through the migration role. Source evidence/document revisions follow in Phase10.
