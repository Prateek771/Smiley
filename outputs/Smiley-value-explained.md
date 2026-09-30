# Smiley and the value it provides

A plain English guide to the first product

*For Prateek and the Smiley team  |  26 September 2026  |  Version 1*

**Smiley helps a hospital explain and manage the money in a cashless insurance case.** It brings the bill, supporting documents, insurer decision and staff follow-up together. The first detailed workflow starts when the final bill is ready and the team needs to understand what the insurer has approved.

This guide explains the usual journey, our part in it, and the benefits we intend to test. It follows the latest Instinct brief and the agreed version one scope. The benefits described here are product goals; we have not yet measured them in a hospital.

## What cashless means

In a cashless arrangement, the insurer pays the approved share directly to the hospital. The patient may still owe a share under their policy. The first approval and the final amount can differ, and approval is separate from the money arriving in the hospital bank account. [1]

## Who uses Smiley

We are starting with independent private hospitals of roughly 50 to 200 beds. Hospital employees use Smiley. The hospital is the proposed customer and buyer. Patients and insurer staff benefit through the hospital’s work; they do not need Smiley accounts in version one.

| Person or team | What they remain responsible for |
| --- | --- |
| Insurance desk | Coordinates documents, external requests and follow-up. |
| Billing team | Checks the bill and confirms what the patient must pay. |
| Medical team | Provides treatment records and clinical explanations. |
| Finance team | Checks insurer payments and follows up on differences. |
| Insurer or its TPA | Reviews the claim and communicates its decision. A TPA is a company that helps the insurer administer claims. |
| Patient or family | Provides required details and pays a confirmed patient share. |

## How a cashless case usually moves

The exact forms and channels vary. The sequence below is a simplified walkthrough of the insurer process, followed by Smiley’s planned help. Staff will continue to use existing insurer portals or email. [1, 2]

### 1  The patient arrives

The desk gathers identity, insurance and treatment details. **Smiley:** opens a case, records the owner and shows missing information.

### 2  The hospital asks for an initial approval

The hospital sends the proposed treatment and cost estimate. The insurer reviews the request. This initial approval is called pre authorisation. **Smiley:** records the request, response and any conditions, with their dates.

### 3  The treatment continues

Staff answer insurer questions and may request a higher approved amount if treatment costs change. **Smiley:** keeps the question, evidence, responsible person and next action together. Early stages receive basic tracking in version one.

### 4  The hospital prepares the final bill

The hospital sends the final bill and discharge documents for final review. **Smiley:** checks verified bill items against a small set of rules approved by the hospital. It produces a provisional estimate, meaning a temporary amount for staff review, and marks anything it cannot assess.

### 5  The insurer gives its final decision

The insurer communicates its authorised amount. The hospital explains the patient’s remaining payment. **Smiley:** compares the actual decision with its estimate, shows differences and records staff resolution. Billing confirms the final patient amount before an explanation is released.

### 6  The hospital checks the payment received

The hospital checks the money it receives against the approved amount. **Smiley:** records partial payments or reversals and keeps any remaining difference assigned for follow-up. This is the next detailed feature after discharge assessment.

**Where we expect the most value:** stages 4 and 5, when the team must explain a bill before discharge; then stage 6, when finance checks that the expected payment arrived.

## A fictional bill and payment example

Every amount below is invented to explain the product. It is not a real policy, contract, patient case or prediction of what an insurer should pay.

A hospital has a final bill of **Rs 1,00,000**. Using a fictional rule set, Smiley estimates **Rs 85,000** from the insurer. The insurer’s actual final authorisation is **Rs 82,000**. Staff now have two different numbers to investigate.

| Part of the bill after staff review | Amount |
| --- | --- |
| Insurer’s actual authorisation | Rs 82,000 |
| Patient share confirmed by billing | Rs 8,000 |
| Hospital reduction under the fictional agreement | Rs 7,000 |
| Difference still under investigation | Rs 3,000 |
| Total final bill | Rs 1,00,000 |

The gap between the bill and insurer authorisation is Rs 18,000. **That gap does not automatically become the patient’s debt.** In this example, Rs 7,000 is a hospital reduction and Rs 3,000 remains unresolved. Staff must record the reason and evidence for each part.

### What the patient hears

Billing confirms a total patient share of Rs 8,000. The patient has already deposited Rs 5,000, so the confirmed amount left to collect is **Rs 3,000**. The separate Rs 3,000 insurer dispute stays visible to staff and is not added to the patient amount automatically.

A staff-reviewed explanation could say: “Your confirmed share is Rs 8,000. We have already received Rs 5,000 from you. The remaining amount is Rs 3,000.” The explanation includes the approved reasons for that share.

### What finance checks later

Suppose the insurer later pays Rs 80,000. Finance now investigates **Rs 2,000 between authorisation and payment**, while the earlier Rs 3,000 decision dispute remains a separate issue. If staff later obtain another payment, Smiley records the amount actually received. A flagged difference by itself is not recovered money.

## Where the value comes from

