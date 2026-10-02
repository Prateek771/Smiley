# Repository Guidelines

## Project Structure & Module Organization

`src/app/` holds pages/APIs; `src/features/{demo,desk}/` holds previews/protected staff screens. `src/server/` contains identity, access, case, document and database services. Migrations live in `drizzle/`, checks in `tests/{unit,integration,e2e}/`, public assets in `public/`, and private synthetic files in ignored `tmp/`. `docs/` records evidence; `prototype/` and `outputs/` are historical. The separate `build-guide/` repository stays in the original checkout.

## Build, Test, and Development Commands

Use Node.js 24+ and npm from the `dev` worktree.

- `npm ci`: install locked dependencies.
- `npm run db:setup`: provision unused native PostgreSQL databases with an explicit private administrator connection.
- `npm run db:start`, `npm run db:status`: start/check the native Windows service and verify restricted development/test connections.
- `npm run db:migrate`, `npm run db:seed`, `npm run auth:seed`: prepare local schema and fictional staff; append `-- --test` for the isolated test database.
- `npm run dev`: serve `http://localhost:3000`.
- `npm run lint`, `npm run typecheck`, `npm run build`: verify style, route types, and production compilation.
- `npm run test:e2e`: prepare isolated fixtures, build, and serve production on port 3210 for browser checks.
- `npm test`: run server and desktop/mobile browser checks.
- `npm run browser -- <command>`: inspect the UI with agent-browser.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, double quotes, and semicolons. Use PascalCase for components/types and camelCase for functions/variables. Retain `page.tsx` and `route.ts`. Prefer Server Components; use `"use client"` for browser behavior. ESLint is configured; Prettier is not. Consult `node_modules/next/dist/docs/` for unfamiliar APIs.

## Testing Guidelines

Use `*.test.ts` for unit/database checks and `*.spec.ts` for Playwright. Run suites separately when useful; no coverage threshold is established. Test tenant/branch denials, stale updates, retries and recovery. Do not share `.next` with another dev/production server or build during browser checks. CI explicitly reuses its preceding fresh build with `PLAYWRIGHT_SKIP_BUILD=1`. Keep raw screenshots/session data in ignored `tmp/`; publish reviewed synthetic evidence intentionally.

## Commit & Pull Request Guidelines

Use focused, imperative commits; Conventional Commits are not required. PRs explain behavior, verification, linked issues and UI screenshots. Promote tested `dev` checkpoints to `main` after CI passes. Preserve existing changes and local recovery refs.

## Security & Agent Workflow

Use synthetic data; never commit credentials or patient information. Enforce current staff, hospital, branch, and role checks on the server. Preserve applied migration bytes; add migrations instead of using `drizzle-kit push`. Explain substantial changes proportionately, then proceed unless blocked. Record completed phases in `BUILD_PLAN.md`. Deterministic financial rules and a separate TypeScript LangGraph worker belong to later phases; AI never grants payer approval.
