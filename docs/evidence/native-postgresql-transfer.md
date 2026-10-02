# Native PostgreSQL transfer — 2 October 2026

Smiley's development and isolated test databases now use the installed Windows PostgreSQL 18.6 service at `127.0.0.1:5432`. The project no longer needs Docker, a Compose file, a database image or a container-based CI service.

## Data and access preservation

The existing private custom-format backups were restored into previously unused native database names. Before changing connection settings, both destinations matched the saved snapshots for all 53 tables (52 application/domain tables plus the Drizzle ledger), every row count and SHA-256 row-content hash, all sequence states, table owners/grants/RLS flags, schemas, functions, reporting views and 128 policies per database. UTC was used for comparisons to avoid host timezone presentation differences.

Development retains four registered cases and three document revisions; all three original private files remain readable at their unchanged configured storage path. `BETTER_AUTH_SECRET`, original staff records/credentials and the separate app/migration identities were preserved. Neither identity has superuser, database/role creation, replication or RLS-bypass privileges. The temporary administrator password used for transfer is absent from application configuration.

No source bootstrap SQL, destructive reset or applied migration modification was used. The user's later instruction forbidding Docker invocation was honored throughout the approved import and switch. Saved source backups and offline recovery material remain private and ignored; no unrelated databases or machine-wide software were removed.

## Project changes

- `scripts/db-runtime.mjs` replaces the container PowerShell script with native setup/start/status commands. Setup refuses name collisions and incomplete configuration; start never stops a shared PostgreSQL service.
- Connection validation requires matching loopback servers, dedicated identities and isolated database names, and rejects driver query overrides.
- CI uses a native PostgreSQL 18 cluster on loopback port 55432, from installed binaries or the official PostgreSQL Apt repository.
- Environment placeholders, README, contributor guide and database recovery instructions describe native PostgreSQL.
- One integrity test accepts the PostgreSQL 18 RESTRICT SQLSTATE while explicitly checking retained case/history rows. Actual database constraints and migrations are unchanged.

## Verification

- Exact backup/destination comparisons passed before cutover.
- All four restricted connections, native startup and additive migration repeat passed.
- 112 unit/server checks passed, zero failures/skips.
- 15 fresh foundation/additive migration checks passed on a separate temporary native cluster.
- Fresh native setup, unchanged repeat setup, restricted roles and collision refusal passed independently.
- Lint, TypeScript and production build passed.
- All 58 desktop/mobile browser journeys passed. Windows test-server cleanup required stopping only the finished test process tree; the runner then exited successfully.
- Localhost:3000 returned HTTP 200 for preserved staff sign-in, protected queue, case details and an original private document download. Hosted CI is pending the dev checkpoint.

The independent review's connection-override finding was fixed with a regression that failed before the fix and passed afterward. Runtime errors still use a broad sanitized diagnostic to avoid exposing credential details; this is a minor usability limitation.
