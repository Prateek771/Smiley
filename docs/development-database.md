# Local synthetic PostgreSQL

This runtime supports local development and disposable synthetic tests. It is separate from all existing Docker containers and does not run either supplied bootstrap SQL script. Application schema changes belong to reviewed Drizzle migrations.

## Start, inspect, and stop

Use Node.js 24+ and the installed Docker Desktop with Linux containers. Start Docker Desktop first, then run these commands from the worktree root:

```powershell
.\scripts\db-runtime.ps1 start
.\scripts\db-runtime.ps1 status
.\scripts\db-runtime.ps1 stop
```

`start` generates fresh random local secrets on first use, starts PostgreSQL, waits for health, and creates the two databases and their application role. Subsequent starts retain credentials and data. `stop` retains the container and volume. No command deletes databases, volumes, containers, or personal runtime files. If Docker is not on PATH, the script checks the existing per-user Docker Desktop installation.

The script refuses to replace incomplete configuration once data exists or to operate on an unrelated container with the same name. Keep the ignored runtime configuration with its data volume. Docker initialization variables only apply to an empty volume; editing the password file does not rotate an existing database password.

## Connection and isolation

| Setting | Value |
| --- | --- |
| Host and port | `127.0.0.1:5442` |
| Development database | `sehospitaldb` |
| Test database | `sehospitaldb_test` |
| Application login | `smiley_app` |
| Migration login / database owner | `smiley_migrator` |
| Container | `smiley-dev-postgres` |
| Data volume | `smiley-dev-postgres-data` |
| Docker Compose project | `smiley-synthetic-local` |
| PostgreSQL | 17.11, Linux amd64, Alpine |
| Pinned official image | `postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24` |

Only loopback is published. `smiley_app` has no superuser, role-creation, database-creation, or replication privilege. It owns neither database nor application tables. The separate `smiley_migrator` role owns both databases and creates objects through reviewed migrations; it also has no superuser, role-creation, database-creation, replication, or row-security-bypass privilege. Root migrations grant explicit application permissions and establish tenant policies. PostgreSQL table owners normally bypass row-level security unless `FORCE ROW LEVEL SECURITY` applies: owning the development schema is not evidence of tenant isolation. Test server authorization and any database policies explicitly.

The bootstrap superuser is used solely for local role/database setup through the container's Unix socket. Its secret is stored in ignored `tmp/database-runtime/postgres.env`; application code must use `DATABASE_URL`, not bootstrap credentials.

## Ignored local configuration

The generated `.env.local` contains `DATABASE_URL`, `TEST_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `TEST_MIGRATION_DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `PRIVATE_STORAGE_DIR`. `.env.test.local` points both database variables at the test database and uses a separate private storage directory. Actual passwords and the 64-character random authentication secret are never included in documentation or committed files. `.env.example` contains placeholders only.

The default application URL is `http://localhost:3000`; change the ignored environment files when running on another port. Private files live under ignored `tmp/private-storage` or `tmp/private-storage-test`, outside `public/`. Runtime credentials, private files, and database data must contain synthetic data only.

Use the migration URL from `.env.local` for development migrations/seeds and the test migration URL from `.env.test.local` for test setup. Application code and security checks use the corresponding application URL. Both database and migration URLs in `.env.test.local` target `sehospitaldb_test`. Do not reset the development database while testing. Application tooling must validate the test database name before any destructive test cleanup.

## Recovery

Stopping/restarting Docker or this container preserves the named volume. Missing local configuration is an explicit error instead of automatic regeneration, because new credentials cannot unlock existing data. Recover the original ignored configuration from a protected local backup. If the data matters, preserve its volume and take a logical backup before changing runtime configuration or image versions.

For a logical backup, use the project container's `pg_dump` with a reviewed backup identity and the intended database, writing output to a protected ignored local file. Restore into a separate, explicitly named synthetic database for verification; do not overwrite an existing database. There is intentionally no reset/remove command in this helper.

A major PostgreSQL upgrade requires an explicit migration/restore plan. The pinned PostgreSQL 17 image mounts its persistent data at `/var/lib/postgresql/data`; PostgreSQL 18+ uses a different layout. Review and update the image digest intentionally rather than silently tracking a floating major or `latest` tag.

## Setup verification, 1 October 2026

The existing Docker Desktop 4.87.0 / engine 29.7.2 was started, the intended container/volume names and port were unused, and the official image was pulled. PostgreSQL reported version 17.11. Both empty databases were created, then ownership was assigned to `smiley_migrator`. The application role owns neither database. Role metadata confirmed `rolsuper`, `rolcreatedb`, `rolcreaterole`, and `rolbypassrls` were false for both application and migration roles. All four URLs passed authenticated host connections using the application PostgreSQL driver. Repeated startup preserved credentials and databases, and status reported `running` / `healthy` with the pinned digest. No domain schema or source bootstrap SQL was executed by the runtime setup.

Sources: [official PostgreSQL Docker image](https://hub.docker.com/_/postgres), [PostgreSQL role attributes](https://www.postgresql.org/docs/17/role-attributes.html), [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
