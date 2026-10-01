# Phase 6 — staff authentication and invitation lifecycle

Verified on 2026-10-01 using synthetic staff and the isolated local PostgreSQL test database. Credentials remain in an ignored local fixture; no credentials or connection strings are included in this evidence.

## Result and scope

Staff can sign in at `/login`, reach a protected `/desk` shell, and sign out. An administrator can create a scoped staff invitation through `/api/staff/invitations`; its recipient can choose a name and password at `/invite`. The acceptance screen reports success and directs the recipient to sign in. Invitation delivery and the administrator's staff-management screen are not part of this checkpoint.

`src/server/auth/index.ts` configures Better Auth over the four reviewed auth tables, exposes a lazy instance for runtime use, and resolves each valid credential to exactly one active domain user, staff profile, and hospital. Sessions expire after eight hours, cookie session caching is disabled, and protected requests reload current roles and branch grants from PostgreSQL. A platform role provides no hospital branch grants or invitation privileges. The HTTP auth route permits only sign-in, sign-out, and session lookup; public sign-up remains unavailable.

`src/server/auth/staff.ts` contains invitation creation, acceptance, and staff removal. Administrator authority is reloaded inside the same transaction as the requested operation. Hospital and branch scope comes from the current staff actor and the locked invitation rather than a caller-supplied hospital. Invitations store a SHA-256 token hash, expire, and can be consumed once. Acceptance creates Better Auth credentials, the staff/domain identity, role and branch grant, and accepted status using one application-pool transaction and its same PostgreSQL client. A failure rolls back all of those records.

Staff removal disables the user and staff profile, revokes branch memberships and pending invitations, and deletes existing sessions atomically. A hospital administrator cannot remove their own account or any platform account. The platform-role check precedes the ordinary target row lock so the controlled 403 remains available when Phase 7 policies exclude platform profiles from hospital writes.

The staff API routes use the shared `src/server/http.ts` helper. Mutating requests require the configured application Origin; JSON bodies are bounded to 64 KiB and validated before service calls. Responses do not expose database errors or credentials. `/desk` reloads the trusted session on each render and redirects an unauthenticated visitor to `/login`; Phase 8 will replace this minimal shell with the operational workspace.

## Synthetic runtime and browser isolation

`src/server/auth/seed.ts` provisions nine synthetic identities: hospital A administrator, central and north desk staff, billing, finance and reporting staff; hospital B administrator and desk staff; and a platform registry administrator. It writes generated fixture credentials only under the ignored `tmp` directory. `scripts/auth-seed.ts` provides `npm run auth:seed -- --test`, sets the test environment before loading database/auth modules, and closes its pools. Its verified output reports provisioning without printing secrets.

`scripts/run-e2e.mjs` requires explicit test application and migration URLs, restricts both to loopback and the database name `sehospitaldb_test`, then migrates, seeds domain records, and provisions synthetic staff before launching Playwright. The child Next server receives the test URL as its normal `DATABASE_URL`, uses `BETTER_AUTH_URL=http://127.0.0.1:3210`, and has test-only private storage. Browser checks do not reuse an existing development server. Database preparation runs in the CLI launcher; application routes do not perform schema migration.

## Red-to-green evidence

Before the production auth files were activated, the 16 staged integration checks failed at their explicit missing-auth assertion. Four targeted anonymous-desk and missing-invitation checks also failed on desktop/mobile because the corresponding protected/login/invitation behavior was absent.

The first activated integration run reproduced a real adapter mismatch: Better Auth's PostgreSQL UUID mode omitted IDs for reviewed text-ID columns that have no database default. The installed adapter implementation was inspected, and the auth configuration now supplies `() => randomUUID()` without changing the database schema. The 16 existing auth checks then passed.

Independent review identified that a hospital administrator could disable a same-hospital platform profile. A new test first failed because the operation did not reject the call. The service now rejects it with 403; the test confirms that both profile statuses, session count, and the original platform cookie remain valid. The auth suite now contains 17 checks.

Two browser alert assertions initially also matched Next's hidden route announcer. The assertions were narrowed to their actual visible form messages, and all 12 authentication browser checks passed afterward. This was a test-selector repair; application behavior was unchanged.

## Verification

The final complete `npm test` run passed **31/31 server checks** and **30/30 desktop/mobile browser journeys**. The server checks comprise 17 authentication checks and the existing 14 database checks. The browser checks comprise 12 authentication journeys and the existing 18 synthetic demo journeys.

The authentication integration checks cover absent/invalid/expired sessions; one-to-one identity mapping; public-signup denial; logout; current administrator and same-hospital branch validation; single-use, expired and concurrent invitations; rollback after password/profile failures; removal and old-session revocation; orphan credential denial; hospital-administrator branch scope; platform privilege separation; and protected platform-account removal.

The six browser journeys run on both desktop Chrome and mobile: anonymous desk redirect, invalid credentials, sign-in/reload/sign-out, public-signup denial, missing invitation guidance, and administrator-created invitation acceptance through the screen. Invitation API requests explicitly supply the required Origin.

Successful commands:

```text
npm test
npm run test:e2e -- auth.spec.ts
npm run lint
npm run typecheck
npm run build
npm run auth:seed -- --test
```

The production build includes `/login`, `/invite`, `/desk`, and the auth/invitation/removal API routes. The final browser run emitted Node's non-failing `NO_COLOR`/`FORCE_COLOR` warnings and one Next development-server `destination stream closed early` message during a demo navigation. All assertions passed; this does not claim a production runtime check. Four screenshots were visually inspected for layout, visible labels, responsive wrapping, and synthetic content:

- [Desktop login](phase-6/login-desktop.png)
- [Mobile login](phase-6/login-mobile.png)
- [Desktop protected desk](phase-6/desk-desktop.png)
- [Mobile protected desk](phase-6/desk-mobile.png)

## Phase boundary

This checkpoint establishes the trusted staff actor and invitation/session lifecycle. Tenant/branch RLS and the permission matrix remain Phase 7 work. That checkpoint must switch invitation locking to the narrowly scoped database helper so expired/consumed invitations retain controlled responses under RLS, and record grant/revocation provenance using the later membership columns. Phase 6 deliberately does not require those later columns, preserving compatibility with the published Phase 5 migrations. Auth checks must run again after those Phase 7 changes.

No real patient data, external invitation delivery, production deployment, or production readiness is implied. No unresolved product decision blocks this approved synthetic checkpoint.
