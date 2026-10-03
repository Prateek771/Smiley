# Single project folder consolidation

Date: 3 October 2026. The owner selected `%USERPROFILE%\.codex\worktrees\saavantus-app\Smiley insurance` as the sole project folder and explicitly requested removing `C:\dev\codex projects\Smiley insurance` after preserving anything missing.

## Preservation and removal

- Both original checkouts started clean at the tested Phase 15 checkpoint `08853addd284fb4286bae436a155b2dc2a9985f6`.
- Inventoried 525 persistent files: 305 missing files were copied, 147 differing originals were initially archived rather than overwriting active files, and 73 identical files were verified. Generated `node_modules`, `.next`, npm caches, Python caches and generated root type files were excluded; the retained folder already has its dependencies and production build.
- Preserved the older planning guide and its separate Git history, local work artifacts and earlier helpers. The guide's previously deleted PDF remained deleted, matching its original state. Git's refreshed guide index and the original contributor guide were archived separately before subsequent edits.
- Preserved all 15 original Git refs, including branches, remote tracking, local unpublished recovery history and Codex captures. The retained `.git` pointer became an independent Git directory; both Git directory and common directory resolve inside the retained folder. `git worktree list` now contains only this folder, on `dev`.
- Enabled repository-local Windows long-path support and verified Git object connectivity. Existing dangling trees were retained; there are no missing or corrupt objects.
- Immediately before removal, all 525 preserved files matched their recorded SHA-256 checksums. The exact original directory was validated as an ordinary, disjoint directory; no reparse entries were present. Native PowerShell removed only that directory, and its absence was verified.
- Private manifests, originals and Git recovery metadata remain ignored under `tmp/folder-consolidation-2026-10-03/`. No credentials or private backups were published.

## Database and runtime verification

- PostgreSQL 18 remains running with data in `C:\Program Files\PostgreSQL\18\data`, outside either project folder.
- All 56 non-session public tables matched their pre-consolidation row counts and SHA-256 fingerprints after conversion and after removal. The four existing cases and three private document revisions remain intact. Authentication sessions were excluded because runtime verification signs in and out.
- Preserved Desk credentials successfully signed in; the protected workspace and case API returned HTTP 200. All three protected document downloads matched their stored SHA-256 hashes after removal.
- `npm run db:status` verified development and isolated-test connections on `127.0.0.1:5432` for both restricted app and migration roles. Active environment settings contain no reference to the removed folder.
- The application was started from the retained folder and responds on `http://localhost:3000/login`. Application source, applied migrations and database records were not edited or reseeded.

Repository guides now describe one standalone folder, two active GitHub branches and public visibility by owner choice. Documentation/link/diff checks and exact GitHub CI precede promotion to `main`.
