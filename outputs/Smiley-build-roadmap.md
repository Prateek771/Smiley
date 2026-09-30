# Smiley v1 build roadmap

Scope dated 26 September 2026. All tasks start unchecked. 47 synthetic technical tasks, 3 hospital-dependent readiness tasks and 6 parallel validation tasks. The interactive guide records your progress separately in the browser.

## 1. Agree the slice and make test cases

Define the first useful product and the examples that will tell us whether it works. Hospital conversations can run beside this work.

- [ ] **Write the v1 promise and boundaries** (Product) — Focus on hospital staff assessing a final bill against an insurer's final decision, resolving differences, and then matching later payments. Keep a simple earlier case timeline. Name the first customer: an independent private hospital of roughly 50–200 beds.
  - Completion evidence: A scope page names users, buyer, first useful workflow, and exclusions: reimbursement, patient/insurer accounts, direct submission, and automatic patient billing.
- [ ] **Create five complete fictional case packs** (Testing) — Prepare clean approval, query or increased approval request, disputed deduction, missing or conflicting rule, and partial or short settlement cases. Use invented people, hospital names, bills, documents, and contract terms.
  - Completion evidence: Five labelled synthetic packs each include source documents, events, expected amounts, expected manual actions, and an expected final state.
- [ ] **Write the expected answer before building** (Testing) — For each case, show how every amount was derived and which facts remain unknown. Include examples where the correct result is to stop calculation and ask for staff review.
  - Completion evidence: An expected-results sheet reconciles each supported amount and identifies unsupported conclusions without inventing values.
- [ ] **Register usable public test material** (External) — Use official illustrative claim examples, blank forms, and policy wordings to test formats and source links. Record the publisher, URL, retrieval date, version, permitted-use check, and fields reused. Replace example identities with new fictional identities.
  - Completion evidence: A source register links each fixture to its origin and explains what it can and cannot validate; no patient grievance files or leaked records are included.
- [ ] **Map the people and handoffs** (Product) — Describe what the desk, billing, medical reviewer, finance, and hospital admin do. Mark the insurer portal or email steps that happen outside Smiley and who records their results.
  - Completion evidence: One case walkthrough assigns an owner and next action at each handoff, including who approves rules and who confirms patient charges.
- [ ] **Set up the decision and validation log** (Product) — Record agreed scope, open choices, guesses, and evidence needed. Prepare the parallel interview lane for week one so learning can improve the build without blocking fictional examples.
  - Completion evidence: Every open question has an owner and a proposed way to answer it; the six parallel validation tasks are visible and do not block stages 1–7.

**Stage gate:** Move on when the scope and expected test outcomes are written down. A hospital partner or completed interview is not required for the synthetic build.

## 2. Design the screens and system

Turn the agreed workflow into a screen plan, clear data responsibilities, and technical choices before building the platform.

- [ ] **Walk through the core screens** (Frontend) — Sketch the case queue, timeline, document verification, bill assessment, decision comparison, patient explanation, settlement queue, and rule/access administration. Use one fictional case to connect them.
  - Completion evidence: A screen walkthrough shows the next action, owner, missing information, loading/empty/error states, and a usable layout for a hospital desktop.
- [ ] **Define the case and money records** (Database) — Plan versioned bills, documents, approved rules, assessments, insurer decisions, and payments. Keep estimate, initial approval limit, final authorization, concession, deposit, confirmed patient collectible, and actual settlement as separate facts.
  - Completion evidence: A data dictionary gives each fact a source, date, status, owner, and revision policy; example records preserve all seven money observations.
- [ ] **Choose a small deployment architecture** (Backend) — Select the web frontend, backend, relational database, private document storage, background worker, and hosting approach. Explain why each fits this first release and how development, test, and production will be separated.
  - Completion evidence: An architecture decision record lists chosen providers, responsibilities, expected cost drivers, data locations to verify, and a diagram of the request and document flow.
