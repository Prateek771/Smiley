# Phases 3–10: Desk Foundation Design

Date: 1 October 2026. Authorized scope: continuously implement and test Phases 3–10 on `dev`, promote passing checkpoints to `main`, stop only for an issue requiring the owner's attention. The [Phase 2 contract](2026-10-01-cashless-discharge-design.md) remains the product authority.

## Outcome and boundaries

Build a responsive synthetic desk demo, then a real local database-backed staff application that supports login, hospital/branch/role authorization, creating linked patient cases, versioned actions/history, and private revised documents. Use synthetic records/files. Financial calculations, payer submission/decision workflows, settlement, workers, AI extraction, and production hosting remain later phases.

Existing Tailwind plus accessible native HTML components is the Phase 3 component choice: it avoids a new design-system dependency while delivering the small queue/case journey. Keep `/demo` visibly synthetic and public; use `/login` and `/desk` for database-backed work. No public/demo route reads private database records. The source prototype is a visual reference, not a behavioral authority.

## Systems and responsibilities

- `src/features/demo/`: adapts fictional checkpoints using explicit evidence cutoffs; demo queue/detail routes preserve URL search/filter/role.
- `src/server/db/`, `drizzle/`: 42 reviewed source domain tables, four invoker-safe views, restored checks/indexes/timestamps, reviewed scope amendments and additional operational/auth tables. Source DROP/bootstrap scripts are never executed.
- `src/server/auth/`: Better Auth identity, password/session lifecycle and trusted actor lookup. Domain users map uniquely to auth users; no second password store.
- `src/server/access/`: a fixed role matrix and transaction-local authenticated user/hospital/branch context. The application database role is not superuser/BYPASSRLS/table owner. Operational tables FORCE RLS. Never accept a tenant/actor from client assertions.
- `src/server/cases/`: linked patient/membership/encounter/case operations with scoped composite relationships, idempotent creates, assigned owner and next action.
- `src/server/timeline/`: allowed preparation-state actions, version checks, repeated query records/history and append-only audit events. No action fabricates payer approval or calculation readiness.
- `src/server/documents/`: authorization and metadata/revisions/source evidence plus a local private test-storage adapter. Keep files outside `public`; storage providers remain undecided.
- `src/app/api/`: authenticated, validated, origin-checked HTTP routes; pages use the same server services. Revalidate the session and current staff access on every consequential request.
- `tests/integration/` and `tests/e2e/`: real PostgreSQL/service/API/browser boundary tests; avoid mocked authorization or database behavior.

## Identity and permission contract

Better Auth owns four internal identity tables. Existing `users` is the unique hospital-staff mapping with `auth_user_id`; `staff`, roles and explicit branch memberships determine access. Invite acceptance uses a single-use expiring token and a supplied password, with no external email sending. Administrator copies the local invitation URL for testing. Disable staff and revoke sessions; do not hard-delete evidence. Expired/logged-out/removed staff cannot access protected routes even with an old browser cookie. Disable client signup and session cookie caching.

Insurance Desk/Claim Officer creates and prepares cases, assigns work, records review/query actions, and uploads documents. Billing and Finance can view assigned-branch cases/documents; their consequential money workflows arrive in later phases. Auditor reads scoped evidence. Hospital Admin manages its own staff/branches and work. Platform Admin manages hospital metadata only; there is no default access to hospital patient records or support impersonation. Support access requires a later explicitly authorized, audited design.

## Data and action contracts

IDs are positive decimal strings at HTTP boundaries. Operational hospital/branch ownership comes from a verified actor. Patients and insurance memberships are hospital-wide; encounters/cases and descendants are branch-scoped. Composite foreign keys prevent mixed patient/membership/encounter/claim links. Keep source NUMERIC amounts as exact decimal strings; active paise inputs convert using integer arithmetic. Unknown estimates/approval/patient amounts are nullable, not zero defaults.

Case creation has a caller-generated idempotency key and validates all related records and owner scope. Reusing a key with different input is a conflict. Preparation states use source vocabulary DRAFT/PENDING/IN_PROGRESS/QUERY/CANCELLED; APPROVED/REJECTED/SETTLED require later actual payer/payment evidence and cannot be set by this early action API. State changes, assignment, due/next-action edits and each query cycle require expectedVersion. Transactions update the case and append actor/time/reason/version evidence atomically. Duplicate identical action keys have one effect; conflicting repeats or stale updates are rejected.

## Private-file contract

Accept PDF, PNG, JPEG and UTF-8 text only, with actual signature/content checks, bounded size (5 MiB/file) and sanitized original filenames. Reject HTML/SVG/executables, empty/oversized/mismatched files and traversal. Stored keys are generated, never derived from a user filename. A document belongs to a scoped case, has immutable content hash/metadata and sequential revisions. Upload and download require a current authenticated, permitted actor. Downloads are attachments with `nosniff`, private/no-store headers. Revised evidence remains traceable; old revisions are retained. A failed file or metadata write leaves no visible partial revision. Source references include revision and page/field; later extraction will use them.

## Verification and completion

Each phase is independently checked and committed. Phase 3 runs desktop/mobile queue→case→back and loading/empty/error/cutoff checks. Phase 4 verifies all 42 tables/four views against both sources. Phase 5 checks fresh/idempotent migrations, schema inventory/checks/relationships and an additive change preserving data; backup/restore uses disposable synthetic databases. Phases 6–7 test real login/session/invite/removal, direct HTTP denials, hospital and branch isolation, and non-owner database RLS. Phase 8 tests persistence and invalid links/idempotency. Phase 9 exercises concurrent versions, invalid transitions, duplicate actions and immutable history. Phase 10 tests private access, file validation, failed upload, revision history and revoked access.

Use the existing Node.js 24/Next.js/TypeScript stack, PostgreSQL 17, Drizzle and Better Auth. Add Playwright Test and a TypeScript Node test runner; do not install LangGraph/Graphile Worker yet. Record results in BUILD_PLAN and docs/evidence. This establishes synthetic technical behavior through Phase 10, not hospital accuracy or production approval.
