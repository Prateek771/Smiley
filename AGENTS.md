# Repository Guidelines

## Project Structure & Module Organization

`src/app/` holds App Router pages, layouts, and CSS; `@/*` maps to `src/*`. `prototype/` and `outputs/` are historical references; rebuild the standalone demo with `node prototype/build.js`. Add static assets under `public/` when needed. The separate `build-guide/` repository stays in the original checkout.

## Build, Test, and Development Commands

Use Node.js 24+ and npm from the worktree root.

- `npm ci`: install locked dependencies.
- `npm run dev`: run locally at `http://localhost:3000`.
- `npm run lint`: check application and configuration files with ESLint.
- `npm run typecheck`: generate route types and check TypeScript.
- `npm run build`: create a production build.
- `npm run start`: serve the completed build.
- `npm run browser:install`: install Chrome for browser checks.
- `npm run browser -- <command>`: invoke agent-browser.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, double quotes, and semicolons. Use PascalCase for components/types and camelCase for functions/variables. Keep Next.js filenames (`page.tsx`, `layout.tsx`, `route.ts`). Prefer Server Components; add `"use client"` for browser behavior. ESLint is configured; Prettier is not. Check unfamiliar Next.js APIs in `node_modules/next/dist/docs/`.

## Testing Guidelines

Use agent-browser for interactive UI checks; `README.md` documents isolated sessions and screenshots. No regression runner, `npm test`, or coverage threshold exists yet. Run lint/typecheck/build for application changes; CI repeats them. Add Playwright Test under `tests/e2e/*.spec.ts` in Phase 3; prioritize key journeys and hospital/branch/role isolation.

## Commit & Pull Request Guidelines

Use short, imperative commit messages, e.g. `Initialize Smiley Next.js foundation and build checkpoints`. No Conventional Commits convention is established. Keep commits focused. PRs should explain changes, verification, linked issues when available, and include screenshots for UI changes.

## Security & Architecture

Use synthetic data; never commit secrets or identifiable patient data. `.env*` is ignored. PostgreSQL/Drizzle, Better Auth, Graphile Worker, and a separate TypeScript LangGraph worker are planned. Never execute destructive bootstrap SQL against an existing database. When implementing claims, use AI for extraction/explanation, versioned deterministic code for amounts, and insurer/TPA evidence for approval.

## Agent Workflow

Use the active development worktree; preserve existing changes and document deletions. Push application branches; keep `refs/local-backups/` local. For substantial work (multiple files, behavior changes, data/security, or product tradeoffs), explain the goal, affected systems, approach, risks, and completion criteria, then proceed unless blocked. Verify proportionately, report limitations, and use diagrams only when helpful. Track phases and verification evidence in `BUILD_PLAN.md`; update it after each completed phase.
