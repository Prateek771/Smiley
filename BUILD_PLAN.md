# Smiley / Saavantus Build Tracker

Updated: 1 October 2026. This is the living progress record for the repository.

**Current position:** Phases 0–10 are locally verified using synthetic data. Final verification: 107 unit/server checks and 15 fresh-migration checks passed with zero skips; 58 desktop/mobile browser journeys passed (3.7 minutes locally, 1.5 minutes in exact CI); lint, typecheck and production build passed; production dependency audit found zero vulnerabilities. Exact checkpoint promotions are recorded in the [execution ledger](docs/evidence/phases-3-10-progress.md). Phases 11 onward remain planned; this checkpoint does not establish production or real-hospital readiness.

**First useful release:** A hospital insurance desk and billing team can prepare a cashless discharge case, handle repeated payer queries, record actual authorization, and confirm the patient amount with evidence. Settlement follows separately. The 1–2 hour ambition is a workflow target to measure, not a guarantee of payer approval or bank settlement.

## Branch workflow

All future development uses `dev` in the managed worktree. Push phase work to
`dev`; promote a checkpoint to `main` only after its applicable checks and
GitHub checks pass. The original project checkout follows `main`. Preserve
existing work; never force-push application branches or publish local recovery
refs. `codex/saavantus-app` is retained as the earlier checkpoint branch.

## Agreed foundation

- Next.js with TypeScript for the frontend and application backend.
- PostgreSQL, database name `sehospitaldb`; Drizzle for queries and reviewed migrations.
- The supplied **42 business/domain tables and four reporting views** are the starting inventory. Review all 42; implement their workflows incrementally.
- Better Auth manages identities/sessions. Hospital, branch, and role authorization is enforced separately.
- Graphile Worker and TypeScript LangGraph are planned for a separate persistent Node.js process in Phases 15–17; no background claims/AI workflow worker or AI runtime is implemented yet. Phase 10 uses bounded worker threads only for PDF validation.
- Tailwind CSS and native accessible controls support the desk journey; add a component dependency only when justified.
- Hosting, private document storage, and model/OCR providers remain undecided.

These decisions supersede older stack proposals in `outputs/`. The existing prototype is a visual reference. Extra authentication, queue, or agent-persistence tables may be necessary; explain their purpose and placement before adding them. Do not silently add domain tables or promise 42 as the permanent total.

## How we work through a phase

1. Explain the visible result, affected files, and main tradeoff.
2. Write expected outcomes using synthetic examples before coding.
3. Build one focused slice and run its new/affected checks.
4. Fix failures, demonstrate the result, and rerun relevant earlier checks.
5. Save a focused Git commit and record its evidence below.
6. Continue within the approved scope; pause for genuinely missing decisions.

A completed phase needs its deliverable, passing checks, a short demo/review where relevant, and a recorded commit. Provider failures or missing facts should have usable fallback paths. Documentation-only work needs content/link verification rather than an application rebuild.

**Existing commands:** Use Node.js 24+ and the locked dependencies. `npm run db:start`, `npm run db:migrate`, `npm run db:seed`, and `npm run auth:seed` prepare the synthetic local environment; append `-- --test` to migration/seeding commands for the isolated test database. `npm run dev` serves the app. `npm run test:integration` runs Node/tsx unit and PostgreSQL tests; `npm run test:e2e` prepares isolated fixtures, builds and serves production on port 3210 for desktop/mobile journeys; `npm test` runs both. `npm run lint`, `npm run typecheck`, and `npm run build` verify the application; `npm run start` serves the completed build. Do not share `.next` with another development/production server or build during browser checks. CI sets `PLAYWRIGHT_SKIP_BUILD=1` only to reuse its preceding fresh Build step in the same job. Use `npm run browser:install` and `npm run browser -- <command>` for exploratory synthetic browser checks. [README.md](README.md) documents setup and test isolation. Worker commands remain later.

Current code areas: `src/app/` for routes/screens, `src/features/` for focused UI modules, `src/server/` for identity/access/case/document/database services, `drizzle/` for reviewed migrations, and `tests/{unit,integration,e2e}/` for checks. A separate `src/worker/` remains planned for Phase 15. Define each later phase's precise file changes when it starts.

## Phase checklist

### Phase 0 — Local starter: complete

