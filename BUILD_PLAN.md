# Smiley / Saavantus Build Tracker

Updated: 3 October 2026. This is the living progress record for the repository.

**Product direction, 3 October:** Build a working hospital staff product; synthetic records are test fixtures, not the product's permitted business inputs. Normal staff screens and new supported rule versions use hospital-workflow terminology. `/demo` remains a labelled training example. Historical phase evidence remains valid as engineering evidence. The remaining phases now complete product setup, data handling/security, deployment/operations and hospital acceptance. See [production direction and staff journey](docs/production-direction.md).

**Native database transfer:** Both databases were restored and verified against their saved data/security snapshots, and all app/test connections now use installed PostgreSQL 18.6 on port 5432. The Docker runtime, Compose configuration and container-based CI service have been replaced. 112 unit/server checks and 15 fresh migration checks pass; lint, types and production build pass. All 58 desktop/mobile checks pass, and preserved staff sign-in, queue, case details and document download work on localhost:3000. See [transfer evidence](docs/evidence/native-postgresql-transfer.md).

**Current position:** Phases 0–19 are implemented and verified with synthetic data. Application checkpoint `1b1982b` passed [exact GitHub CI](https://github.com/Prateek771/Smiley/actions/runs/37118628739): 205 unit/server/database/API checks, 15 fresh migration checks, three production HTTP scenarios, lint, TypeScript and production build. Codex browser review covers source-backed extraction/pack drafts, staff acceptance/rejection, eligibility history, scoped reports, administration and phone layouts. See [Phases 16–19 validation](docs/evidence/phases-16-19-validation.md). Earlier Playwright/agent-browser results are historical; neither tool was invoked. This checkpoint does not establish production or real-hospital readiness. Next is Phase 20: production application foundation; hosting/private storage are Phase 22 decisions.

**Pre-build readiness refresh, 3 October:** Baseline `9fea3dc` passed fresh local 133 server/database/API checks, two production HTTP scenarios, lint, types and production build. PostgreSQL, preserved development data, private documents, GitHub authentication/push access and exact-commit CI on `main`/`dev` were verified. OCR.space and OpenRouter's exact `qwen/qwen3.8-27b:free` model passed synthetic connectivity checks; their application integration is now delivered in Phases 16–17. See [the baseline readiness audit](docs/evidence/phase-16-readiness-2026-10-03.md).

**First useful release:** A hospital insurance desk and billing team can prepare a cashless discharge case, handle repeated payer queries, record actual authorization, and confirm the patient amount with evidence. Settlement follows separately. The 1–2 hour ambition is a workflow target to measure, not a guarantee of payer approval or bank settlement.

## Branch workflow

All future development uses `dev` in the single standalone project folder,
`%USERPROFILE%\.codex\worktrees\saavantus-app\Smiley insurance`. Push phase work to
`dev`; promote a checkpoint to `main` only after its applicable checks and
GitHub checks pass. Both branches use this one repository; the former original
checkout was removed after [verified consolidation](docs/evidence/project-folder-consolidation-2026-10-03.md). Preserve
existing work; never force-push application branches or publish local recovery
refs. GitHub has `main` and `dev`; `codex/saavantus-app` is retained locally
as an earlier recovery checkpoint, with its remote branch removed.

## Agreed foundation

- Next.js with TypeScript for the frontend and application backend.
- PostgreSQL, database name `sehospitaldb`; Drizzle for queries and reviewed migrations.
- The supplied **42 business/domain tables and four reporting views** are the starting inventory. Review all 42; implement their workflows incrementally.
- Better Auth manages identities/sessions. Hospital, branch, and role authorization is enforced separately.
- Graphile Worker runs in a separate persistent Node.js process. It performs deterministic pack review and checkpointed TypeScript LangGraph extraction/drafting, with bounded retries and owner recovery. Actual payer submissions and acknowledgements remain manually evidenced. Phase 10's bounded PDF-validation threads remain separate.
- Tailwind CSS and native accessible controls support the desk journey; add a component dependency only when justified.
- Hosting and production private document storage remain undecided. Synthetic AI uses OCR.space and OpenRouter with only `qwen/qwen3.8-27b:free`; bounded adapters, immutable staff reviews and private PostgreSQL LangGraph persistence are implemented. No alternative model or local OCR fallback is enabled.

These decisions supersede older stack proposals in `outputs/`. The existing prototype is a visual reference. Extra authentication, queue, or agent-persistence tables may be necessary; explain their purpose and placement before adding them. Do not silently add domain tables or promise 42 as the permanent total.

## How we work through a phase

1. Explain the visible result, affected files, and main tradeoff.
2. Write expected outcomes using synthetic examples before coding.
3. Build one focused slice and run its new/affected checks.
4. Fix failures, demonstrate the result, and rerun relevant earlier checks.
5. Save a focused Git commit and record its evidence below.
6. Continue within the approved scope; pause for genuinely missing decisions.

A completed phase needs its deliverable, passing checks, a short demo/review where relevant, and a recorded commit. Provider failures or missing facts should have usable fallback paths. Documentation-only work needs content/link verification rather than an application rebuild.

**Existing commands:** Use Node.js 24+ and locked dependencies. `npm run db:start` checks native PostgreSQL; `npm run db:migrate` applies reviewed migrations. `npm run worker:setup` explicitly installs the pinned private queue, and `npm run worker` starts its separate process. Append `-- --test` to migration/queue setup commands for the isolated database. Seed only fresh synthetic installations. `npm run dev` serves development; `npm run start` serves a completed build. `npm test` runs serial server/database checks, builds production and runs isolated HTTP checks on 3216. Lint, typecheck and build verify the application. Stop servers sharing `.next` before builds. Only CI uses `HTTP_SKIP_BUILD=1` after its fresh Build step. Review visible screens through Codex's browser; do not invoke Docker, agent-browser or Playwright. [README.md](README.md) documents setup and isolation.

Current code areas: `src/app/` for routes/screens, `src/features/` for focused UI, `src/server/` for scoped services, `src/worker/` for durable background work, `drizzle/` for reviewed migrations, and `tests/{unit,integration,http}/` for active checks. Legacy `tests/e2e/` remains historical. Define each later phase's precise changes when it starts.

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

- [x] Complete Phase 11 and record evidence.
- **Delivered:** Versioned Billing bill/assessment snapshots, exact paise arithmetic and protected native forms. [Evidence](docs/evidence/phase-11-financial.md). Final combined verification is recorded in the Phases 11–15 report.
- **Build:** Capture/revise bill lines; apply versioned synthetic policy/tariff rules and preserve calculation snapshots, rounding choices, and line explanations.
- **Test:** Independently expected totals, co-pay/deductibles/caps, revised bills, missing rules, conflicting dates, and rounding cases.
- **Pass when:** Supported calculations match expected results and reproduce from their versions; uncertainty requests review instead of inventing coverage.

### Phase 12 — Prepare submissions and handle repeated queries

- [x] Complete Phase 12 and record evidence.
- **Delivered:** Frozen source revisions, evidenced external submission/query acknowledgement and resolution, with stale-source invalidation. [Evidence](docs/evidence/phase-12-submission.md).
- **Build:** Assemble a versioned, staff-reviewed claim pack. Support staff-assisted external submission, actual acknowledgements, repeat queries, revised responses, and ownership.
- **Test:** Missing evidence blocks pack readiness; changed inputs invalidate an old pack; repeated queries and duplicate acknowledgements remain traceable.
- **Pass when:** One fictional submission/query/resubmission loop works without assuming permitted payer APIs or automatic sending.

### Phase 13 — Record payer decisions and confirm patient payable

- [x] Complete Phase 13 and record evidence.
- **Delivered:** Final/conditional/rejected decisions, exact Billing allocation, actual patient payments/refunds and reversals. Higher approvals can reduce liability; unexplained deductions remain disputes. [Evidence](docs/evidence/phase-13-patient.md).
- **Build:** Record actual authorization/rejection evidence; compare estimates with payer decisions. Let Billing reconcile deposits, concessions, deductions, outstanding amounts, and refunds before confirmation.
- **Test:** Clean approval, unexplained shortfall, disputed deduction, deposit/refund, unauthorized confirmation, and a revised bill after sign-off.
- **Pass when:** Estimated coverage, payer approval, and staff-confirmed patient payable are separate facts; changed inputs require renewed review. An insurer shortfall never automatically becomes patient debt.
- **Checkpoint:** Demonstrate the first complete manual cashless-discharge slice.

### Phase 14 — Reconcile settlement and remittance

- [x] Complete Phase 14 and record evidence.
- **Delivered:** Immutable remittances, split allocations, unmatched/partial/overpayment follow-up and reversals, protected by database constraints/RLS. [Evidence](docs/evidence/phase-14-settlement.md).
- **Build:** Record payment evidence, split allocations, partial/short payments, reversals, and finance follow-up.
- **Test:** A remittance covering multiple claims, unmatched amounts, duplicate imports, partial settlement, and reversals.
- **Pass when:** Allocated plus unallocated amounts reconcile to evidence, and approved money is distinguishable from received money.

### Phase 15 — Introduce the persistent job worker

- [x] Complete Phase 15 and record evidence.
- **Delivered:** Separate pinned Graphile process, durable requests, current identity/input checks, bounded retries, safe local crash recovery and visible owner recovery. [Evidence](docs/evidence/phase-15-worker.md).
- **Build:** Add Graphile Worker in a separate Node.js process, reviewed queue storage, bounded retries, duplicate protection, and job status visibility.
- **Test:** Stop/restart the worker mid-job; repeat a job/event; submit stale or wrong-hospital context; simulate provider failure.
- **Pass when:** Work resumes safely without duplicate consequential actions, and failed jobs have an owner/recovery path.

### Phase 16 — Add document extraction with human verification

- [x] Complete Phase 16 and record evidence.
- **Delivered:** Bounded cloud extraction, exact source/page quotes, immutable staff reviews and durable private LangGraph checkpoints. Live extraction correctly labels reference/bill/authorization tokens after format-guard review fixes; no date is invented. [Validation](docs/evidence/phases-16-19-validation.md).
- **Build:** Evaluate model/OCR candidates on synthetic documents; connect TypeScript LangGraph through the worker with persistent state. Attach extracted facts to exact source/page evidence and staff correction records.
- **Test:** Poor scans, contradictory values, missing pages, provider outage, unsupported documents, and job resumption.
- **Pass when:** Uncertain fields are reviewable, manual entry remains usable, and identifiable patient data is excluded from external traces by default.

### Phase 17 — Add claim-pack checks and response drafts

- [x] Complete Phase 17 and record evidence.
- **Delivered:** Selected-source missing/conflict checks, sourced pack/query drafts and explicit follow-up suggestions. Live pack checking completes with correct quotes; staff control all consequential actions. Earlier request-linked queries retain manual preparation/acknowledgement. [Validation](docs/evidence/phases-16-19-validation.md).
- **Build:** Let agents identify missing/inconsistent evidence, prepare reviewed packs, draft source-backed query responses, and suggest follow-up tasks.
- **Test:** Invented claims/reasons, stale document versions, unsupported conclusions, repeated jobs, and human rejection/correction of drafts.
- **Pass when:** Drafts cite evidence, staff control consequential actions, and AI output never substitutes for payer approval or deterministic financial calculation.

### Phase 18 — Extend the earlier patient journey

- [x] Complete Phase 18 and record evidence.
- **Delivered:** Eligibility, actual preauthorization responses, treatment, repeated enhancement/query lineage and discharge handoff with chronology/source guards. Fifteen journey checks pass; a Codex browser action records evidenced UNCLEAR eligibility and history. [Validation](docs/evidence/phases-16-19-validation.md).
- **Build:** Add eligibility tracking, preauthorization, treatment updates, and authorization enhancements using existing case/document/query capabilities.
- **Test:** Repeated enhancement/query cycles, expired eligibility, revised approvals, and unclear payer responses.
- **Pass when:** Registration through final discharge is traceable; a request, estimate, and actual payer response remain distinct.

### Phase 19 — Add administration and useful reporting

- [x] Complete Phase 19 and record evidence.
- **Delivered:** Hospital access/branch/invitation administration, separate platform registry, immutable rule lifecycle and scoped desk/finance reports/CSV. Concurrent deactivation races are fixed; missing/stale money remains unknown. [Validation](docs/evidence/phases-16-19-validation.md).
- **Build:** Complete hospital/platform administration, controlled rule management, exports, and desk/finance reporting. Show preparation time, payer waiting time, and desk resolution separately.
- **Test:** Role-scoped exports, private-data leakage, revised rules, missing financial evidence, and report totals against known cases.
- **Pass when:** Reports reconcile with underlying facts and do not imply that synthetic timing proves a real 1–2 hour outcome.

### Phase 20 — Complete production application foundation

- [ ] Complete Phase 20 and record evidence.
- [x] **20.1 direction checkpoint:** Normal staff wording and the supported `CASHLESS-DISCHARGE-1` calculation version are delivered, with legacy arithmetic/provenance preserved. [Verification and remaining limits](docs/evidence/production-direction-2026-10-03.md). Checkpoints 20.2–20.4 remain pending.
- **Build:** Complete a hospital staff workspace independent of seeded examples: normal hospital/branch setup, first-admin provisioning, invitations, insurer/TPA/policy configuration and source-backed rules. Separate training/sample data from environment configuration. Keep documented unsupported-rule review paths.
- **Small checkpoints:** 20.1 staff wording and supported non-fixture calculation version; 20.2 seed-free hospital/administrator onboarding; 20.3 insurer/TPA/policy configuration; 20.4 reviewed rule/tariff setup and role walkthrough.
- **Test:** Use synthetic inputs with ordinary names/codes through the same APIs/forms. Verify empty installations, ownership, dates, unsupported contracts, exact money and preserved historical snapshots. Existing development records must survive.
- **Pass when:** A newly configured hospital can run the supported manual workflow without test seeds or fixture-specific engine identifiers. Production data permissions remain a separate Phase 21 gate.

### Phase 21 — Complete production data handling and security

- [ ] Complete Phase 21 and record evidence.
- **Build:** Replace the cloud connector's test-only request/database contract with explicit document classification and hospital-scoped external-processing approval. Complete private document retention/access, secure deployment credentials/sessions, staff recovery and reviewed audit responsibilities. Retain manual workflows and the owner's exact model choice.
- **Small checkpoints:** 21.1 handling policy and provider decision; 21.2 scoped processing contract and worker revocation; 21.3 document lifecycle; 21.4 deployed identity/access review and recovery.
- **Test:** Use synthetic documents to prove unapproved processing is denied before network calls, revoked permission stops queued work, source changes prevent publication, provider limits/outages have clear recovery, and removed staff cannot read documents/exports.
- **Pass when:** Engineering behavior is independently verified and the owner/hospital has approved the permitted handling route. Clinical cloud processing remains disabled wherever approval is absent; testing does not require real patients.

### Phase 22 — Deploy and prove production operations

- [ ] Complete Phase 22 and record evidence.
- **Build:** Choose hosting/region/budget and private storage; deploy web server, persistent worker and PostgreSQL with separate staging/production configuration. Add useful monitoring, incident ownership, backups and documented multi-process recovery.
- **Small checkpoints:** 22.1 infrastructure/storage choice; 22.2 staging deployment with test fixtures; 22.3 backup/restore and worker failure drill; 22.4 production configuration and operational handoff.
- **Test:** Fresh deployment, failed uploads, access denials, configuration errors, real process interruption, duplicate jobs, provider outage, isolated restore and complete role-based journeys. Development/test seeds must never run against production.
- **Pass when:** **Gate A: technical and operational readiness** has an evidence-backed release report, successful restore and named operating responsibilities. Clinical handling remains subject to Phase 21 approval.

### Phase 23 — Hospital acceptance and controlled production release

- [ ] Complete Phase 23 and record evidence.
- **Build:** Walk named hospital staff through their real operating roles, validate applicable policies/rules against permitted historical cases, and agree limited live scope, access, support and handling responsibilities. Use a monitored pilot after those decisions.
- **Small checkpoints:** 23.1 role acceptance with synthetic cases; 23.2 permitted historical validation; 23.3 approved limited pilot; 23.4 release decision and documented exclusions.
- **Test:** Compare calculations and workflow outcomes with independently reviewed expected results. Exercise corrections, private access, manual fallback, recovery and incident ownership; record measured times without promising payer outcomes.
- **Pass when:** **Gate B: hospital/rule validation** and **Gate C: permitted production use** are signed off. Expand from actual acceptance and pilot evidence, not a fictional success rate.

## Later extension lane

These are separate small build/test cycles after the core workflow is proven; the supplied tables alone do not mean these workflows already exist.

- [ ] **Reimbursement:** Support a distinct reimbursement journey; test its documents, payer decisions, and payment reconciliation.
- [ ] **Corporate accounts:** Connect sponsorship/contract terms to cases and invoices; test allocations, limits, and exceptions.
- [ ] **Government/package workflows:** Validate the applicable scheme/package rules with a qualified owner; test scheme-specific evidence and financial results.
- [ ] **Permitted integrations:** Add one hospital/insurer/TPA integration at a time only after access permission is confirmed; test acknowledgements, duplicate events, outages, and manual handoff.

## Decisions to resolve when needed

| Decision | Needed before | Current position |
| --- | --- | --- |
| GitHub owner/name and publishable history | Phase 1 publication | [Prateek771/Smiley](https://github.com/Prateek771/Smiley), currently public by owner choice; clean root history published; main and dev connected |
| First workflow details and synthetic expected results | Phase 2 | Synthetic workflow/roles/timers and five packs defined; 11 checkpoints independently checked; real hospital rules and role authority remain unvalidated |
| Component library | Phase 3 | Tailwind and native accessible controls implemented; add a library when justified |
| Identity/tenancy mapping and internal tables | Phases 4–7 | Implemented: separate Better Auth identity, hospital/branch/role grants and forced RLS; 42 domain tables plus 10 justified internal tables, four invoker views |
| Private storage provider/region/access policy | Phase 21 handling design and Phase 22 deployment | Production provider unselected; current local development storage has reviewed scope checks |
| Actual model/OCR provider and agent persistence | Phase 16 | OCR.space plus exact OpenRouter `qwen/qwen3.8-27b:free`; bounded adapters, persisted LangGraph stages, source validation and immutable staff reviews implemented. Correct live extraction/pack checks, browser reviews and exact application checkpoint CI passed. No alternative model fallback |
| Hosting provider/region/budget | Phase 22 | Unselected; persistent web/worker/database roles established |
| Hospital rules, document handling, pilot and integration permissions | Rule setup in Phase 20; handling in Phase 21; acceptance in Phase 23 | Unresolved; develop the actual product with synthetic fixtures while these decisions are prepared |

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

Phases 16–19 application checkpoint [1b1982b](https://github.com/Prateek771/Smiley/commit/1b1982b8c232c22a329e2ea987aeb80363e922a2) passed [exact CI](https://github.com/Prateek771/Smiley/actions/runs/37118628739): 205 server checks, 15 fresh migration checks and three production HTTP scenarios, with no failures or skips. Lint, types and build passed; production dependency audit found zero vulnerabilities. Live cloud extraction/pack checks and Codex desktop/phone review passed. All 56 original non-session development tables and three private document objects remain intact. [Full validation and limits](docs/evidence/phases-16-19-validation.md). The evidence-only checkpoint retains this application code and follows the same exact-CI-before-`main` publication rule.

## GitHub recommendation and references

The **public GitHub repository is connected** and Phase 1's publication checks passed. The owner confirmed public visibility on 3 October 2026 so friends can view it; future visibility changes remain the owner's decision. It gives an off-computer source/history copy, reviewable phase changes, and automated checks on pushes/pull requests. Keep this Markdown checklist as the main progress record; add GitHub issues only for concrete work/bugs as they arise. Website hosting is decided in the revised Phase 22 deployment work.

Created `Prateek771/Smiley` privately under the owner's original authorization; its current visibility is public. `main` and `dev` track their remote branches; `codex/saavantus-app` remains only as an earlier local recovery branch. The retained folder is now standalone, with all Git history and local recovery refs preserved. The original history remains under `refs/local-backups/pre-github-foundation` locally; keep that recovery ref off GitHub. Hosting and later product implementation need their own scope decisions. The [3 October sync audit](docs/evidence/repository-sync-2026-10-03.md) preceded the [single-folder consolidation](docs/evidence/project-folder-consolidation-2026-10-03.md); the former original checkout no longer exists.

- [GitHub: adding local code](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [GitHub: continuous integration](https://docs.github.com/en/actions/get-started/continuous-integration)
- [GitHub: repositories and visibility](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories)
- Domain findings: [source review](outputs/Smiley-source-review-2026-09-29.md). Older roadmaps remain reference material; use the agreed foundation above for current stack decisions.

Phase 10 application checkpoint `d0ead55c450661f753ff1262062a3e139ee5f4d0` passed [exact GitHub CI](https://github.com/Prateek771/Smiley/actions/runs/36859433632); the final evidence-only commit retains its application code. Main promotion follows successful checks of that final commit.


### Post-Phase 10 review: staff workspace entry

Corrected the homepage to open the protected staff workspace and added a visible staff sign-in link to the public demo. Lint, type checking, production build, and agent-browser entry-path checks passed at that historical checkpoint. [Review evidence](docs/evidence/staff-workspace-entry-review.md). Phases 11–15 now extend that workspace; current browser review uses Codex only.
