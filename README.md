# Smiley Hospital Claims Desk

Synthetic cashless hospital claims workspace for insurance Desk, Billing, Finance and administrators. Phases 0–19 cover sign-in, scoped registration/cases, private documents, verified AI evidence, eligibility/preauthorization/treatment history, bill assessments, reviewed claim packs, manual submission/query acknowledgements, payer decisions, patient reconciliation, remittances, administration and reports.

The protected `/desk` uses native PostgreSQL. `/demo` shows fixed fictional examples. OCR.space and TypeScript LangGraph run through the persistent worker; the only text model is OpenRouter `qwen/qwen3.8-27b:free`. Actual payer integrations remain manual. AI never grants payer approval.

## Local development

Use Node.js 24+ and native PostgreSQL 18 (17+ supported) on the `dev` branch in the single project folder. Existing installations retain their ignored environment files, staff accounts and private documents. A new installation requires an explicit private `LOCAL_POSTGRES_ADMIN_URL`; run `npm run db:setup` once. See [database setup](docs/development-database.md).

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

`src/app/` contains pages/APIs; `src/features/desk/` contains staff forms; `src/server/` contains scoped services; `src/worker/` runs durable pack and AI review. Drizzle migrations preserve the 42 domain tables and four reporting views, adding justified identity/evidence/financial/job/AI/rule tables (62 public tables total). Current hospital, branch, staff and role checks plus forced RLS protect access. Queue and LangGraph checkpoint tables live in private schemas. See [access model](docs/access-model.md).

Amounts use exact safe integer paise and fictional `SYN-DISCHARGE-1` rules. Estimates, final authorization, confirmed patient responsibility, decision disputes and actual receipts are separately named. Changed bill, policy, assessment or pinned evidence invalidates dependent current facts while immutable history remains visible. Higher approvals can reduce patient liability; unexplained payer deductions cannot silently increase it.

Private documents remain outside public/build directories. Manual source evidence is not OCR verification. Persistent jobs recheck current staff ownership and inputs, deduplicate completion, and stop after three attempts. Startup safely unlocks only workers on the same host whose recorded PID is proven absent; live/reused PIDs and permission denials are never treated as stopped. Other-host crashes use Graphile's stale-lock recovery and need operational procedures before deployment. Failed/stale/denied requests retain owner recovery history.

AI requests require an explicit fictional-data confirmation. OCR.space Engine 2 accepts supported images/PDFs up to 1,000,000 bytes and PDFs up to three actual pages; UTF-8 text is read directly. Put `OCR_SPACE_API_KEY` and `OPENROUTER_API_KEY` in ignored `.env.local`, never `NEXT_PUBLIC_*`. External tracing is disabled. Quotes, pages and whole values are validated against frozen source evidence; corrections/rejections are immutable staff reviews. Provider outages retain saved stages and manual workflows; there is no alternative-model fallback. Free service availability is not guaranteed.

Case pages contain **Earlier cashless journey** and **AI evidence and staff review**. The sidebar exposes `/desk/reports`; hospital admins also see `/desk/admin`. Platform admins enter separate `/platform` registry screens and receive no clinical access. Registered rules follow DRAFT → APPROVED → RETIRED; historical financial snapshots retain their selected revision. Reports distinguish first-bill preparation, payer waits and full desk resolution; stale/missing financial evidence stays unknown.

Report preparation runs from the first verified bill to the first reviewed pack; full resolution runs from that same bill to a current valid Billing sign-off, including waits and rework. Earlier preauthorization/treatment history has its own timeline. AI response drafts use unresolved case-timeline payer queries; request-linked earlier-journey queries retain manual preparation and acknowledgement.

Hosting, cloud storage and real hospital rules remain unselected. Synthetic success does not establish production readiness. See [phase 16–19 evidence](docs/evidence/phases-16-19-validation.md).

## Repository workflow

The public repository is [Prateek771/Smiley](https://github.com/Prateek771/Smiley). The owner confirmed public visibility on 3 October 2026; future visibility changes are the owner's decision. Develop on `dev`, promote tested checkpoints to `main` after CI, and preserve local recovery refs. Never force-push or publish private backups. [BUILD_PLAN.md](BUILD_PLAN.md) and [phase evidence](docs/evidence/) track progress.

The sole local project folder is `%USERPROFILE%\.codex\worktrees\saavantus-app\Smiley insurance`. Despite its directory name, it is now a standalone repository: its `.git` history, environment configuration and private documents are self-contained. The former `C:\dev\codex projects\Smiley insurance` checkout was removed after verification. Keep working in this folder; do not create another worktree unless the owner asks.

GitHub has `main` and `dev`, both available as branches in this one local repository. The active branch is `dev`; the earlier `codex/saavantus-app` branch remains local recovery history. `prototype/` and `outputs/` are historical. The older planning guide was preserved in ignored `build-guide/`, with its separate history. Original-only files and differing originals were preserved privately before removal. PostgreSQL data lives under the installed service's data directory, outside the project. Environment files, database contents, private documents, dependencies and build output remain local. See the [consolidation evidence](docs/evidence/project-folder-consolidation-2026-10-03.md).