- [ ] **Write the permission and isolation rules** (Security) — Define hospital isolation, branch access, group access only to assigned branches, and desk/billing/finance/admin permissions. Define any support access as temporary, hospital-authorized, and audited.
  - Completion evidence: A permission matrix covers case reads, document downloads, edits, exports, rule approval, patient amount confirmation, and support access; forbidden actions have explicit test cases.
- [ ] **Specify calculations and unknown states** (Backend) — Write the supported fictional rule types, application order, rounding, effective dates, and conflict handling. Decide how staff see unsupported items. Keep real contract precedence open for a qualified hospital reviewer.
  - Completion evidence: A calculation specification maps the five case packs to outputs and manual-review paths without presenting guessed real-world contract logic as settled.
- [ ] **Set the external-service and verification plan** (External) — Choose initial import formats and authentication needs. Decide whether OCR is useful yet and list the checks required before an OCR/AI provider receives patient data. Plan automated tests, code review, dependency checks, and release evidence.
  - Completion evidence: A service register states what each provider receives, why it is needed, its fallback, and unresolved terms; a test plan maps major risks to checks.

**Stage gate:** Move on when every required task has a screen or service, every sensitive action has a permission, and chosen vendors and assumptions are recorded.

## 3. Build the secure foundation

Create the application, access controls, data boundaries, and operating basics before adding case handling.

- [ ] **Create repeatable development and test environments** (Deployment) — Set up the application repository, local setup instructions, automated checks, environment configuration, and isolated synthetic test deployment. Keep credentials out of source files.
  - Completion evidence: A clean checkout can run the app and checks from documented commands; the test deployment contains only synthetic records and uses protected secrets.
- [ ] **Implement sign-in and staff lifecycle** (Security) — Build invitations, sign-in, session handling, role assignment, and prompt access removal when a staff member leaves. Apply the agreed stronger authentication policy for sensitive roles.
  - Completion evidence: Tests cover valid and invalid sessions, role changes, removed staff, and restricted administrative actions; the UI explains access failures clearly.
- [ ] **Enforce hospital and branch boundaries** (Database) — Make tenant and branch checks part of backend and database access. Restrict document operations, exports, and worker tasks using the same verified context.
  - Completion evidence: Automated attempts by Hospital A to access Hospital B records fail across all entry points; branch and assigned group-user tests also pass.
- [ ] **Create private document storage** (Backend) — Allow only approved file types and sizes, protect upload and download access, quarantine unsafe files, and keep original versions. Treat document contents as untrusted input.
  - Completion evidence: Tests reject unsafe or unauthorized uploads and downloads; document links expire as designed and cannot be reused to cross hospital boundaries.
- [ ] **Record audit history without exposing patient details** (Security) — Record who read or changed sensitive records, approved rules, confirmed charges, or exported data. Protect the audit record from ordinary editing and keep sensitive content out of routine error logs.
  - Completion evidence: A reviewer can trace sample actions by actor, hospital, time, and object; logs and error reports pass a check for unwanted document or patient content.
- [ ] **Build the shared staff interface** (Frontend) — Create the workspace shell, hospital/branch context, navigation, forms, table patterns, and accessible keyboard interactions. Make synthetic data visibly identifiable.
  - Completion evidence: A user can navigate with a keyboard, see their workspace, understand errors, and distinguish test records; shared components work at the agreed screen sizes.
- [ ] **Establish backup and job recovery basics** (Deployment) — Configure database and document backup coverage, worker retries, failure visibility, and duplicate-job protection. Practice restoration using fictional data early.
  - Completion evidence: A documented test restores related records and documents together; repeated jobs do not create duplicate money events or documents.

**Stage gate:** Move on when cross-hospital and unauthorized branch access fail in the application, API, storage, exports, and background work using at least two fictional hospitals.

## 4. Build the case and evidence workflow

Give staff one place to track a case, verify its facts, and preserve what happened through external insurer channels.

