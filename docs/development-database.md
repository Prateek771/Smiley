# Native local PostgreSQL

Smiley uses installed PostgreSQL 18 on Windows (`postgresql-x64-18`, normally `127.0.0.1:5432`). PostgreSQL 17+ is supported. No container engine, Compose file or image is needed. Application schema changes remain reviewed additive Drizzle migrations.

## Existing installation

```powershell
npm run db:start
npm run db:status
npm run dev
```

`db:start` starts the configured Windows service when necessary and verifies four authenticated connections. `db:status` checks connections, PostgreSQL version, database ownership and restricted role attributes without changing anything. On other operating systems, start PostgreSQL with the host's service manager first. Set `LOCAL_POSTGRES_SERVICE` in `.env.local` for another Windows service name. These commands never stop a shared native service or delete data.

## New installation

Install PostgreSQL 18, start it, and privately provide `LOCAL_POSTGRES_ADMIN_URL` in the process environment. It must reference a loopback host and the `postgres` administration database, for example `postgresql://postgres:<url-encoded-password>@127.0.0.1:5432/postgres`. Do not commit or paste the real connection into shared scripts. Run:

```powershell
npm run db:setup
npm run db:migrate
npm run db:seed
npm run auth:seed
npm run db:migrate -- --test
npm run db:seed -- --test
```

Clear the administrator environment variable afterward. Setup creates only `smiley_app`, `smiley_migrator`, `sehospitaldb` and `sehospitaldb_test`, generates private random credentials and writes ignored `.env.local` / `.env.test.local`. It refuses existing role/database name collisions and never changes the administrator password or host authentication. With existing configuration it only verifies connections. If setup fails partway, preserve its credential files and recover the partial provisioning deliberately; it will not reset or overwrite it.

| Purpose | Identity / location |
| --- | --- |
| Application | `smiley_app`: no superuser, database creation, role creation, replication or RLS bypass |
| Migrations / object ownership | `smiley_migrator`: separate restricted identity; owns both databases and reviewed schema objects |
| Development | `sehospitaldb` |
| Isolated tests | `sehospitaldb_test` |
| Staff fixture credentials | ignored `tmp/synthetic-auth-sehospitaldb.json` |
| Private files | ignored `tmp/private-storage` / `tmp/private-storage-test` |

Both databases use the same native server, but test commands require explicit `_test` connections and do not reset development data. `auth:seed` resets fictional staff credentials and grants; do not rerun it to solve a startup outage. The app never uses the administrator connection. Preserve `BETTER_AUTH_SECRET` and private storage when moving existing data.

## Backups and recovery

Before moving an existing installation, stop app writes, preserve the ignored environment files, and take custom-format `pg_dump` backups of both databases. Restore only into unused empty native databases after preparing the restricted roles. Preserve owners, grants, policies, sequences and the Drizzle ledger; compare source/destination metadata and data before changing URLs. Private document bytes are filesystem data and must remain at their configured paths.

Backups contain authentication records and private data. Keep them in ignored protected local storage, outside `public/` and Git. Never use a destructive bootstrap SQL script or `drizzle-kit push` for recovery. The earlier container volume may remain offline as recovery material; it is no longer a project dependency.

## Continuous integration

The workflow installs native PostgreSQL 18 from the official PostgreSQL Apt repository, then creates a disposable cluster under `RUNNER_TEMP` on loopback port 55432. No service container is used. `scripts/ci-database.mjs` creates restricted roles and the isolated test database. Fresh/additive migration checks, application tests and desktop/mobile journeys use that native database.

References: [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), [official Ubuntu packages](https://www.postgresql.org/download/linux/ubuntu/).
