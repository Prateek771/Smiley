# Cashless Discharge Workflow — Phase 2

Date: 1 October 2026. Scope: a synthetic acceptance specification for the first hospital workflow. All amounts, people, policy rules, references, and timestamps in the linked packs are invented. This defines what we will build; it does not claim that the workflow is implemented or validated by a hospital.

## Intended result

Insurance Desk prepares a discharge claim and handles repeated payer queries. Billing confirms the patient's amount with evidence. Finance tracks actual receipts separately. Every open issue has an owner and next action. Clinical discharge clearance remains the hospital's responsibility.

Start with a final bill ready for discharge review and already-linked patient, encounter, hospital, branch, policy, and payer. Earlier admission/preauthorization details are supplied as context. Staff continue submitting through their existing external channels. Patient/insurer accounts and direct payer integrations remain outside this slice.

## Workflow and human sign-offs

| Step | Owner and required action | Evidence and result |
| --- | --- | --- |
| 1. Open preparation | Billing marks a specific final bill ready; Desk checks linked records, owner, and due time. | First bill-ready event starts the resolution clock. Missing information stays visible. |
| 2. Verify facts | Desk checks identity/policy/document facts; Billing checks bill lines and financial inputs. Desk obtains clinical answers from medical staff when needed. | Original document revision/page, corrected fact, reviewer, and time. Manual verification works when extraction is unavailable. |
| 3. Assess | Apply a supported, versioned deterministic rule set to verified inputs. Billing reviews exceptions and authorized hospital reductions. | Provisional insurer/patient estimate with line-level reasons; unsupported or conflicting inputs return **needs review**, with amounts unknown. |
| 4. Prepare and submit | Desk approves the frozen pack, then submits externally and records its acknowledgement. | Pack revision and actual acknowledgement/reference. A local upload attempt alone is not payer receipt. |
| 5. Answer queries | Desk owns each separately identified query, assembles sources, obtains clinical/Billing review as needed, approves the response, and records external acknowledgement. | Preserve every query/response cycle. A duplicate reference cannot create duplicate work. A draft or first response does not imply final approval. |
| 6. Record decision | Desk verifies the payer's actual decision, case, bill revision, conditions, reference, and effective time. | Final authorization is distinct from preauthorization, enhancements, and the application's estimate. Keep superseded decisions. Ambiguous or old-bill decisions require review. |
| 7. Confirm patient amount | Billing signs off a versioned allocation, reasons, deposit receipts, and amount to collect/refund. | Patient share, approved hospital reduction, and unresolved deduction remain separate. Release a patient explanation only under a current sign-off. |
| 8. Reconcile payment | Finance verifies bank/remittance evidence, allocates receipts, and records short payments, refunds, reversals, and follow-up. | Actual money received is separate from authorization. Full payment of the authorized amount does not close an unresolved decision dispute. |

Clinical explanations come through the existing hospital process; this phase does not invent a new authenticated medical role. Billing approves the amount to refund; Finance records its authorized execution and receipt evidence.

## Amounts and version rules

Store money as integer **paise**, not floating-point rupees. A document or decision belongs to one hospital/branch/case. The financial snapshot references its bill, policy, rule, decision, deposit, and sign-off revisions.

For fictional rule version `SYN-DISCHARGE-1`, use this explicit order:

1. Eligible base = gross bill − patient-excluded lines − approved hospital reduction. These deductions do not overlap.
2. Deductible = the smaller of the eligible base and the fictional deductible.
3. Co-pay = the remaining eligible base × the stated basis-point rate; round half up to one paise.
4. Estimated insurer share = the smaller of the amount after deductible/co-pay and the stated payer benefit limit.
5. Estimated patient share = excluded lines + deductible + co-pay + benefit-limit excess. In this invented rule set, limit excess is explicitly patient-borne. This is not a general insurance rule.
6. After actual authorization, Billing separately confirms the patient amount and hospital reduction: **gross bill = actual authorization + confirmed patient share + hospital reduction + unresolved decision amount**. A negative/unexplained allocation goes to review; never silently balance it by increasing patient debt.

Before a current Billing sign-off, confirmed patient share and collection/refund figures are unknown, even if a provisional estimate exists. After sign-off: collect = max(patient share − net verified patient payments, 0); refund owed = max(net patient payments − patient share, 0). A refund owed is not a refund already executed.

Finance separately calculates authorized receivable = actual authorization − net matched payer receipts. Duplicate transaction imports have no second effect; reversals subtract from receipts. Overpayments become a Finance review/credit balance. Never add a payer short payment or disputed deduction to patient liability automatically.

## Review blocks and separate work states

Missing mandatory evidence, cross-hospital documents, conflicting identifiers/versions, unsupported rules, ambiguous payer conditions, and stale sign-offs block the affected action. Show unknown as **needs review**, not ₹0. Existing verified evidence may still be tracked. Staff can manually verify sources; AI availability is never a prerequisite for case handling.

Track discharge preparation/Billing confirmation, payer queries or decision disputes, and settlement independently. Billing can confirm an evidenced patient share while an explicitly allocated payer dispute remains open. Whole-case closure requires no unresolved disputes, queries, allocation issues, patient/refund balance, or authorized receivable.

Changed bills/policies/rules/decisions invalidate affected assessments, packs, drafts, and sign-offs. Preserve history and original start times. Use version checks to reject stale concurrent updates. Receipts arriving early may be retained as unmatched evidence; they must not invent an authorization or close a case.