- [ ] **Create cases and a usable work queue** (Frontend) — Capture the patient reference, payer/product, hospital/branch, admission information, owner, stage, and next action. Support tracking even when detailed calculations are unavailable.
  - Completion evidence: Staff can create, find, assign, filter, and resume the five fictional cases without confusing unsupported calculation with an unusable case.
- [ ] **Capture the external insurer timeline** (Backend) — Record initial approval requests and responses, conditions, questions, increased approval requests, final submissions, dates, references, and attachments. Staff continue sending through existing portals or email.
  - Completion evidence: The query/enhancement case shows what was sent, when, through which channel, what came back, and who has the next action.
- [ ] **Build document and fact verification** (Frontend) — Show original documents beside editable extracted or manually entered facts. Link important facts to a page or location, and record who verified or corrected them.
  - Completion evidence: Material fields cannot quietly become verified; a reviewer can move from a fact to its source and see corrections and verification history.
- [ ] **Import and version the itemized final bill** (Database) — Start with an agreed CSV or controlled PDF format. Map bill lines and categories, check totals, detect repeated imports, and preserve older versions when billing issues a correction.
  - Completion evidence: A corrected bill creates a new version; total mismatches and duplicates are flagged; old assessments still reference the exact old bill.
- [ ] **Add extraction assistance only with a review path** (Backend) — If useful, connect OCR for document classification and proposed fields. Keep manual entry available, show uncertainty, and ensure document text cannot instruct the system to perform unrelated actions.
  - Completion evidence: Low-quality scans, wrong fields, service failure, and hostile document text result in safe review or fallback; extracted financial facts require staff verification.
- [ ] **Test handoffs, corrections, and missing documents** (Testing) — Run the five cases through desk, billing, medical-review, and finance roles. Include concurrent edits, missing evidence, removed access, and interrupted uploads.
  - Completion evidence: The test record shows no lost updates or unauthorized changes, and every blocked task explains what is missing and who can resolve it.

**Stage gate:** Move on when a reviewer can reconstruct the case, locate each material fact in a source, and identify the current owner and next action.

## 5. Build approved rules and explainable estimates

Calculate a limited, provisional estimate from verified bill facts and explicitly approved rule versions.

- [ ] **Build a small rule-pack structure** (Database) — Represent one or two fictional payer/product rule packs with source clauses, hospital, supported package or procedure, effective dates, exclusions, and applicability conditions.
  - Completion evidence: Every rule has an explicit scope and source, and sample cases cannot accidentally use a rule from another hospital or date range.
- [ ] **Implement rule review and approval** (Security) — Let an authorized hospital manager review and approve a rule version before assessment. Clearly label fictional approvals used in the demo and preserve replaced versions.
  - Completion evidence: Unapproved or changed rules cannot silently affect a calculation; audit history records approver, version, date, and source.
- [ ] **Match bill lines to supported rules** (Frontend) — Allow staff to verify categories and package mappings. Detect missing eligibility facts, remaining-cover information, contract terms, and conflicting rules.
  - Completion evidence: Each line shows its verified mapping or an explicit reason for manual review; staff can correct a mapping with a recorded reason.
- [ ] **Implement deterministic financial arithmetic** (Backend) — Apply the agreed synthetic rule order and rounding with precise currency arithmetic. Save the exact bill, facts, rule versions, and calculation output used for each assessment.
  - Completion evidence: Repeating an assessment from the same snapshot gives identical line values and totals; an AI response never supplies the authoritative arithmetic.
- [ ] **Explain the estimate and its limits** (Frontend) — Show the proposed insurer share, line reasons, source clauses, unresolved items, and manual adjustments. Label the result provisional and keep it distinct from an insurer authorization.
  - Completion evidence: A reviewer can answer why a line has its amount, which inputs it used, and what remains uncertain without reconstructing a spreadsheet.
- [ ] **Challenge the calculations with edge cases** (Testing) — Test conflicting dates, missing clauses, zero and invalid values, duplicate lines, revised bills, rounding, and unsupported cases against independently written expected answers.
  - Completion evidence: Supported results match the expected-results sheet; every unsupported scenario takes the specified manual-review path with no invented approval or patient amount.

