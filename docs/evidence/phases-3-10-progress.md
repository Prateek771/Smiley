# Execution ledger — Phases 3–10

Plan: docs/superpowers/plans/2026-10-01-phases-3-10.md
Start checkpoint: 7b443ae49402fd22c8908b7a91a96cbb92cee0f3 on dev.
Owner authorization: proceed continuously through Phase 10; stop for a genuine issue needing owner attention.

Ruling: existing Tailwind/native accessible controls for Phase 3 — avoids an unnecessary UI dependency for this small first journey; can adopt shadcn later if justified.
Ruling: public /demo uses only synthetic fixture snapshots; protected /desk uses PostgreSQL — prevents demonstration role controls from becoming a security boundary.
Ruling: parallel bounded UI, schema review and local-runtime preparation; sequential backend integration — keeps independent work moving with explicit file ownership.
Ruling: database providers/model/OCR/production permission are deferred — local synthetic PostgreSQL/private test storage can complete this authorized scope.
Pre-flight: Phase 3 fixture view models feed demo only; Phase 4 source inventory feeds Phase 5 migration repairs; phases 6–10 share verified Actor/scoped transaction contracts. No worker/AI is introduced.

## Phase status

- Phase 3: local validation complete; 18 desktop/mobile browser tests GREEN after route-absence RED, screenshots reviewed, lint/types/build passed. Committed 51bdf978; source review 43f73244 inherits the same application. [Exact CI 43f73244 passed](https://github.com/Prateek771/Smiley/actions/runs/36837998840) and was promoted to main.
- Phase 4: complete static inventory review; 42 tables/428 columns/69 FKs/4 views/52 enum sets rechecked, source hashes unchanged. No source SQL executed.
- Phase 5: locally complete; 14 real PostgreSQL tests pass on both the working and restored synthetic database. All 52 tables/four views and additive data preservation verified. Independent review found two edge cases; additive 0002 fixes both with regression tests. Exact CI pending checkpoint push.
- Phases 6–10: pending preceding interfaces and checks.

## Continuing execution notes

- Original checkout `main` is at 43f73244; worktree remains `dev`. Future SQL/identity code is uncommitted until relevant tests pass.
- PostgreSQL 17.11 is loopback-only on 5442, separate non-owner app/migration roles; no source bootstrap executed. Disposable backup/restore passed; restore upgraded to three migrations, 463 constraints, and preserved numeric/version sentinel.
- Phase 6 identity/lifecycle is staged and typechecked, held until Phase 5 passes. Cookie authorization re-reads staff/membership; platform gets no clinical scope.
- Phase 7 policies/access helpers/tests are prepared under ignored original `tmp/phase7-stage`; publish after Phase 6 checkpoint, observe direct-SQL RED before policy application.
- Phase 8 full protected registration/case/API/UI slice is staged independently and held until Phase 7 contracts pass.
- Phase 9 action/history service/tests are staged under ignored original `tmp/phase9-stage`; publish after Phase 8, observe action tests RED before production implementation. Query responses remain locally prepared, never presumed payer acknowledgement.
- Phase 10 private-file adapter has 9/9 real-filesystem checks, staged under worktree `tmp/phase-10-files`; DB/storage integration and routes follow sequentially.
- Playwright MCP reviewed at owner's linked repository. Owner permits it if needed. Existing Playwright Test + agent-browser cover this scope, so no redundant configuration installed.
- GitHub CI now prepares an ephemeral PostgreSQL service with random masked credentials and checks real migrations/seeds/integration; verify its first database checkpoint before promotion.

- Phase 5 independent review accepted finite NUMERIC and nullable log ownership fixes. Membership granted_by/granted_at/revoked_at fields are explicitly deferred to the Phase 7 additive grant-history migration.

- Phase 5 exact checkpoint `c2b11ce97c3b9a352d9aabe787dc911c259a4558` passed [GitHub CI](https://github.com/Prateek771/Smiley/actions/runs/36841333795) and was promoted to main.

- Phase 6 locally complete: Login, atomic staff invitations, expiry/logout/removal and protected routes; 31 server checks and 30 desktop/mobile journeys pass, plus lint/types/build. [Evidence](phase-6-auth.md). Checkpoint push and exact CI promotion follow.

- Phase 6 exact checkpoint `5660fb70394c59805bcc7fb0ba301060ffd94c99` passed [GitHub CI](https://github.com/Prateek771/Smiley/actions/runs/36843283585) and was promoted to main.

- Phase 7 locally complete: Hospital/branch/role isolation and grant provenance; 44 server checks, 12 focused auth browser journeys and lint/types/build pass. [Evidence](phase-7-access.md). Checkpoint push and exact CI promotion follow.
