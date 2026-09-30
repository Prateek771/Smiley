# Repository Guidelines

## Project Structure & Module Organization

`src/app/` contains App Router pages, layouts, and global CSS; `@/*` maps to `src/*`. `prototype/` and `outputs/` contain historical references and the standalone demo; rebuild it with `node prototype/build.js`. No `public/` directory exists yet; add static assets there when needed. The separate `build-guide/` repository remains in the original checkout.

## Build, Test, and Development Commands

Use Node.js >=20.9 and npm from the worktree root.

- `npm ci`: install locked dependencies.
- `npm run dev`: run locally at `http://localhost:3000`.
- `npm run lint`: check application and configuration files with ESLint.
- `npm run typecheck`: generate route types and check TypeScript.
- `npm run build`: create a production build.
- `npm run start`: serve the completed build.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, double quotes, and semicolons. Use PascalCase for components/types and camelCase for functions/variables. Keep Next.js filenames (`page.tsx`, `layout.tsx`, `route.ts`). Prefer Server Components; add `"use client"` for browser behavior. ESLint is configured; Prettier is not.

## Testing Guidelines

No test runner, `npm test`, or coverage threshold is configured. For application changes, run lint, typecheck, and build; GitHub Actions repeats these checks. Check UI changes locally. When adding browser tests, use Playwright Test and `tests/e2e/*.spec.ts`; prioritize key journeys and hospital/branch/role isolation.

## Commit & Pull Request Guidelines

Use short, imperative commit messages, e.g. `Initialize Smiley Next.js foundation and build checkpoints`. No Conventional Commits convention is established. Keep commits focused. PRs should explain changes, verification, linked issues when available, and include screenshots for UI changes.

## Security & Architecture

Use synthetic data; never commit secrets or identifiable patient data. `.env*` is ignored. PostgreSQL/Drizzle, Better Auth, Graphile Worker, and a separate TypeScript LangGraph worker are planned. Never execute destructive bootstrap SQL against an existing database. When implementing claims, use AI for extraction/explanation, versioned deterministic code for amounts, and insurer/TPA evidence for approval.

## Agent Workflow

Use the active development worktree; preserve existing changes and document deletions. Push application branches; keep `refs/local-backups/` local. For substantial work (multiple files, behavior changes, data/security, or product tradeoffs), explain the goal, affected systems, approach, risks, and completion criteria, then proceed unless blocked. Verify proportionately, report limitations, and use diagrams only when helpful. Track phases and verification evidence in `BUILD_PLAN.md`; update it after each completed phase.