## Timing to measure

Each event records occurrence time, recording time, actor, reference/evidence, and relevant versions. Store timezone-aware timestamps; display IST. Missing/out-of-order evidence yields a flagged or unknown duration. Elapsed minutes do not imply active staff working minutes.

| Measure | Start → end |
| --- | --- |
| Preparation elapsed | First final-bill-ready → first approved pack-ready |
| Submission delay | Approved pack-ready → evidenced external acknowledgement |
| Payer wait, each cycle | Acknowledged submission/response → next actual payer query/decision |
| Query response, each cycle | Query received → acknowledged external response |
| Billing review elapsed | Usable final decision received → current valid patient-amount sign-off |
| Main desk-resolution elapsed | First final-bill-ready → current valid patient-amount sign-off |
| Settlement elapsed | Actual final authorization received → fully reconciled authorized receipts; otherwise show open age |

The 1–2 hour ambition belongs to main desk-resolution elapsed. It includes missing-evidence delays and repeated queries; do not pause/reset it to improve results. Revisions invalidate affected end events, and rework is reported separately. Count open, rejected, and review-blocked cases in reporting denominators. This is a measurement proposal, not a payer SLA or proven hospital result.

## Five fictional acceptance packs

The [JSON packs](../../fixtures/phase-2-cashless-discharge.json) contain structured source-document snapshots, bill lines, policy parameters, events, checkpoints, expected amounts, staff actions, and failure variants. These are input contracts for future tests; they do not exercise PDF/OCR formats yet. Documents, events, queries, and total timing expectations describe the whole walkthrough: each checkpoint has an `asOfEventId`, available-document allowlist, authoritative bill/fact snapshot, and current query states. Derive visible events, authorization, acknowledgements, and current timers only up to that checkpoint; future summaries, decisions, and response acknowledgements must not appear in earlier views. Payment/reduction evidence is conditional on a non-zero amount; these five packs have both. Zero matched receipts means no receipts recorded in this case; external bank activity is not inferred. All figures below are rupees.

| Pack | Final bill | Estimate / actual authorization | Confirmed patient / hospital / unresolved | Expected action |
| --- | ---: | ---: | --- | --- |
| P2-01 clean approval | 1,00,000 | 85,000 / 85,000 | 8,000 / 7,000 / 0 | Billing collects 3,000 after a 5,000 deposit; Finance awaits actual payment. |
| P2-02 missing/conflicting evidence | 1,10,000 corrected | Unknown while blocked; then 90,000 / 90,000 | Unknown while blocked; then 13,000 / 7,000 / 0 | Desk resolves missing summary and policy/bill conflicts; Billing confirms 7,000 refund owed after a 20,000 deposit; Finance executes through the approved process. |
| P2-03 repeated queries | 1,20,000 revised | 90,000 / 90,000 | 25,000 / 5,000 / 0 | Preserve both query cycles and the superseded 1,15,000 bill; Billing collects 15,000 after a 10,000 deposit. |
| P2-04 disputed deduction | 1,00,000 | 85,000 / 82,000 | 8,000 / 7,000 / 3,000 | Billing collects only 3,000 after the deposit; Desk owns the separate 3,000 payer dispute. |
| P2-05 partial settlement | 1,00,000 | 85,000 / 82,000 | 8,000 / 7,000 / 3,000 | Finance follows up 2,000 after an 80,000 receipt; the decision dispute remains separately open. |

Acceptance includes blocked unknown values, deposit overpayment/refund, bill revision, two separately acknowledged queries, duplicate events/receipts, full authorized receipt with a still-open dispute, and a later receipt reversal. Additional named failure variants cover rejection, unsupported rules, old/conditional authorization, wrong-hospital evidence, stale updates, and receipts before approval. Their application behavior is to be tested as each later capability is built.

## Where LangGraph enters

Next.js/TypeScript serves the screens and application API. PostgreSQL/Drizzle stores cases and evidence; Better Auth handles identity with separate hospital/branch/role authorization. Graphile Worker runs durable background jobs in a separate persistent Node.js process.

LangGraph TypeScript runs in that worker when Phase 16 introduces document extraction and Phase 17 adds evidence checks/response drafts: source ingestion → extraction → human fact review → supported rule assessment → draft/check → human approval. Workers persist run/input versions and return review tasks. Deterministic calculation remains a separate module; model output cannot set final authorization, approve patient billing, or send responses. Provider failure has a manual path. No AI/database dependencies are required to define these synthetic packs.

## Assumptions and next phase

The role boundaries, first-bill-ready timer, rule order, required document list, and reduction/refund authority are explicit synthetic-development assumptions. Real hospital tariff/policy interpretation, clinical/document requirements, pilot access, and operating approvals need named hospital reviewers at the later validation gates. Synthetic arithmetic does not establish real claim accuracy.

Phase 2 is complete when all five packs have source inputs, expected results, owners/next actions, an independent arithmetic/timing check, and a recorded checkpoint. [Validation evidence](../../evidence/phase-2-validation.md) records those checks. The living [build tracker](../../../BUILD_PLAN.md) controls progress.

Phase 3 will build a fictional work queue and case-detail journey using these pack IDs: open queue → select case → inspect owner/action, evidence, and separate money facts → return with context preserved. Desktop/mobile, loading/empty/error states, and repeatable Playwright checks are part of that phase. Database persistence, login, calculations, and agents follow their existing phases.
