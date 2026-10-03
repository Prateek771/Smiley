# Readiness audit before Phases 16–19

Date: 3 October 2026. Audited baseline: `9fea3dc1f9c8aef2f696776d3012a3ec8fbb3e64` on `dev`. This audit verified the existing application; it did not implement Phases 16–19.

## Result

The Phase 1–15 synthetic baseline is ready for the next development phases. No database, repository-access or installed-dependency blocker was found. This is development readiness, not production or real-hospital validation.

## PostgreSQL and preserved data

- Native Windows service `postgresql-x64-18` is running automatically; PostgreSQL reports version **18.6** on **127.0.0.1:5432**. Docker was not invoked.
- `npm run db:status` passed for the development and isolated test databases, using separate restricted application and migration roles. An intentionally invalid database password was rejected with PostgreSQL code `28P01`.
- Both databases have **10 migrations**, **57 public tables**, **53 tables with forced row-level security**, and **4 security-invoker views**. Every recorded migration SHA-256 matches its current SQL file; no applied migration was edited.
- Graphile's private queue is at pinned migration **20** and cannot be accessed by the application role. The development queue had no pending jobs before worker startup.
- All **56 non-session development tables** retain the same row counts and fingerprints before and after the audit. The original **4 cases** and **3 private document revisions** remain intact; all three files match their stored hashes. Development records were not reseeded. Session changes are expected during sign-in verification.

## Application and Phase 1–15 evidence

- Reviewed the tracker, acceptance criteria, linked evidence and source modules for authentication, scope enforcement, registration, case actions, private documents, assessments, submissions, payer decisions, patient reconciliation, settlement and durable jobs.
- Fresh `npm test`: **133/133** unit/server/database/API checks and **2/2** production HTTP scenarios passed, with **zero failures or skips**. Tests used the isolated test database. Worker regressions exercised duplicate delivery, stale inputs, revoked access, retries, graceful interruption and hard process crashes.
- Fresh ESLint, route generation, TypeScript checking and production compilation passed. Installed direct dependencies resolve without missing packages; Node is **24.11.1**. The npm production dependency audit reported **zero vulnerabilities**.
- After restarting localhost, preserved Desk credentials returned HTTP **200** for sign-in, the staff workspace, case API and case detail. The detail contained financial, payer/patient, settlement and background-job sections. All **3 protected downloads** matched their expected hashes, and a guest was redirected to login.
- No Playwright or Vercel agent-browser commands were run. The fresh served-page checks do not replace exhaustive browser or real-hospital acceptance testing.

## Folder and GitHub

- The retained folder is one standalone Git checkout on `dev`. Git object connectivity passed. The earlier `codex/saavantus-app` branch is a local recovery branch; GitHub has only `main` and `dev`.
- Local HEAD, local `main` and both remote branches matched the audited SHA. GitHub CLI authentication passed for `Prateek771`; repository permissions include push. An authenticated push dry run returned `Everything up-to-date` without modifying GitHub.
- Exact-commit CI passed on [dev](https://github.com/Prateek771/Smiley/actions/runs/37109992288) and [main](https://github.com/Prateek771/Smiley/actions/runs/37110374964). The dev run includes fresh foundation/additive migrations, private queue setup, server tests, lint, types, build and production HTTP checks.
- The repository remains public by owner choice. Runtime environments, private documents and diagnostic outputs are ignored; none of the current private provider keys, auth secret or database passwords appeared in the **218 tracked files** checked. **68 local documentation links** resolved before this report was added. Active environment settings do not reference the removed original folder.

## Next-phase prerequisites and runtime

OCR.space and OpenRouter passed live synthetic requests earlier in this session. The configured text model is exactly **`qwen/qwen3.8-27b:free`**; no other model was requested. Keys are present only in private configuration. These checks establish provider connectivity, not extraction or draft accuracy.

LangGraph orchestration, persistent agent state and application-level provider adapters are still Phase 16–17 work. Phase 18's earlier patient journey and Phase 19's administration/reporting remain unchecked. Free-provider limits, outages, evidence verification and rejection of unsupported model output must be exercised during those phases; no automatic switch to a different model is authorized. Real-data handling, hosting and hospital validation remain later gates.

The rebuilt application is running at **http://localhost:3000/login** and the separate persistent worker is connected and polling for `pack-review` jobs. Application source, database configuration, schemas and credentials were unchanged by this audit. This report and the provider/readiness entries in `BUILD_PLAN.md` are documentation changes only.
