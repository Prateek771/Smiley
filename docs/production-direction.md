# Production Product Direction

Updated: 3 October 2026, following the owner's instruction after Phase 19.

## Product and test data

Smiley is a hospital claims and cashless-discharge product for working staff. Synthetic patients, hospitals, policies and documents are development/test inputs. They must not define which records the product accepts, which staff workflows exist, or how the staff workspace is described.

The same application code must handle ordinary hospital/branch names, invited staff, patient registration, encounters, policies, document revisions, payer references and supported calculation inputs. Test scenarios exercise that code using manufactured records; no patient information is required to develop or verify it. `/demo` remains a clearly labelled training demonstration. Existing test records retain their honest names and provenance.

Phases 0–19 are completed engineering checkpoints tested with synthetic records. Their historical evidence remains unchanged. This direction supersedes their demo-oriented product language; it does not retrospectively establish hospital validation or operational readiness.

## What a hospital staff member sees

1. **Sign in:** Their invited account opens their hospital and permitted branches, with actions determined by their current role. Platform administration is separate.
2. **Prepare a case:** Register the patient and encounter, select the applicable insurer/TPA and policy, attach documents, assign ownership and see the next action.
3. **Coordinate treatment and authorization:** Record eligibility, preauthorization, actual responses, treatment, enhancements and queries with dated evidence. Prepared requests remain distinct from payer acknowledgements.
4. **Prepare discharge:** Billing verifies the final bill and applicable policy/rule revision; Desk resolves missing evidence, prepares the pack and records actual external submissions and queries.
5. **Complete the financial handoff:** Record the actual payer decision; Billing confirms the patient amount. Unexplained deductions remain disputes. Finance reconciles evidenced receipts, refunds and settlement separately.
6. **Manage operations:** Hospital administrators maintain branches, invitations, access and reviewed rules. Staff see role-scoped work/reporting views; exports and timers reconcile with underlying evidence.

Reception/clinical contributors provide permitted patient, encounter and document information; they do not acquire Billing, Finance or platform authority through the product direction change. Production role mappings and operating procedures require hospital review.

## Rules and evidence

New assessments default to `CASHLESS-DISCHARGE-1`. The historical `SYN-DISCHARGE-1` identifier remains supported to reproduce saved test assessments. Version support is explicit; an arbitrary new identifier does not grant coverage.

The current engine supports the existing exact-paise deductible, co-pay, benefit-limit and per-bill-line tariff-cap model. It is not a comprehensive interpreter of hospital contracts or insurance policies. Before use for a hospital, validate the calculation order, exclusions, benefit scope, dates and line mapping against applicable documents. Unsupported conditions must request review. Prefer approved registry revisions; manually reviewed snapshots remain separately identified.

## Cloud processing boundary

The current OCR.space/OpenRouter connector is restricted to test documents by application and database checks. That is a connector limitation, not the intended scope of the hospital product. Manual document evidence and staff workflows remain available independently of cloud AI.

Phase 21 must replace the test-only request contract and database constraint with explicit data classification and hospital-scoped external-processing permission. The worker must recheck permission and source versions before every external call and publication. Clinical processing stays unavailable until provider handling, permitted destinations, retention and operating responsibilities are agreed. No real documents are transmitted by this direction checkpoint.

Retain the owner's selected Qwen model without substitution. Provider page/size limits must be visible and handled without silent truncation; longer documents need a reviewed processing design or manual handling. AI assists extraction and drafting; it does not authorize treatment, payer approval, patient liability or payment.

## Revised release path

- **20 — Production application foundation:** Separate sample/training configuration from staff workflows; provide seed-free hospital/first-admin setup, insurer/TPA/policy configuration and source-backed rule setup. Test normal identifiers, clean installations and unsupported policies.
- **21 — Data handling and security:** Implement hospital-scoped AI processing permissions/classification; complete private document lifecycle, secure deployment authentication, audit/access review and credential recovery. Test denials, revocation during jobs and provider outages using synthetic documents.
- **22 — Deployment and operations:** Choose hosting/private storage, deploy separate web/worker/database environments, prove backup/restore, monitoring and multi-process recovery. Test deployment and failures with synthetic fixtures.
- **23 — Hospital acceptance and controlled release:** Walk actual staff roles through the complete workflow, validate permitted historical examples against independently reviewed outcomes, then run an approved limited pilot. Record exclusions, corrections and operating ownership before expansion.

Each phase is delivered in small build/test checkpoints recorded in `BUILD_PLAN.md`. Engineering tests use synthetic fixtures throughout. Hosting, approved hospital rules and permitted real-document handling are owner/hospital decisions when their phase needs them.