**Stage gate:** Move on when all fictional expected results match, recalculations are reproducible, and missing rules never produce a confident financial conclusion.

## 6. Resolve the insurer decision and patient amount

Compare what Smiley estimated with what the insurer actually authorized, then let hospital staff resolve the differences before billing confirms collection.

- [ ] **Capture the actual final authorization** (Database) — Record the insurer/TPA letter, authorized amount, stated deductions, conditions, date, reference, and verifier. Preserve revised responses as new events.
  - Completion evidence: The recorded decision links to the exact source and can be revised without overwriting the previous authorization or initial approval limit.
- [ ] **Build the estimate-versus-decision comparison** (Frontend) — Show line differences where the insurer provides enough detail and unresolved totals where it does not. Distinguish stated reasons, staff interpretation, and missing explanations.
  - Completion evidence: A decision without item detail stays unresolved at that level; the screen does not invent line deductions to force a match.
- [ ] **Assign and document each difference** (Backend) — Let staff investigate, request clarification externally, correct facts, record a concession, or leave an item unresolved. Keep an owner, reason, evidence, next action, and resolution history.
  - Completion evidence: The disputed-deduction case has an auditable path from difference to staff action and response, including unresolved outcomes.
- [ ] **Reconcile deposits and confirm patient collection** (Backend) — Record patient deposits and hospital concessions separately. Billing reviews the supported patient share, credits, amount still due or refund, and unresolved differences before confirming a collectible.
  - Completion evidence: Tests cover deposit below and above the confirmed share, concessions, unknown liability, and revised inputs; only authorized billing staff can confirm the current amount.
- [ ] **Produce the patient-readable explanation** (Frontend) — Create a plain-English preview that explains confirmed amounts and unresolved items using hospital-reviewed wording. Record staff review and the version shared with the patient.
  - Completion evidence: A reviewed explanation agrees with the signed-off amounts, labels uncertainty, omits unnecessary sensitive details, and is available as a controlled download.
- [ ] **Run the first end-to-end discharge demo** (Testing) — Complete the fictional clean, disputed, and missing-rule cases through multiple staff roles. Challenge stale sign-offs after changed bills or decisions, duplicate actions, unauthorized edits, and unclear explanations.
  - Completion evidence: Evidence shows that material changes require renewed review, unresolved gaps remain separate, and each confirmed patient amount can be reconstructed from its signed-off version.

**Stage gate:** Move on when no unexplained insurer shortfall becomes patient debt automatically, and a confirmed patient collectible always has billing sign-off and traceable inputs.

## 7. Match insurer payments and finance follow-up

Extend the discharge record to the money actually received later and give finance a clear follow-up queue.

- [ ] **Record remittance evidence and references** (Database) — Let finance enter or import what the insurer actually paid, including payment date, reference, amount, and supporting statement. Capture partial payments as separate events.
  - Completion evidence: A sample authorization can link to multiple payment events, each with evidence and verification history.
- [ ] **Allocate and reconcile payments** (Backend) — Match remittance amounts to cases, flag unclear allocations, and compare the recorded final authorization with total settled money. Keep unmatched balances visible for manual resolution.
  - Completion evidence: Allocated and unallocated amounts reconcile to the remittance total; a missing reference cannot cause an arbitrary case match.
- [ ] **Handle corrections without losing the trail** (Backend) — Support reversals, duplicate detection, mistaken matches, and authorized write-offs through explicit recorded actions. Preserve the original payment evidence.
  - Completion evidence: The payment balance can be rebuilt from events after a reversal or correction, and importing the same payment twice does not increase settled money.
- [ ] **Build the finance work queue** (Frontend) — Show authorized, settled, unmatched, and outstanding amounts with aging from clearly defined dates, follow-up owner, and next action. Support hospital-scoped exports.
  - Completion evidence: Finance can find and prioritize the short-settlement case, and exported totals match the same authorized view without cross-hospital data.
