# Saavantus Hospital Claims Desk

The Next.js foundation for the Smiley / Saavantus hospital insurance project.
This starter contains an empty home page; hospital workflows are not implemented yet.

## Local development

Use Node.js 20.9 or later (Node.js 24 LTS is installed on the current computer)
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
GitHub Actions runs lint, TypeScript checks, and a production build on pushes to
main or codex branches and on pull requests to main.
