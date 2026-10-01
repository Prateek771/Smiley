# Phase 7 — hospital, branch and role isolation

## Delivered

Server permission checks and transaction-local, authenticated database context; FORCE RLS on all 48 domain/operational tables; non-owner application connections; invoker views; platform/hospital privilege separation; narrow invitation and eligible-owner lock helpers. Grant history is additive 0003; RLS is additive 0004. Applied 0000–0003 were preserved.

## Regression evidence

Before applying test RLS, eight of nine real access checks failed for the intended reasons: unrestricted reads, wrong hospital/branch assertions, forbidden Billing writes, platform grants and pooled context. Negative write probes roll back even on unexpected success. After applying RLS, all nine access checks and three branch-role unit checks passed (12/12; zero skips).

Checks cover non-owner/NOBYPASSRLS/FORCE configuration; unscoped tables and views; hospital and branch isolation; real role ceilings; platform metadata without clinical access; revocation against an existing session; and context reuse. A separate database check verifies grantor ownership and grant/revocation timestamps.

Seventeen auth regressions ran again under RLS. New assertions first reproduced missing grantor/revocation times and expired-token locking errors; service changes record the inviter and timestamps, use the narrow row-lock helper, and preserve controlled expiry/replay responses. Focused browser and full server/static checks are recorded in the execution ledger when complete.

The database CLI now supports `--test` before connection loading and rejects unknown flags. An initial controller invocation used the development connection; it only applied approved additive migrations to the empty synthetic development DB. The isolated test DB was then explicitly migrated and checked. No data reset, changed applied SQL, or production database operation occurred.

## Scope

See [access model](../access-model.md). No support impersonation or production permission is introduced. Database RLS protects trusted server-derived context; arbitrary SQL access/host compromise is outside the HTTP application boundary.

Migration SQL is marked `-text` in Git attributes so checkout line-ending conversion cannot change an applied Drizzle checksum. Existing SQL bytes are preserved; no applied migration is rewritten.
