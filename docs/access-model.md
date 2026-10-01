# Staff access model

The public `/demo` displays fictional fixture snapshots. `/desk` and its APIs require a valid Better Auth session and a current, active hospital staff profile. Every request re-reads hospital, staff, roles and exact branch-role grants. Session cookie caching is disabled.

| Role | Permitted scope |
| --- | --- |
| Hospital administrator | Own hospital and its active branches; staff invitations/removal and preparation |
| Insurance executive, TPA executive, claim verifier | Assigned branches; registration, preparation, documents and source notes |
| Receptionist | Assigned branches; patient/membership/encounter registration and case review |
| Billing, Finance, report user, doctor | Assigned branches; read cases and document evidence |
| Platform administrator | Hospital registry metadata; no default clinical access or hospital impersonation |

Patient and insurance registries are shared within one hospital. Encounters, cases, queries, events and document revisions are branch scoped. A desk role in one branch does not grant write authority in a branch where the same person has only a reader role.

`withActorTransaction` derives identity from the authenticated session, validates permission and branch-role pairs again inside a transaction, and sets transaction-local database context. The application connection is a non-owner role without `BYPASSRLS`. All 48 domain/operational tables use FORCE RLS; four global identity tables remain private to the Better Auth adapter. Reporting views use invoker security. Context is cleared by commit/rollback before pooled connections are reused.

Hospital administrators cannot grant platform roles or modify platform profiles. Invitation acceptance locks a row by a random token's stored hash; no request-supplied hospital/user becomes context. The narrow lock helper reads terminal/expired tokens for controlled errors; state changes still require the pending, unexpired invitation policy. Memberships retain inviter/grant/revocation provenance. Account removal revokes sessions and grants while keeping historical evidence.

There is no support impersonation endpoint. Platform credentials never obtain clinical scope. Any later production support process needs explicit hospital authority, ordinary scoped staff access, expiry and an audit record; it remains a later administration feature. This local environment uses synthetic records only.

RLS/functions are reviewed custom SQL migrations. Use `db:generate` only to prepare a reviewable additive draft; never use `drizzle-kit push` to reconcile production schemas. Preserve applied migration files and snapshots.
