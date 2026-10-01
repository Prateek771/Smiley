# Phase 7 — authentication lifecycle under RLS

Verified on 2026-10-01 against the isolated synthetic test database after additive migrations `0003_grant_history` and `0004_authenticated_scope` were applied by the Phase 7 owner. This supplement records the auth integration; the central Phase 7 evidence covers the access matrix and policies.

## Changes

`src/server/auth/staff.ts` locks an invitation through `smiley_private.lock_invitation($1)` using the same application-pool client and token-hash context as the acceptance transaction. The narrow helper makes an expired or consumed token row available for controlled lifecycle errors; it performs no state change. Acceptance still uses the strict pending/unexpired write policy and creates credentials, the staff/domain profile, roles, membership, and accepted state atomically.

Accepted memberships now record the invitation's actual `created_by` as `granted_by` and record `granted_at=now()`. Staff removal sets the membership to `REVOKED` with `revoked_at=now()` while preserving its grantor. The scoped platform-role guard remains before the ordinary target row lock, so hospital administrators receive the controlled 403 without disabling a platform profile or revoking its session.

`src/server/auth/seed.ts` explicitly inserts bootstrap memberships with an unknown grantor (`NULL`). Its synthetic ACTIVE upsert clears `revoked_at`, satisfying the new grant-history constraint when reactivating a fixture. Existing grant timestamps and grantors are preserved on conflict. The real auth test hook and the browser CLI both successfully ran this seed under RLS.

## Red-to-green evidence

Before the service changes, the real acceptance check failed because its membership grantor was `NULL`. The removal check failed because `revoked_at` was `NULL`. The expired-invitation check also failed with actual 404 versus expected 410: RLS hid the expired row from the previous direct `SELECT ... FOR UPDATE`.

After the changes, all **17/17 auth integration checks** passed under RLS. The existing acceptance test additionally asserts the actual inviter, a valid grant timestamp, and an initially null revocation timestamp. The existing removal test asserts REVOKED status, a valid revocation timestamp, and the preserved grantor. Expired invitations return 410; consumed invitations return 409; concurrent acceptance still consumes a token once. The rollback, stale-session, orphan-profile, branch-scope, and protected-platform-account tests remain green.

All **12/12 focused desktop/mobile auth browser journeys** passed under RLS, including invitation acceptance through the screen and sign-out followed by protected-access rejection. The browser launcher/server exited after the run. Only non-failing Node color-environment warnings appeared.

Targeted ESLint and TypeScript checks passed for `staff.ts`, `seed.ts`, and `auth.test.ts`. ESLint initially reported an existing test-hook local named `module`; renaming it to `authModule` resolved the rule without changing behavior.

Commands verified:

```text
$env:NODE_ENV='test'; node --import tsx --test tests/integration/auth.test.ts
npm run test:e2e -- auth.spec.ts
node node_modules/eslint/bin/eslint.js src/server/auth/staff.ts src/server/auth/seed.ts tests/integration/auth.test.ts
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --esModuleInterop --allowImportingTsExtensions --moduleResolution bundler --module esnext --target ES2022 src/server/auth/staff.ts src/server/auth/seed.ts tests/integration/auth.test.ts
```

This auth slice changed no migration, schema, policy, package, CI, or desk implementation file. No existing migration SQL/hash was rewritten, and no database reset was performed. Credentials remain only in ignored synthetic fixtures.
