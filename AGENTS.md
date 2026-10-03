# Repository Guidelines

## Project Structure & Module Organization

`src/app/` holds pages/APIs; `src/features/{demo,desk}/` holds previews/protected staff screens. `src/server/` contains scoped identity, case, document, financial and database services; `src/worker/` runs persistent jobs. Migrations live in `drizzle/`, checks in `tests/{unit,integration,http}/`, assets in `public/`, and private synthetic files in ignored `tmp/`. `docs/` records evidence; `prototype/` and `outputs/` are historical. The older planning guide is preserved in ignored `build-guide/` with its separate history.

## Build, Test, and Development Commands

Use Node.js 24+ and npm on `dev` in `%USERPROFILE%\.codex\worktrees\saavantus-app\Smiley insurance`. This is the sole standalone project checkout; do not create another worktree unless the owner asks.

- `npm ci`: install locked dependencies.
- `npm run db:setup`: provision unused native PostgreSQL databases with an explicit private administrator connection.
- `npm run db:start`, `npm run db:status`: start/check the native Windows service and verify restricted development/test connections.
- `npm run db:migrate`, `npm run db:seed`, `npm run auth:seed`: prepare local schema and fictional staff; append `-- --test` for the isolated test database.
- `npm run dev`: serve `http://localhost:3000`.
- `npm run lint`, `npm run typecheck`, `npm run build`: verify style, route types, and production compilation.
- `npm run worker:setup`: explicitly install the pinned private queue; append `-- --test` for isolation.
- `npm run worker`: run the persistent pack-review process separately.
- `npm test`: run serial server/database/API checks, build and serve HTTP checks on port 3216.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, double quotes, and semicolons. Use PascalCase for components/types and camelCase for functions/variables. Retain `page.tsx` and `route.ts`. Prefer Server Components; use `"use client"` for browser behavior. ESLint is configured; Prettier is not. Consult `node_modules/next/dist/docs/` for unfamiliar APIs.

## Testing Guidelines

Use `*.test.ts` for Node/database/HTTP checks; no coverage threshold is established. Test scope denials, stale inputs, exact money, retries and crash recovery. Use Codex's in-app browser for UI review; do not invoke Vercel agent-browser or Playwright. Avoid sharing `.next` with another server/build during checks. CI uses `HTTP_SKIP_BUILD=1` after its fresh build. Keep raw screenshots private in `tmp/`; publish reviewed synthetic evidence intentionally.

## Commit & Pull Request Guidelines

Use focused, imperative commits; Conventional Commits are not required. PRs explain behavior, verification, linked issues and UI screenshots. Promote tested `dev` checkpoints to `main` after CI passes. Preserve existing changes and local recovery refs.

## Security & Agent Workflow

Build the working hospital product described in `docs/production-direction.md`; use synthetic fixtures to develop/test it. Do not require fixture-specific names or codes in normal staff workflows. Never commit credentials or patient information. The current cloud connector remains test-only until hospital-scoped processing permission is implemented and approved. Enforce current staff, hospital, branch and role checks on the server. Preserve applied migration bytes; add migrations instead of `drizzle-kit push`. Explain substantial changes proportionately, then proceed unless blocked. Record evidence in `BUILD_PLAN.md`. Keep assessments, approvals, patient confirmation, disputes and receipts separate; AI never grants payer approval.
