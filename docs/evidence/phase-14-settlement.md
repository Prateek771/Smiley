# Phase 14 — immutable remittance reconciliation

Finance records bank evidence, exact paise, a unique external reference and claim allocations against current final decisions in the same branch. Unmatched residual money stays visible. Immutable reversals restore balances without deleting receipts. Foreign keys preserve hospital, branch, claim, decision and evidence scope; forced RLS restricts access. Database triggers reject allocations beyond the receipt and allocations to reversed receipts.

Two integration scenarios passed after a missing-service failure: one ₹1,62,000 receipt split across two claims leaves ₹2,000 unmatched; an ₹80,000 allocation against ₹82,000 authorization leaves ₹2,000 receivable while the separate ₹3,000 decision dispute remains. Exact imports/reversals repeat safely. Duplicate references, overallocations, stale decisions and wrong roles fail. An actual ₹90,000 allocation shows ₹8,000 overpayment for Finance review.

Lint and fresh TypeScript checks passed. Additive migration `0007_remittances.sql` preserves prior applied bytes. Production HTTP/browser verification and full-suite results are recorded in the final report.
