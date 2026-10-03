# Smiley Hospital Claims Desk

Synthetic cashless discharge workspace for hospital insurance Desk, Billing and Finance staff. Phases 0–15 cover sign-in, scoped registration/cases, private documents, bill assessments, reviewed claim packs, manual submission/query acknowledgements, payer decisions, patient reconciliation, remittances and persistent background review.

The protected `/desk` uses native PostgreSQL. `/demo` shows fixed fictional examples. Actual payer integrations, OCR and TypeScript LangGraph begin in later phases of [BUILD_PLAN.md](BUILD_PLAN.md). AI never grants payer approval.

## Local development

Use Node.js 24+ and native PostgreSQL 18 (17+ supported) from the managed `dev` worktree. Existing installations retain their ignored environment files, staff accounts and private documents. A new installation requires an explicit private `LOCAL_POSTGRES_ADMIN_URL`; run `npm run db:setup` once. See [database setup](docs/development-database.md).

```powershell
npm ci
npm run db:start
npm run db:migrate
npm run worker:setup
npm run dev
```

In a separate terminal, run `npm run worker`. Open `http://localhost:3000/login`. The worker is a persistent Node process, independent of the web server. Queue installation is explicit; the runtime uses Graphile's `runTaskList` without automatic schema migrations. No Docker runtime is used.

For a fresh synthetic installation only, run `npm run db:seed` and `npm run auth:seed`. These save fictional accounts in ignored `tmp/synthetic-auth-sehospitaldb.json`: `deskA` prepares cases and records payer evidence; `billingA` assesses bills and confirms patient liability; `financeA` records remittances/refunds; `adminA` manages hospital access. Do not rerun auth seeds merely to start an existing installation: they reset fixture credentials/grants. Never publish credentials or identifiable patient data.

## Verification

```powershell
npm run db:migrate -- --test
npm run worker:setup -- --test
npm test
npm run lint
npm run typecheck
```

`npm test` runs serial Node unit/database/API checks, builds production, then serves an isolated HTTP review on port 3216. Test fixtures require explicit `_test` connections and preserve development data. `npm run test:integration` runs server checks alone; `npm run test:http` runs production HTTP checks. Stop any server sharing `.next` before a build or HTTP suite.

CI provisions native PostgreSQL 18 on port 55432, tests fresh/additive migration preservation, installs the pinned private queue, runs server checks, lint/types/build, then production HTTP checks. Only CI sets `HTTP_SKIP_BUILD=1` after its fresh build. Visible UI review uses Codex's in-app browser. Vercel agent-browser and Playwright are retained as historical tooling and are not invoked for this build or CI.

## Architecture and boundaries

`src/app/` contains pages/APIs; `src/features/desk/` contains staff forms; `src/server/` contains scoped services; `src/worker/` runs durable pack review. Drizzle migrations preserve the 42 domain tables and four reporting views, adding justified identity/evidence/financial/job tables (57 public tables total). Current hospital, branch, staff and role checks plus forced RLS protect access. See [access model](docs/access-model.md).

Amounts use exact safe integer paise and fictional `SYN-DISCHARGE-1` rules. Estimates, final authorization, confirmed patient responsibility, decision disputes and actual receipts are separately named. Changed bill, policy, assessment or pinned evidence invalidates dependent current facts while immutable history remains visible. Higher approvals can reduce patient liability; unexplained payer deductions cannot silently increase it.

Private documents remain outside public/build directories. Manual source evidence is not OCR verification. Persistent jobs recheck current staff ownership and inputs, deduplicate completion, and stop after three attempts. Startup safely unlocks only workers on the same host whose recorded PID is proven absent; live/reused PIDs and permission denials are never treated as stopped. Other-host crashes use Graphile's stale-lock recovery and need operational procedures before deployment. Failed/stale/denied requests retain owner recovery history.

Hosting, cloud storage, real hospital rules and model/OCR providers remain unselected. Synthetic success does not establish production readiness.

## Repository workflow

The public repository is [Prateek771/Smiley](https://github.com/Prateek771/Smiley). The owner confirmed public visibility on 3 October 2026; future visibility changes are the owner's decision. Develop on `dev`, promote tested checkpoints to `main` after CI, and preserve local recovery refs. Never force-push or publish private backups. [BUILD_PLAN.md](BUILD_PLAN.md) and [phase evidence](docs/evidence/) track progress. `prototype/` and `outputs/` are historical; the separate `build-guide/` remains in the original checkout.

Both local folders are linked checkouts of this repository, sharing the original folder's Git history and `origin`:

| Local folder | Branch | Purpose |
| --- | --- | --- |
| `C:\dev\codex projects\Smiley insurance` | `main` | Original project folder; receives tested checkpoints |
| `%USERPROFILE%\.codex\worktrees\saavantus-app\Smiley insurance` | `dev` | Active development worktree |

GitHub currently has `main` and `dev`. The earlier `codex/saavantus-app` branch is retained locally for recovery; its remote branch has been removed. Edits in one checkout do not automatically change the other. Environment files, database contents, private documents, dependencies and build output remain local. See the [repository sync audit](docs/evidence/repository-sync-2026-10-03.md).
