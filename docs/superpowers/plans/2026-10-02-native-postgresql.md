# Native PostgreSQL Migration Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the existing dev worktree.

**Goal:** Preserve Smiley's development and isolated test databases while replacing the project container runtime with the installed local PostgreSQL 18 service.

**Architecture:** Back up both source databases, restore into unused native databases with the same restricted app/migration identities, compare data and security metadata, then switch ignored connection settings. Native setup/status commands and a native CI database replace container configuration.

**Tech Stack:** Node.js 24, PostgreSQL 18, pg_dump/pg_restore, existing Drizzle migrations and Playwright checks.

**Spec:** User request in this chat: move the database to installed PostgreSQL and remove the project's Docker dependency entirely.

## Constraints and review focus

- Preserve existing rows, sequences, migration history, ownership, grants, RLS policies, authentication secrets and private file paths.
- Never overwrite an existing native database or unrelated role. Do not reset administrator credentials or weaken pg_hba authentication.
- Backups and credentials stay in ignored tmp; applied migration files remain unchanged.
- Remove the project Compose configuration and container-based CI service. Keep historical evidence explicitly historical.
- Keep the old source recovery material without operating Docker, following the later user instruction. Verify the native connection endpoints directly. Do not uninstall machine-wide software or delete unrelated resources.
- Stop the app during the final dump/cutover so concurrent writes cannot be missed. Stop it during tests that rebuild .next and relaunch after verification.

## Tasks

- [x] Inventory native service, source database roles, native naming conflicts and authentication; obtain existing admin credential privately.
- [x] Add regression checks for native configuration safeguards; implement native setup/start/status and remove the Compose runtime. Five safeguard tests and live fresh setup/idempotence/collision checks pass.
- [x] Back up configuration and both databases; restore to empty native databases and compare every table, sequences, migration ledger and security metadata before cutover.
- [x] Update README, environment example, contributor guide, database guide and CI to native PostgreSQL; record transfer evidence in BUILD_PLAN.md.
- [x] Run integration, lint/type/build and desktop/mobile checks on native PostgreSQL; verify preserved staff login, case access and document download on localhost:3000 without invoking Docker.

## Progress

- Native PostgreSQL 18.6 service is running at 127.0.0.1:5432. The user manually recovered the forgotten administrator password and removed the temporary trust rule; a read-only check confirmed authentication and zero trust rules before approving the transfer.
- Existing source uses 127.0.0.1:5442, separate restricted app/migration roles and two databases. The earlier startup-quoting failure is eliminated by replacing the runtime rather than patching the retired script.
- Both source databases have private custom-format backups and full table/sequence/security snapshots in ignored tmp. Each has 53 tables including the migration ledger and 128 policies. Take a fresh final backup with application writes stopped before restoring.
- Both databases were restored into unused native names and matched every saved table hash/count, sequence, schema, function, view, owner, ACL and all 128 policies per database. Hash comparisons use UTC consistently because the native Windows server displays timestamps in local time.
- Connections switched to native 5432 using the original restricted role credentials. Original auth secret and private file paths remain unchanged; the temporary administrator credential was removed from application configuration.
- Ruling: Respect the later user instruction not to invoke Docker. Restore the existing reviewed backups and retain source recovery material without operating the old runtime. No new application writes were made between backup and cutover; the preview was stopped during the switch.
- The independent review found query-string connection overrides could bypass loopback/identity checks. A failing regression was added, URL query/fragment overrides are now rejected, and all five safeguard tests pass. Generic runtime failure messages remain a minor diagnostic limitation.
- PostgreSQL 18 returns SQLSTATE 23001 for the protected RESTRICT delete where the previous version returned 23503. The test now permits either specific integrity denial and additionally asserts that both the case and immutable event survive. No applied migration bytes or protection rules changed.
- Verification so far: 112 unit/server checks pass with zero skips; 15 fresh foundation/additive checks pass on a separate native cluster; fresh setup, configuration idempotence, restricted roles, four connections and name-collision refusal pass. Lint, typecheck and production build pass. All 58 desktop/mobile journeys passed with exit code zero after stopping the finished test server tree during Windows cleanup. Localhost:3000 is running; preserved staff sign-in, queue, case details and document download returned HTTP 200.
