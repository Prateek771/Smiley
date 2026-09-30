# Saavantus Hospital Claims Desk

The Next.js foundation for the Smiley / Saavantus hospital insurance project.
This starter contains an empty home page; hospital workflows are not implemented yet.

## Local development

Use Node.js 24 or later (Node.js 24 is installed on the current computer)
and npm. In the checkout or worktree where you are working, run:

```powershell
npm ci
npm run dev
```

Open http://localhost:3000. Application source is under `src/app/`.

## Verification

```powershell
npm run lint
npm run typecheck
npm run build
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
Playwright Test remains planned for repeatable journeys in Phase 3. The starter
currently displays only `Hello world!`; there is no claims workflow to test yet.

## Existing reference material

The `outputs/` and `prototype/` directories are preserved
as project references. Older stack proposals in those documents are historical;
the latest agreed application stack takes precedence.

The earlier `build-guide/` has a separate Git repository and stays in the original
project folder. It is excluded from this application's Git repository.
`tmp/` and `work/` contain local scratch artifacts and are also excluded.

No database, authentication system, background worker, or cloud deployment is
configured by this installation.

## Build progress

Use [BUILD_PLAN.md](BUILD_PLAN.md) for the phased build checklist, test checkpoints, decisions, and verification evidence. Update it after each completed phase.

## Repository and automated checks

The private repository is [Prateek771/Smiley](https://github.com/Prateek771/Smiley).
GitHub Actions checks the installed browser CLI, lint, TypeScript, and a production
build on pushes to main or codex branches and on pull requests to main.
