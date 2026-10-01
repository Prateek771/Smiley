# Staff workspace entry review

Reviewed locally on 1 October 2026 after Phase 10.

## Problem and change

The homepage still redirected to the public workflow demo. That demo had no
staff sign-in link, so reviewers could not discover the persisted staff screens.

- `/` now redirects to `/desk`. Existing server session checks send an anonymous
  visitor to `/login` and allow an authorized staff member into their scoped queue.
- The demo shell provides a visible **Staff sign in** link to `/login` on desktop
  and mobile, including demo case pages that share the shell.
- Existing authentication, hospital/branch/role checks and case services are unchanged.

## Verification

- `npm run lint`, `npm run typecheck` and `npm run build` passed.
- Agent-browser verified anonymous `/` -> `/login`, demo sign-in -> `/login`,
  synthetic desk sign-in -> `/desk`, and signed-in `/` -> `/desk` against the fresh
  production preview on port 3000.
- The demo entry link was reviewed at 1280 x 900 and 390 x 844; the mobile document
  width did not exceed its viewport.
- Registration at `/desk/new` and an existing case at `/desk/cases/4` loaded.
  The case showed registration links, owner/next action, immutable history,
  preparation controls, private PDF revision download, upload and source-note forms.
- No page errors were reported in the reviewed case tab. No new case or document
  was created during this review. Raw screenshots stay in ignored `tmp/`.

## Review handoff

A separate visible Chrome window remains signed into the existing synthetic desk
account, with queue, registration and case tabs. Other browsers retain independent
sessions and must sign in using the fictional credentials described in `README.md`.
Phase 11 and later functionality remain pending.