- [x] Install Next.js 16.3.8, React, TypeScript, Tailwind, and ESLint.
- [x] Create the managed worktree on `codex/saavantus-app`.
- [x] Verify lint, TypeScript, and production build during setup.
- [x] Remove the requested loose PDFs and Word documents from both checkouts.
- [x] Create `AGENTS.md` and this progress tracker.

The requested document files and their ZIP/tar archive entries have been removed from both checkouts. Phase 1 publishes a fresh root checkpoint; the original local history remains recoverable locally and is excluded from GitHub.

### Phase 1 — Save the checkpoint and connect private GitHub: complete

- [x] Complete Phase 1 and record evidence.
- [x] Add pinned agent-browser tooling; verify desktop/mobile capture and browser errors on the local starter.
- **Build:** Agree repository owner/name; save the cleanup and guide/tracker. Inspect current files, old archives, and the history to be published. Prepare a clean publishable history without removed documents, preserving local work and the managed worktree. Add GitHub Actions for the current lint, typecheck, and build commands.
- **Test:** A fresh checkout installs from the lockfile and passes those checks; the published files, archives, and history exclude the removed documents and credentials.
- **Pass when:** The approved private repository contains the checkpoint and CI is green. Verified on `c0be1ce`: [GitHub Actions run](https://github.com/Prateek771/Smiley/actions/runs/36769233198).

### Phase 2 — Define the first workflow and expected cases

- [x] Complete Phase 2 and record evidence.
- **Delivered:** [Workflow/roles/timers](docs/superpowers/specs/2026-10-01-cashless-discharge-design.md), [five structured packs](docs/fixtures/phase-2-cashless-discharge.json), and [validation record](docs/evidence/phase-2-validation.md). Eleven checkpoints and five timelines passed independent checks; real hospital/policy validation remains at the later gates.
- **Build:** Confirm the first cashless-discharge slice, staff roles, timer start/end, and human sign-offs. Prepare five fictional packs: clean approval, missing/conflicting evidence, repeated queries, disputed deduction, and partial settlement. Write independently checked expected amounts and actions.
- **Test:** Walk each pack through Desk, Billing, and Finance; include cases where the correct action is staff review.
- **Pass when:** Every pack has inputs, expected results, and a next action. Hospital interviews can run alongside synthetic development.

### Phase 3 — Build the desk shell and first browser journey

- [x] Complete Phase 3 and record evidence.
- **Delivered:** Public synthetic queue/detail, checkpoint cutoffs and recovery states. [Validation](docs/evidence/phase-3-validation.md): 18 desktop/mobile journeys, browser screenshot review, lint/types/build; exact CI/promotion in the execution ledger.
- **Build:** Confirm the component approach; create navigation, a fictional work queue, and case detail screens with clear owner/next action and empty/error states. Introduce Playwright Test and documented scripts. Use agent-browser to inspect each UI slice and capture desktop/mobile evidence.
- **Test:** Open the queue, select a case, return without losing context, and exercise loading/empty/error states. Mocked role views are labelled as demonstrations.
- **Pass when:** This small journey works locally and in CI. Test tools are installed and reproducible.

### Phase 4 — Review the 42-table schema before database setup

- [x] Complete Phase 4 and record evidence.
- **Delivered:** [Full source inventory](docs/schema/domain-inventory.json) and [migration review](docs/schema/phase-4-review.md), including ownership/link repairs and 10 justified identity/evidence structures. Source hashes preserved; no bootstrap SQL executed.
- **Build:** Inventory all 42 tables/four views, relationships, ownership, and required amendments. Review the five invalid UNIQUE clauses, lost ENUM validation, eight missing secondary indexes, and five updated_at behaviors. Resolve how Better Auth maps to existing users/roles; document internal queue/persistence storage.
- **Test:** Check the inventory against both supplied SQL files and challenge mixed patient/policy/encounter/hospital references.
- **Pass when:** Repairs, identity mapping, tenancy strategy, and any extra tables are explained and reviewable. Neither destructive bootstrap script has been executed.

### Phase 5 — Create repeatable PostgreSQL migrations

- [x] Complete Phase 5 and record evidence.
- **Delivered:** 52 tables and four invoker views, additive migrations, isolated PostgreSQL runtime, synthetic seeds, and [database validation/restore evidence](docs/evidence/phase-5-database.md). Fourteen real database checks passed at the Phase 5 checkpoint; independent review fixes reject non-finite numerics and branch-only audit ownership. Exact CI/promotion is recorded in the execution ledger.
- **Build:** Establish a disposable synthetic development/test database. Implement the reviewed Drizzle schema and migrations, intended constraints/indexes, and approved synthetic seeds.
- **Test:** Apply migrations to an empty database; apply subsequent changes without data loss; check the domain inventory, valid views, invalid enum values, duplicate records, and invalid relationships.
- **Pass when:** Setup is reproducible and existing data survives migration tests. Recovery is documented. Never run the source DROP DATABASE scripts against an existing database.

### Phase 6 — Implement login and staff sessions

- [x] Complete Phase 6 and record evidence.
- **Delivered:** Login, atomic staff invitations, expiry/logout/removal and protected routes; 31 server checks and 30 desktop/mobile journeys pass, plus lint/types/build. [Validation](docs/evidence/phase-6-auth.md). Exact checkpoint CI is tracked in the execution ledger.
- **Build:** Integrate Better Auth with the reviewed identity model; add sign-in/out, staff invitation, removal, and session expiry.
- **Test:** Valid/invalid login, expired sessions, logout, removed staff, and identity-link consistency.
- **Pass when:** Protected routes reject invalid sessions and there is one authoritative identity model.

### Phase 7 — Enforce hospital, branch, and role access

- [x] Complete Phase 7 and record evidence.
- **Delivered:** Hospital/branch/role isolation and grant provenance; 44 server checks, 12 focused auth browser journeys and lint/types/build pass. [Validation](docs/evidence/phase-7-access.md). Exact checkpoint CI is tracked in the execution ledger.
- **Build:** Enforce server/database scope checks and separate hospital administration from platform administration. Define the permitted support-access process.
- **Test:** Hospital A cannot read/change Hospital B records; unassigned branches and forbidden role actions are denied, including direct API calls.
- **Pass when:** The permission matrix is enforced. Reuse these negative tests for documents, exports, and workers as they are added.

### Phase 8 — Persist patients, insurance links, and cases

- [x] Complete Phase 8 and record evidence.
- **Delivered:** Patient, insurance, encounter and case persistence; 59 server checks and 38 desktop/mobile journeys passed at the Phase 8 checkpoint, plus lint/types/build. Active catalog, filtered queue and malformed-ID regressions pass. [Validation](docs/evidence/phase-8-cases.md). Exact checkpoint CI is tracked in the execution ledger.
- **Build:** Add patient/encounter registration, category/insurer/TPA/policy selection, and case creation with owner and next action.
- **Test:** Create and reopen a case; reject mismatched patients, policies, encounters, hospitals, and duplicate actions.
- **Pass when:** A real database-backed case survives refresh and appears in the correct staff queue.

### Phase 9 — Add the case timeline and controlled actions

- [x] Complete Phase 9 and record evidence.
- **Delivered:** Controlled preparation edits/statuses, deadlines, repeated payer-query references and local response drafts, stale-version checks, and immutable history. 69 server checks, 15 fresh migration-preservation checks, and 46 browser checks passed with lint/types/build. [Validation](docs/evidence/phase-9-actions.md). Checkpoint: `b1248b6e96c029f9644ba416ab6f7c63a0bbfad4`; [exact CI](https://github.com/Prateek771/Smiley/actions/runs/36849769943). A locally prepared response is not payer acknowledgement.
- **Build:** Record status/action history, assignments, deadlines, repeated query cycles, version checks, and protected audit events.
- **Test:** Two staff members update the same case; invalid transitions and duplicate actions are rejected or safely handled; historical events cannot be silently overwritten.
- **Pass when:** Staff can reconstruct who did what and why, and no update silently loses another staff member's work.

### Phase 10 — Add private documents and revisions

- [x] Complete Phase 10 and record evidence.
- **Delivered:** Private scoped uploads/downloads, immutable revisions, manual source notes pinned to exact revisions, content/size validation and rollback cleanup. Final checks: 107 unit/server checks and 15 fresh-migration checks passed with zero skips; 58 desktop/mobile browser journeys passed (3.7 minutes locally, 1.5 minutes in exact CI); lint, typecheck and production build passed; production dependency audit found zero vulnerabilities. [Validation](docs/evidence/phase-10-documents.md). Exact CI is checked before main promotion.
- **Build:** Implement private upload/download authorization, metadata, document revisions, source evidence, and safe file handling. Use synthetic files and a test storage adapter until the provider decision is made.
- **Test:** Forbidden downloads, invalid files/sizes, failed uploads, revised documents, and revoked access.
- **Pass when:** Originals and revisions remain traceable; access is private and scoped. Stored files are never placed in the public asset directory.

### Phase 11 — Add deterministic bill and rule assessment

- [ ] Complete Phase 11 and record evidence.
- **Build:** Capture/revise bill lines; apply versioned synthetic policy/tariff rules and preserve calculation snapshots, rounding choices, and line explanations.
- **Test:** Independently expected totals, co-pay/deductibles/caps, revised bills, missing rules, conflicting dates, and rounding cases.
- **Pass when:** Supported calculations match expected results and reproduce from their versions; uncertainty requests review instead of inventing coverage.

### Phase 12 — Prepare submissions and handle repeated queries

- [ ] Complete Phase 12 and record evidence.
- **Build:** Assemble a versioned, staff-reviewed claim pack. Support staff-assisted external submission, actual acknowledgements, repeat queries, revised responses, and ownership.
- **Test:** Missing evidence blocks pack readiness; changed inputs invalidate an old pack; repeated queries and duplicate acknowledgements remain traceable.
- **Pass when:** One fictional submission/query/resubmission loop works without assuming permitted payer APIs or automatic sending.

### Phase 13 — Record payer decisions and confirm patient payable

- [ ] Complete Phase 13 and record evidence.
- **Build:** Record actual authorization/rejection evidence; compare estimates with payer decisions. Let Billing reconcile deposits, concessions, deductions, outstanding amounts, and refunds before confirmation.
- **Test:** Clean approval, unexplained shortfall, disputed deduction, deposit/refund, unauthorized confirmation, and a revised bill after sign-off.
- **Pass when:** Estimated coverage, payer approval, and staff-confirmed patient payable are separate facts; changed inputs require renewed review. An insurer shortfall never automatically becomes patient debt.
- **Checkpoint:** Demonstrate the first complete manual cashless-discharge slice.

### Phase 14 — Reconcile settlement and remittance

- [ ] Complete Phase 14 and record evidence.
- **Build:** Record payment evidence, split allocations, partial/short payments, reversals, and finance follow-up.
- **Test:** A remittance covering multiple claims, unmatched amounts, duplicate imports, partial settlement, and reversals.
- **Pass when:** Allocated plus unallocated amounts reconcile to evidence, and approved money is distinguishable from received money.

### Phase 15 — Introduce the persistent job worker

- [ ] Complete Phase 15 and record evidence.
- **Build:** Add Graphile Worker in a separate Node.js process, reviewed queue storage, bounded retries, duplicate protection, and job status visibility.
- **Test:** Stop/restart the worker mid-job; repeat a job/event; submit stale or wrong-hospital context; simulate provider failure.
- **Pass when:** Work resumes safely without duplicate consequential actions, and failed jobs have an owner/recovery path.

### Phase 16 — Add document extraction with human verification

- [ ] Complete Phase 16 and record evidence.
- **Build:** Evaluate model/OCR candidates on synthetic documents; connect TypeScript LangGraph through the worker with persistent state. Attach extracted facts to exact source/page evidence and staff correction records.
- **Test:** Poor scans, contradictory values, missing pages, provider outage, unsupported documents, and job resumption.
- **Pass when:** Uncertain fields are reviewable, manual entry remains usable, and identifiable patient data is excluded from external traces by default.

### Phase 17 — Add claim-pack checks and response drafts

- [ ] Complete Phase 17 and record evidence.
- **Build:** Let agents identify missing/inconsistent evidence, prepare reviewed packs, draft source-backed query responses, and suggest follow-up tasks.
- **Test:** Invented claims/reasons, stale document versions, unsupported conclusions, repeated jobs, and human rejection/correction of drafts.
- **Pass when:** Drafts cite evidence, staff control consequential actions, and AI output never substitutes for payer approval or deterministic financial calculation.

### Phase 18 — Extend the earlier patient journey

- [ ] Complete Phase 18 and record evidence.
- **Build:** Add eligibility tracking, preauthorization, treatment updates, and authorization enhancements using existing case/document/query capabilities.
- **Test:** Repeated enhancement/query cycles, expired eligibility, revised approvals, and unclear payer responses.
- **Pass when:** Registration through final discharge is traceable; a request, estimate, and actual payer response remain distinct.

### Phase 19 — Add administration and useful reporting

- [ ] Complete Phase 19 and record evidence.
- **Build:** Complete hospital/platform administration, controlled rule management, exports, and desk/finance reporting. Show preparation time, payer waiting time, and desk resolution separately.
- **Test:** Role-scoped exports, private-data leakage, revised rules, missing financial evidence, and report totals against known cases.
- **Pass when:** Reports reconcile with underlying facts and do not imply that synthetic timing proves a real 1–2 hour outcome.

### Phase 20 — Deploy a synthetic staging environment

- [ ] Complete Phase 20 and record evidence.
- **Build:** Choose provider/region/budget and deploy the Next.js server, persistent worker, PostgreSQL, and private document storage. Separate environments and secrets.
- **Test:** Fresh deployment, worker continuity, private storage access, configuration errors, and provider outage fallback.
- **Pass when:** The approved staging environment runs synthetic cases with observable web/worker failures. Real patient data has not been enabled.

### Phase 21 — Prove recovery and synthetic release readiness

- [ ] Complete Phase 21 and record evidence.
- **Build:** Exercise backup/restore, worker recovery, failure monitoring, protected audit records, and the complete role-based workflow.
- **Test:** Restore into an isolated environment; replay interrupted/duplicate work; run all critical calculation, permission, document, and end-to-end cases.
- **Pass when:** Record an evidence-backed release report and known limitations. **Gate A: synthetic technical readiness** is complete.

### Phase 22 — Validate permitted historical cases

- [ ] Complete Phase 22 and record evidence.
- **Build:** Obtain a pilot hospital, explicit handling permission, an approved data route, applicable policy/tariff versions, and named desk/billing reviewers. Start with permitted de-identified cases.
- **Test:** Compare calculations, missing-document findings, workflow outcomes, and measured times with independently reviewed historical results.
- **Pass when:** Accuracy, disagreements, exclusions, and measured results are documented. **Gate B: historical validation** is complete; synthetic success alone cannot satisfy it.

### Phase 23 — Run a controlled production pilot

- [ ] Complete Phase 23 and record evidence.
- **Build:** Agree live scope, access responsibilities, operating/support procedures, provider handling terms, and hospital sign-offs for identifiable patient use.
- **Test:** A limited monitored rollout exercises access, corrections, fallback, recovery, and incident handling under the approved live scope.
- **Pass when:** **Gate C: identifiable-data production readiness** is signed off. Expand only from actual pilot evidence.

## Later extension lane

These are separate small build/test cycles after the core workflow is proven; the supplied tables alone do not mean these workflows already exist.

- [ ] **Reimbursement:** Support a distinct reimbursement journey; test its documents, payer decisions, and payment reconciliation.
- [ ] **Corporate accounts:** Connect sponsorship/contract terms to cases and invoices; test allocations, limits, and exceptions.
- [ ] **Government/package workflows:** Validate the applicable scheme/package rules with a qualified owner; test scheme-specific evidence and financial results.
- [ ] **Permitted integrations:** Add one hospital/insurer/TPA integration at a time only after access permission is confirmed; test acknowledgements, duplicate events, outages, and manual handoff.

## Decisions to resolve when needed

| Decision | Needed before | Current position |
| --- | --- | --- |
| GitHub owner/name and publishable history | Phase 1 publication | [Prateek771/Smiley](https://github.com/Prateek771/Smiley), private; clean root history published; main and codex branches connected |
| First workflow details and synthetic expected results | Phase 2 | Synthetic workflow/roles/timers and five packs defined; 11 checkpoints independently checked; real hospital rules and role authority remain unvalidated |
| Component library | Phase 3 | Tailwind and native accessible controls implemented; add a library when justified |
| Identity/tenancy mapping and internal tables | Phases 4–7 | Implemented: separate Better Auth identity, hospital/branch/role grants and forced RLS; 42 domain tables plus 10 justified internal tables, four invoker views |
| Private storage provider/region/access policy | Real storage integration; Phase 20 staging at latest | Production provider unselected; Phase 10 uses private local synthetic storage and reviewed access checks |
| Actual model/OCR provider and agent persistence | Phase 16 | Evaluate synthetic documents first; LangGraph is orchestration |
| Hosting provider/region/budget | Phase 20 | Unselected; persistent web/worker/database roles established |
| Pilot, approved real rules, and integration permissions | Phases 22–23 or any real integration | Unresolved; does not block synthetic development |

## Evidence and progress log

Add one row for each completed phase or meaningful failed checkpoint. Store test reports/screenshots under `docs/evidence/` when introduced, without secrets or patient data. Record actual results; never mark a checkbox because work was merely planned.

| Date | Phase | Commit | Checks/result | Demo/evidence and remaining issues |
| --- | --- | --- | --- | --- |
| 2026-10-01 | 0: framework setup | Original local-only `fe35d53` | Lint, typecheck, and production build passed during setup | Managed worktree verified; original history excluded from publication |
| 2026-10-01 | Planning | `c0be1ce` | Tracker structure and current commands verified | Contributor guide and tracker included in the published checkpoint |
| 2026-10-01 | 1: private GitHub and CI | `c0be1ce` | Local lint/typecheck/build passed; fresh GitHub checkout ran npm ci and all three checks successfully | [CI evidence](https://github.com/Prateek771/Smiley/actions/runs/36769233198); privacy/default branch verified; uploaded history and archives exclude removed PDFs/Word documents; both checkouts clean |

| 2026-10-01 | Tooling: agent-browser | [e2919c8](https://github.com/Prateek771/Smiley/commit/e2919c8167fd7ecfc18ff41a2199b1425da18e64) | Fresh npm ci, browser version 0.38.1, lint, typecheck, and production build passed | Headless local starter opened; rendered text/snapshot verified; 1280×800 and 390×844 screenshots inspected; zero page errors; evidence in local ignored tmp/browser/; testing session/server closed. Desktop/mobile regression journeys were introduced in Phase 3. |

| 2026-10-01 | 2: synthetic discharge workflow | [9e2f78a](https://github.com/Prateek771/Smiley/commit/9e2f78a153f2c70acb50b4b33b722620f2fe8f82) | Independent integer-paise audits: 5 packs, 11 checkpoints, 143 monetary/null outputs, 7 bill sums; 5 timing walkthroughs; current evidence/query/version scope reviewed | [Workflow](docs/superpowers/specs/2026-10-01-cashless-discharge-design.md), [fixtures](docs/fixtures/phase-2-cashless-discharge.json), [validation](docs/evidence/phase-2-validation.md). Synthetic assumptions only; subsequent application checkpoints are recorded in the execution ledger. |

Phases 3–9: [execution ledger](docs/evidence/phases-3-10-progress.md) records exact checkpoint SHAs, CI runs and validation reports. Phase 10 final results: 107 unit/server checks and 15 fresh-migration checks passed with zero skips; 58 desktop/mobile browser journeys passed (3.7 minutes locally, 1.5 minutes in exact CI); lint, typecheck and production build passed; production dependency audit found zero vulnerabilities. Reopen a phase if a later change invalidates its acceptance evidence; keep future phase results and approval gates explicit.

## GitHub recommendation and references

The **private GitHub repository is connected** and Phase 1's publication checks passed. It gives an off-computer source/history copy, reviewable phase changes, and automated checks on pushes/pull requests. Keep this Markdown checklist as the main progress record; add GitHub issues only for concrete work/bugs as they arise. Website hosting can be decided in Phase 20.

Created `Prateek771/Smiley` privately under the owner's authorization. `main` and `dev` track their remote branches; `codex/saavantus-app` is retained as the earlier checkpoint branch. The managed worktree is preserved. The original history remains under `refs/local-backups/pre-github-foundation` locally; keep that recovery ref off GitHub. Hosting and later product implementation need their own scope decisions.

- [GitHub: adding local code](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [GitHub: continuous integration](https://docs.github.com/en/actions/get-started/continuous-integration)
- [GitHub: repositories and visibility](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories)
- Domain findings: [source review](outputs/Smiley-source-review-2026-09-29.md). Older roadmaps remain reference material; use the agreed foundation above for current stack decisions.

Phase 10 application checkpoint `d0ead55c450661f753ff1262062a3e139ee5f4d0` passed [exact GitHub CI](https://github.com/Prateek771/Smiley/actions/runs/36859433632); the final evidence-only commit retains its application code. Main promotion follows successful checks of that final commit.
