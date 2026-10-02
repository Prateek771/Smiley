# Phases 11–15 validation — 2 October 2026

## Delivered checkpoint

| Phase | Result | Local commit |
| --- | --- | --- |
| 11 | Versioned bills, exact paise assessments and evidence-linked Billing forms | `087ade4` |
| 12 | Frozen claim packs, actual external acknowledgements and repeat-query resolution | `0ef2833` |
| 13 | Evidenced payer decisions, Billing confirmation, patient payments/refunds/reversals | `b42975b` |
| 14 | Immutable remittances, shared allocations, residual/partial/overpayment follow-up | `62b2726` |
| 15 | Separate durable worker, live-context checks, bounded retries and owner recovery | Commit containing this report |

The final Phase 15 commit also includes independent-review corrections: higher approval can reduce patient responsibility, a revised decision source invalidates downstream facts, and hard worker crashes preserve attempts/recovery across the queue's fetch-to-handler gap. Applied migration bytes were preserved; migrations 0006–0009 are additive. There are 57 public tables, with Graphile internals in its separate private schema.

## Verification

- **133/133** unit/server/database/API checks passed, with zero failures/skips (274 seconds locally). This includes financial calculation/scoping, stale revisions, payment allocation, retries, immutable history and real child-process termination.
- **2/2** served production HTTP scenarios passed (23 seconds): actual sign-in for Desk/Billing/Finance/foreign hospital, guest redirect, role controls, scoped APIs, cross-origin rejection and the fourth-login throttle. The first HTTP run exposed the expected three-per-ten-second limit; the test now asserts 429/no cookie and honors its retry window without changing application security.
- ESLint, fresh route/type checking and production compilation passed. A final rebuild after two outdated status-label corrections also passed.
- Codex in-app browser AX review signed in each hospital role. Desk requested a background review and saw `COMPLETE` once. Billing saved a confirmation (case version 16). Finance saved a fictional ₹80,000 remittance against ₹82,000 authorization; the page showed ₹2,000 still receivable, separate from the ₹3,000 decision dispute. Mobile job controls/status fit 390×844. No browser console errors were captured.
- Private raw screenshots remain ignored in `tmp/phases-11-15/`: `final-staff-workspace.png`, `final-mobile-job.png`, `final-billing.png`, and `final-finance.png`.
- Independent final review reported no remaining critical or important findings after the financial and crash-recovery regressions passed.
- Native PostgreSQL connections verify port 5432 and restricted app/migration identities. SHA-256 comparisons preserve all **51 existing non-session public tables**; all **three private document files** match their stored hashes. Existing database identity/passwords, auth secret and storage path remain unchanged; session rows naturally changed during earlier sign-in review. The original four development cases remain preserved. All new workflow fixtures/actions were confined to the test database.

## Tooling and limits

Ponytail's Markdown core was inspected and installed for Codex at pinned upstream `e3ba2aa6f1e6f0bc4d69eb09c9f0d0a93af56156`. SkillSpector returned score 0/LOW/no findings; semantic review approved it. No executable hooks were installed. Its reuse/simplicity guidance preserved security, validation, accessibility and failure handling.

Docker, Vercel agent-browser and Playwright were not invoked in this build or its CI workflow. Historical browser suites remain in the repository but were not rerun; the current proof combines Node HTTP checks and focused Codex desktop/mobile review, not equivalent exhaustive browser coverage.

Rules and evidence are synthetic. Payer submissions, decisions and receipts are manually recorded facts, not provider integrations. LangGraph/model/OCR work begins at Phase 16. Real hospital validation, hosting and multi-host worker operations remain later gates. GitHub CI must pass the exact pushed checkpoint before main promotion; its run is recorded in the execution ledger below after completion.