- [ ] **Track dispute outcomes and real recovery** (Product) — Record external follow-up and insurer responses. Separate an estimated difference, an amount disputed, an amount written off, and additional money actually received.
  - Completion evidence: A fictional dispute can end as paid, partly paid, written off, or unresolved; recovery reporting includes only linked received payment.
- [ ] **Verify the admission-to-settlement chain** (Testing) — Replay all five case packs through final authorization, patient confirmation, and later settlement. Confirm that finance corrections do not silently alter the patient explanation.
  - Completion evidence: An end-to-end test report reconciles each case's separate money records and demonstrates authorized access, replayability, and correct exception handling.

**Stage gate:** Move on when partial payments, reversals, duplicate imports, and unresolved differences reconcile correctly without changing a patient's confirmed charge automatically.

## 8. Release the synthetic product and prepare real use

Finish technical readiness, then treat permitted historical validation and identifiable patient use as separate release decisions.

- [ ] **Complete the security and privacy review** (Security) — Review access boundaries, private files, exports, audit protection, dependency findings, secret handling, support access, and sensitive data in logs. Retest the routes most likely to cross hospitals or branches.
  - Completion evidence: A release review records tested controls, findings and their resolution, plus any accepted limits; no unresolved access leak is treated as acceptable for patient use.
- [ ] **Practice operating and recovering the service** (Deployment) — Test backup restoration, rollback, worker failure, provider outage, monitoring, and incident ownership. Define retention, export, deletion, and recovery expectations for later hospital agreement.
  - Completion evidence: A recorded drill restores a consistent synthetic case and its files; runbooks name the recovery steps, responsible person, and remaining operational limits.
- [ ] **Check usability, accessibility, and realistic load** (Testing) — Exercise the main staff tasks at agreed synthetic workload and document sizes. Check keyboard use, readable status labels, error recovery, uploads, long bills, and case queues.
  - Completion evidence: A test report records workload, response times, usability findings, and fixes; task completion works without relying on color alone or expert knowledge of the code.
- [ ] **Publish staff guidance and the synthetic release record** (Product) — Explain onboarding, supported formats and rules, manual-review paths, rule approval, billing sign-off, and finance reconciliation. Bundle known limitations with the five case demonstrations.
  - Completion evidence: A fresh reviewer can run the synthetic cases from the guide; the release is explicitly labelled technically complete for synthetic use with financial and commercial claims still unvalidated.
- [ ] **Prepare permitted historical-case validation** (External) — When a hospital is available, obtain explicit scope and handling terms, an approved data route, applicable agreement versions, and named desk/billing reviewers. Use permitted de-identified historical cases first.
  - Completion evidence: Before importing real hospital case material, record hospital authorization, handling controls, reviewer names, dataset scope, and an agreed benchmark. This can remain pending after synthetic release.
- [ ] **Measure results and document disagreements** (Testing) — With the hospital reviewer, compare supported classifications, manual effort, unsupported cases, onboarding effort, and actual follow-up outcomes. Agree measures and thresholds before evaluation.
  - Completion evidence: A validation report lists the test population, excluded cases, errors, disagreements, measured results, and permitted claims. Synthetic results alone do not complete this task.
- [ ] **Approve identifiable-data production separately** (External) — Complete hospital agreements, privacy/legal and security review, provider data terms, retention/export arrangements, incident and restore readiness, and domain sign-off for the supported calculation slice.
  - Completion evidence: Named accountable people record a go/no-go decision for a defined hospital and supported scope. Real-data intake is enabled only for an explicitly approved hospital and environment, with access and upload controls enforcing that release decision.

**Stage gate:** Synthetic release requires completed technical checks. Controlled historical validation additionally needs hospital permission, an approved data path, applicable rules, and named reviewers. Identifiable production use requires its own legal, security, operational, and domain readiness review.

## Parallel validation