These are intended improvements to test with hospital staff. Their size will depend on the hospital’s current tools, case volume, rule quality and how staff use Smiley.

### For the hospital

**Time:** the desk can find the latest bill, decision and pending task in one case. Billing can inspect the reason behind a calculated amount without rebuilding the assessment from scratch. This should reduce repeated searching and checking, if the inputs are usable.

**Money:** finance can spot amounts that were authorised but remain unpaid. At discharge, staff can investigate a deduction with its supporting evidence. Any money saved or recovered must be measured after resolution; finding a difference does not prove the insurer owes it.

**Frustration:** a named owner and next action make handovers clearer. Staff can see which numbers are confirmed and which still need attention. This could reduce repeated conversations about the same unresolved bill.

### For the patient and family

The hospital can explain what the patient must pay, why, and how a deposit changes the balance. Keeping an unexplained insurer shortfall out of automatic patient billing is a central product rule. Clearer explanations could reduce confusion and prevent avoidable overcollection; the patient is still responsible for valid confirmed charges.

Smiley may help shorten the hospital’s own preparation and review work. Total discharge waiting time also depends on clinical clearance, hospital processes and insurer decisions. We cannot promise a fixed reduction in waiting time.

### For the insurer or TPA

The hospital can provide more complete supporting documents and answer a question with the relevant bill item and source. That may reduce avoidable requests for clarification. The insurer continues to review the claim through its own process; version one does not replace its systems or decide coverage for it.

The first commercial test is whether hospitals value this workflow enough to use and buy it. Benefits for insurers and patients matter, but they do not establish that commercial demand by themselves.

## What the first version must get right

### Keep decisions and evidence visible

Smiley preserves the original document and the version used for an assessment. It shows which bill item and approved rule support a result. The hospital approves how its rules are interpreted. Staff verify important extracted facts before they affect money.

A computer can help read a document, but uncertain or conflicting information goes to a person. Smiley must be able to say “needs review.” An unsupported case can still be tracked even when the product cannot calculate an amount.

### Give each person the right control

The insurer’s actual decision remains separate from Smiley’s estimate. Billing signs off the patient amount. Finance checks payments. Each hospital’s data stays separate from other hospitals, and staff receive access appropriate to their role and branch. Important reads, changes and approvals are recorded.

### Make the first release manageable

Version one includes a case timeline, documents, verified bill lines, approved rules, provisional estimates, insurer decisions, staff resolution, patient explanations and later payment checks. It starts with a small supported set of rules and bill formats.

Staff submit through existing insurer channels. Patient and insurer accounts, direct submissions, reimbursement claims and automatic patient billing are outside this release. Adding every insurer’s rules is a later decision that needs evidence from real use.

### Build and learn at the same time

We will first build with synthetic cases, meaning made-up examples, and suitable public material. In parallel, the plan seeks two insurance desk or billing walkthroughs and one finance or buyer conversation in the first week. These conversations can test our assumptions without bringing patient files into the prototype.

Public forms and sample data can test document handling and calculations we design. They cannot establish a private hospital’s actual agreement or prove the product’s financial accuracy. Permitted historical cases and hospital reviewers are needed for that later test.

**What we will measure:** staff time on the same cases, agreement with hospital reviewers, cases requiring manual review, clarity of patient explanations and actual outcomes of payment follow-up. Technical completion with synthetic data is a separate milestone from approval for real patient records.

## Useful words in everyday English

| Word | Meaning in this guide |
| --- | --- |
| Claim | A request for the insurer to pay costs covered by a policy. |
| Cashless | The insurer pays the approved share directly to the hospital. |
| TPA | A company that helps an insurer administer claims. |
| Pre authorisation | The insurer’s initial response to a hospital’s treatment and cost request. |
| Enhancement | A request to raise an earlier approved amount as costs change. |
| Final authorisation | The insurer’s approved amount after the discharge claim is reviewed. |
| Package or tariff | An agreed price for a treatment bundle or an individual service. |
| Co pay | A patient share required by the policy, often expressed as a percentage. |
| Deduction | An amount the insurer has reduced or excluded, with a reason to review. |
| Remittance or settlement | The actual payment received from the insurer. |
| Reconciliation | Comparing expected money with recorded payments and explaining differences. |

## Sources and how to read this guide

The process description uses insurer guidance as an example. Hospitals and policies can differ. Smiley’s planned features and boundaries come from the product brief and our agreed build plan. Descriptions of current pain are assumptions to check in hospital conversations, not findings from completed hospital research.

1. [Star Health claims process](https://www.starhealth.in/claims/). Official process reference, accessed 26 September 2026.

2. [Care Health cashless claims process](https://www.careinsurance.com/health-insurance-claim-center.html). Official process reference, accessed 26 September 2026.

3. [Smiley what to build first](https://files.instinct.com/file-01M3D0VTRRWN6RNSBZ7ZETWSV6). Latest product direction supplied by Prateek.

4. Smiley v1 build plan. Working scope dated 26 September 2026. This guide explains its value and does not replace the detailed build roadmap.
