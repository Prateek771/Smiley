# Saavantus Hospital Claims Desk

The Next.js foundation for the Smiley / Saavantus hospital insurance project.
The public `/demo` implements the synthetic work queue and checkpoint-scoped case walkthrough. Protected database-backed staff workflows are being built through Phase 10; see the tracker.

## Local development

Use Node.js 24 or later (Node.js 24 is installed on the current computer)
and npm. In the checkout or worktree where you are working, run:

```powershell
npm ci
npm run dev
```

Open http://localhost:3000/demo. Application routes are under `src/app/`; synthetic view models/components are under `src/features/demo/`. Demo role controls are previews, not access authorization.

## Verification

```powershell
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

The starter uses Next.js 16.3.8, React, TypeScript, the App Router,
Tailwind CSS, and ESLint. `package-lock.json` records the resolved dependencies.
Each Git worktree needs its own dependency installation with `npm ci`.

## Browser checks with agent-browser

[agent-browser](https://github.com/vercel-labs/agent-browser) is pinned as a local
development dependency. Use it for browser inspection, screenshots, and checking
UI interactions during a phase. `npm run browser` always uses the project version.

Start the application with `npm run dev`. In a second terminal:

```powershell
# First-time browser setup, if a compatible Chrome installation is unavailable.
npm run browser:install
New-Item -ItemType Directory -Force tmp/browser | Out-Null
npm run browser -- --session smiley-local open http://localhost:3000
npm run browser -- --session smiley-local snapshot
npm run browser -- --session smiley-local screenshot tmp/browser/desktop.png
npm run browser -- --session smiley-local set viewport 390 844
npm run browser -- --session smiley-local screenshot tmp/browser/mobile.png
npm run browser -- --session smiley-local errors
npm run browser -- --session smiley-local close
```

Use fresh snapshot references with `click` and `fill`; refresh the snapshot after
navigation or UI changes. Use a distinct session name for concurrent worktrees.
Raw screenshots and session state belong in ignored `tmp/browser/`; review
synthetic evidence before copying it to `docs/evidence/`. Use isolated test
sessions rather than a personal browser profile.

This CLI helps explore the UI; it does not provide regression assertions.
Playwright Test runs desktop and Pixel 7 journeys under `tests/e2e/`. It starts an isolated server on port 3210. `npm run test:integration` runs Node/tsx server tests as those phases are introduced; `npm test` runs both suites. The demo reads fictional expected snapshots; it does not calculate coverage or record payer decisions.

## Existing reference material

The `outputs/` and `prototype/` directories are preserved
as project references. Older stack proposals in those documents are historical;
the latest agreed application stack takes precedence.

The earlier `build-guide/` has a separate Git repository and stays in the original
project folder. It is excluded from this application's Git repository.
`tmp/` and `work/` contain local scratch artifacts and are also excluded.

Local PostgreSQL preparation is documented in [development-database.md](docs/development-database.md). No background worker or cloud deployment is configured; LangGraph belongs to the later worker/extraction phases.

## Build progress

Use [BUILD_PLAN.md](BUILD_PLAN.md) for the phased build checklist, test checkpoints, decisions, and verification evidence. Update it after each completed phase.

Phase 2 defines the [cashless-discharge workflow](docs/superpowers/specs/2026-10-01-cashless-discharge-design.md)
and [five synthetic acceptance packs](docs/fixtures/phase-2-cashless-discharge.json).
Their [validation record](docs/evidence/phase-2-validation.md) checks expected
amounts, timing, role handoffs, and review blocks. These packs will guide later
UI/rules tests; they are not real hospital policies or implemented workflows.

## Repository and automated checks

The private repository is [Prateek771/Smiley](https://github.com/Prateek771/Smiley).
GitHub Actions checks the installed browser CLI, lint, TypeScript, and a production
build and desktop/mobile browser journeys on pushes to `main`, `dev`, or codex branches and on pull requests to `main`.

## Branch workflow

Use `dev` in the managed development worktree for all future work. Commit and
push focused changes there, run the checks appropriate to the phase, and verify
GitHub checks before merging the tested checkpoint into `main`. `main` holds
verified checkpoints; the original project checkout tracks it. Do not reset or
force-push either branch. The older `codex/saavantus-app` branch is retained as
history; local recovery refs stay off GitHub.