- [ ] **Week 1: seek an insurance-desk walkthrough** — Ask one desk worker to describe a recent cashless discharge, its handoffs, repeated questions, and current tools. Use memory or permitted fictional examples; do not request patient files into the prototype. If access is unavailable, continue the synthetic build and keep assumptions visible.
  - Evidence: A dated note records the role, actual steps described, pain points, and changes to test; otherwise record the outreach attempt and the unanswered assumptions.
- [ ] **Week 1: seek a billing walkthrough** — Ask a second desk/billing participant how final bills, insurer deductions, concessions, deposits, and patient collection are resolved. Check whether our screen flow reflects their responsibilities.
  - Evidence: A second walkthrough note identifies who confirms patient charges, common exceptions, and what evidence they need; access difficulties do not block fictional cases.
- [ ] **Week 1: seek a finance or buyer conversation** — Speak with someone who owns payment follow-up or purchase approval. Learn which problem costs them effort, how they judge value, who approves software, and what would justify a paid evaluation.
  - Evidence: A conversation note distinguishes user pain from buyer priorities, documents the buying process, and records open commercial questions without treating interest as a sale.
- [ ] **Agree a safe route for hospital case material** — When a hospital participates, agree permitted purposes, access, transfer, storage, retention, and deletion before accepting records. Confirm what de-identification is required and who authorizes the use.
  - Evidence: Written hospital authorization and a reviewed handling path exist before importing permitted historical material; identifiable live use retains its separate release gate.
- [ ] **Recruit reviewers and benchmark permitted cases** — Obtain a named desk lead and contract/billing reviewer, applicable agreement versions, and a bounded set of de-identified historical cases. Record expected interpretations before running Smiley; agree measures and review every disagreement.
  - Evidence: A reviewer-approved benchmark reports classification results, manual time, unsupported cases, setup effort, and errors with explicit exclusions.
- [ ] **Seek a defined paid pilot and learn from the decision** — Propose a limited pilot with a named buyer, supported workflow, price, duration, and agreed success measures. Use rejection or repeated need for bespoke rule work to reconsider scope before expanding payers and features.
  - Evidence: A written pilot agreement or decision note records the buyer's response and reason; potential savings and disputed amounts are not counted as proven revenue or recovery.

## Sources and limitations

- [Smiley: what to build first](https://files.instinct.com/file-01M3D0VTRRWN6RNSBZ7ZETWSV6): Latest product direction: discharge decision and money clarity first, settlement afterward, with validation beside the build. Limit: A planning brief establishes intended scope; it is not evidence of customer demand or validated contract accuracy.
- [Smiley: cashless-first product definition](https://files.instinct.com/file-01M3C3X3F0MB2EN36Y6VA0XCZ2): Earlier workflow and role context, read together with the newer direction and agreed founder decisions. Limit: Where sequencing differs, use the newer discharge-first direction; avoid silently treating earlier draft ideas as v1 requirements.
- [NRCeS ABDM/NHCX illustrative examples](https://www.nrces.in/ndhm/fhir/r4/all-examples.html): Reference the shapes of claim requests, responses, invoices, and payment reconciliation when making synthetic fixtures. Limit: Examples are non-normative and do not establish real private-hospital outcomes. Replace sample identities. NHCX integration is not required in v1.
- [Care Health policy wordings and downloads](https://www.careinsurance.com/other-downloads.html): Test clause extraction, document source links, and ambiguity detection using the selected document's actual version. Limit: Public wording does not supply a person's schedule, remaining cover, or hospital-specific tariff. It cannot make a commercial policy fully supported by itself.
- [Star Health blank pre-authorization form](https://web.starhealth.in/sites/default/files/Preauthorisation-form.pdf): Test field checklists, form recognition, and manual/OCR correction with invented values. Limit: A blank form provides neither a claim outcome nor permission to process real patient details. Verify the current form and reuse terms before adopting a fixture.
- [NHA PM-JAY HBP 2022 package master](https://nha.gov.in/img/resources/HBP2022.pdf): Use a separate synthetic test family for package codes, rates, and effective-version handling. Limit: This is a dated government-scheme reference, not a current private insurer–hospital contract. Never use its rates as default commercial rules.
