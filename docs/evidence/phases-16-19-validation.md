# Phases 16–19 validation

Date: 3 October 2026. Baseline: `9fea3dc`. Application checkpoint: `1b1982b8c232c22a329e2ea987aeb80363e922a2`. Work uses the sole standalone `dev` checkout, native PostgreSQL and fictional records. Local verification and [exact application CI](https://github.com/Prateek771/Smiley/actions/runs/37118628739) passed. This report records synthetic results, not production readiness.

## Delivered behavior

- **16 — Extraction:** OCR.space Engine 2, bounded PDF/image uploads, page text and OCR-returned page word boxes; literal facts point to exact revision, page and quote. Immutable staff acceptance, correction and rejection preserve the original suggestion. No confidence score or PDF-coordinate normalization is invented.
- **17 — Assisted preparation:** Selected claim evidence exposes missing document categories and conflicting literal values. Pack summaries and query drafts quote current sources; suggested follow-ups require staff action. OpenRouter uses only `qwen/qwen3.8-27b:free`, with model substitution and fallback rejected.
- **18 — Earlier journey:** Evidenced eligibility, initial preauthorization, actual payer responses, treatment, repeated enhancements, query preparation/acknowledgement and discharge handoff retain immutable lineage. Requests and actual authorizations stay distinct.
- **19 — Administration/reporting:** Hospital access, branches and invitations; separate platform registry without clinical access; immutable rule revisions and approval/retirement; scoped desk/finance reports and formula-safe CSV. First-bill preparation, payer waiting, query turnaround and full desk resolution are separate clocks. Missing or stale money remains unknown.

Existing manual documents, payer decisions, Billing confirmations, disputes, payments and receipts remain separate workflows. AI suggestions cannot create any of those authorities.

AI query drafting currently covers unresolved case-timeline payer queries. Request-linked earlier-journey queries use their manual preparation/acknowledgement ledger. Report preparation measures first verified bill → first reviewed pack; full resolution measures the same bill → current valid Billing sign-off, including all waits/rework. Those clocks exclude the earlier preauthorization/treatment history.

## Database and recovery

Two additive migrations preserve all original applied SQL bytes. Development and test now have **12 migrations, 62 public tables, 58 forced-RLS tables and four security-invoker views**. Every applied hash matches its SQL file. The application remains a restricted non-owner role without BYPASSRLS.

Graphile queue version 20 and LangGraph checkpoint version 4 live in private schemas inaccessible to the app role. AI work rechecks current staff and source/query fingerprints before provider calls and publication. Saved OCR resumes after a model outage or actual worker process crash; temporary failures stop after three attempts and expose owner recovery. Clinical transactions do not span cloud calls; external tracing is disabled.

A private pre-migration PostgreSQL dump and fingerprints were saved under ignored `tmp/`. After additive development setup, **all 56 original non-session tables were unchanged**; the original four cases and three document objects remain, with matching file hashes and sizes. Development was not reseeded.

## Observed verification

The combined `npm test` passed **200/200** unit/server/database/API checks and **3/3** production HTTP scenarios, with zero failures or skips. Production compilation, lint and route/TypeScript checks passed. Focused checks covered AI providers/generation, durable AI review, journey, admin/auth, reports, financial decisions and original documents. A real registered Graphile worker was killed after its OCR checkpoint; recovery reused that checkpoint without repeating extraction. Model hallucination, incomplete OCR, stale sources, revoked authority, unsupported files and cross-scope access were rejected.

Independent review reproduced and fixed stale treatment/handoff ordering, a concurrent last-administrator race, a superseded Billing-confirmation source, partial literal extraction and shared worker-pool starvation. Regression checks passed after each repair. The combined initial run passed 199/200 checks; the remaining inventory assertion expected the old 57 tables. Its update also asserts forced RLS on every new table; all 15 database checks then passed.

Final review also reproduced concurrent platform administrators deactivating each other's registry hospitals. A global registry lock precedes authority reload; **all nine admin checks passed**, preserving one active administrator and one atomic audit. Invitation and branch-grant forms require an explicit role selection.

Live adapter calls read a fictional one-page PDF successfully. The exact Qwen model returned a valid source-backed structured fact; an earlier invalid response was safely rejected without switching models. A live durable graph then copied source text but mislabeled all six lines as dates. Browser staff rejection preserved the bad suggestion and separate review. Shared date/amount shape guards and explicit field instructions now reject that output; **26 AI unit checks and all ten durable AI integration checks passed** after repair. Source grounding alone does not establish correct classification or business applicability; staff review is required. Corrected live results and exact GitHub CI are recorded below.

Production dependency audit: **zero vulnerabilities**. The full audit reports five high advisories in the existing development-only Next ESLint → micromatch → braces chain. npm's suggested automatic change downgrades the Next ESLint configuration across a major version; it was not applied. Production LangGraph/provider dependencies are clean.

## Limits and next gate

Cloud requests require explicit fictional-data attestation. English OCR accepts PDF, PNG and JPEG, capped at **1,000,000 bytes and three actual PDF pages**. Extraction uses one source; pack/draft runs use up to twelve selected sources. Missing categories refer to that selection and conflicts refer to proposed literal facts. Free-provider availability and OCR accuracy are not guaranteed; unverified or unsupported results require manual review. There is no alternate model or local OCR path. Hosting, production storage, permitted real documents and hospital rule validation remain later gates.

Vercel agent-browser, Playwright and Docker were not invoked. Raw credentials, documents, provider payloads, backups and screenshots remain private and ignored.

## Final verification and publication

- Final lint, route generation/TypeScript and production compilation passed. All three production HTTP scenarios passed after the final code changes, including current role controls, sign-in throttling, origin denials and platform entry/clinical separation.
- Corrected live **EXTRACTION and PACK_CHECK each completed on attempt one** using the exact configured model. Both returned the literal case reference, INR 100,000.00 final bill and INR 85,000.00 payer authorization from the one-page fictional PDF. The pack draft cited sources and flagged the deliberately unselected policy/preauthorization/discharge categories. No alternate model was used.
- Codex AX browser review verified protected sign-in, current source/OCR views, immutable staff rejection and acceptance, live pack status/draft, filtered reports, hospital administration and separate platform entry. An evidenced UNCLEAR eligibility action produced version 13/history; earlier AI version-12 results remained historical. Phone checks at 390×844 showed usable case/admin layouts; overrides were reset. Screenshots remain ignored under `tmp/phases16-19/`.
- Refreshed native metadata/hash/document checks passed. Final preserved-staff sign-in succeeded on localhost:3000, displaying the original four development cases. All 56 original non-session tables were unchanged, and three private documents retained matching hashes/sizes. Publication scan found zero configured-secret matches across 260 publishable files; all 83 local Markdown links resolved before this evidence update.
- Independent final review found no remaining material issues. Date syntax guards do not establish calendar validity or business applicability; staff verification remains required.
- Application commit `1b1982b8c232c22a329e2ea987aeb80363e922a2` passed [exact GitHub CI](https://github.com/Prateek771/Smiley/actions/runs/37118628739): **205/205 server checks, 15/15 fresh migration checks and 3/3 production HTTP scenarios**, with zero failures or skips; dependency installation, native PostgreSQL setup, private queues/checkpoints, lint, types and build all passed.
- The final evidence-only commit retains that application code. Its exact CI must pass before the authorized fast-forward to `main`; GitHub's branch/run history records the final publication result. The local application and persistent worker remain running for review.
