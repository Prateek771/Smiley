# Saavantus Hospital Claims Desk

Smiley's local synthetic cashless-claims workspace for hospital staff. Phases 0–10 provide login, hospital/branch/role isolation, patient and insurance registration, persisted cases, controlled preparation actions, immutable history, and private document revisions.

The protected `/desk` uses PostgreSQL. The public `/demo` walks through fixed fictional checkpoints; its role controls are previews. Financial assessment, payer submissions/authorization, bank settlement, and AI extraction are later phases in [BUILD_PLAN.md](BUILD_PLAN.md).

## Local development

Use Node.js 24+ and locally installed PostgreSQL 18 (17+ is supported). Docker is not required. Run from the managed `dev` worktree. For a new installation, privately set `LOCAL_POSTGRES_ADMIN_URL` to your existing loopback `postgres` administration database and run `npm run db:setup` once; see [database setup](docs/development-database.md). Migrated installations already have configuration and should not rerun seeds just to start the app.

```powershell
npm ci
npm run db:start
npm run db:migrate
npm run db:seed
npm run auth:seed
npm run dev
```

Open `http://localhost:3000/login`. The seed command saves fictional staff credentials in ignored `tmp/synthetic-auth-sehospitaldb.json`; use `deskA` for the insurance desk, `adminA` for hospital administration, or `billingA` for a read-only case review. The other hospital and northern branch fixtures exercise isolation. Keep this credential file private and synthetic.

Native setup creates ignored `.env.local` and `.env.test.local` with random local secrets and separate databases, and refuses existing database/role name conflicts. Startup checks preserve existing data; domain seeds preserve registered rows. `auth:seed` reactivates known synthetic staff/grants and resets their fixture credentials. The shared Windows PostgreSQL service runs independently of Next.js. See [development-database.md](docs/development-database.md) for roles, paths and recovery. Change `BETTER_AUTH_URL` in ignored configuration when using another origin.

## Verification

```powershell
npm run db:migrate -- --test
npm run db:seed -- --test
npx playwright install chromium
npm run test:integration
npm run test:e2e
npm run lint
npm run typecheck
npm run build
```

`npm test` runs both test suites. Server tests require the explicit local `sehospitaldb_test` connections; they never reset the development database. `npm run test:e2e` retains the isolated database/fixture preparation, builds the application, then serves production on port 3210 for desktop and Pixel 7 journeys. Do not run another server on that port, or a development server, production server or build sharing the same `.next` directory during these checks.

CI repeats empty-database/additive migration preservation, seeds, server tests, browser tooling, lint, types, production build, and browser journeys against an isolated native PostgreSQL 18 cluster on port 55432. Only the CI Browser journeys step sets `PLAYWRIGHT_SKIP_BUILD=1` to reuse its fresh preceding Build step in the same job; the runner requires `.next/BUILD_ID` and still prepares isolated fixtures. Local checks build by default. Packages are locked in `package-lock.json`; each worktree needs its own `npm ci`.

## Browser inspection

[agent-browser](https://github.com/vercel-labs/agent-browser) is pinned locally. With the app running, use a separate synthetic session:

```powershell
npm run browser:install
New-Item -ItemType Directory -Force tmp/browser | Out-Null
npm run browser -- --session smiley-local open http://localhost:3000
npm run browser -- --session smiley-local snapshot
npm run browser -- --session smiley-local screenshot tmp/browser/desktop.png
npm run browser -- --session smiley-local set viewport 390 844
npm run browser -- --session smiley-local errors
npm run browser -- --session smiley-local close
```

Use current snapshot references for clicks and fills. Raw screenshots and session state belong in ignored `tmp/browser/`. Copy reviewed synthetic evidence into `docs/evidence/` intentionally. Playwright Test provides regression assertions; the optional Playwright MCP server is unnecessary for this scope.

## Architecture and current limits

Next.js App Router pages/APIs are under `src/app/`, feature screens under `src/features/`, and scoped server services under `src/server/`. PostgreSQL/Drizzle preserve the 42 domain tables and four reporting views, with 10 internal identity/evidence tables. Better Auth handles identity; current hospital, branch, and role grants control operations. [access-model.md](docs/access-model.md) documents those boundaries.

Private files live outside public assets in ignored local storage. Downloads recheck current staff access and file integrity; originals and source notes remain tied to exact revisions. The 5 MiB limit, supported formats, rollback cleanup, and local-host assumptions are recorded in Phase 10 evidence. PDF parsing uses a bounded local worker; keep `src/server/documents/pdf-validation-worker.mjs` and pinned dependencies available when serving the build. Standalone/cloud packaging, cloud storage, production backups, OCR/model providers, and hosting remain later decisions. Do not use identifiable patient data in this local build.

Amounts remain unknown until deterministic assessment and actual payer evidence are implemented. A locally prepared query response is never shown as payer acknowledgement. Graphile Worker and TypeScript LangGraph run in a separate persistent worker in later phases.

## Repository workflow

The private repository is [Prateek771/Smiley](https://github.com/Prateek771/Smiley). Work on `dev`; promote an exact tested checkpoint to `main` after GitHub checks pass. Preserve existing changes and local recovery refs; never force-push or publish backup refs. Track completed phases and evidence in [BUILD_PLAN.md](BUILD_PLAN.md) and the [execution ledger](docs/evidence/phases-3-10-progress.md).

`prototype/` and `outputs/` are historical references. The earlier `build-guide/` has its own repository in the original project folder and is excluded from this application. Scratch files, credentials, and private documents are excluded from Git.
