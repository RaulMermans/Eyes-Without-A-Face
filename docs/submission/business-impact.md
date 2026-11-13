# Business impact — what an integration error costs, and what EYES catches

**Audience: judges and non-specialists.** One concrete, fictional CRM-to-helpdesk migration, with numbers from real runs of the deployed application only. No customer incidents and no savings figures are claimed: we have not measured any.

## The job

A support team is moving from a European CRM to a new helpdesk. Every customer account must become a helpdesk record with an id, an email, a lifecycle status, the date the account was created and the organization name. Getting this wrong does not crash anything. It quietly puts wrong data in front of support agents.

The CRM holds personal data (names, emails, internal notes), so it may not be pasted into a cloud AI. That is why teams either write the mapping by hand or take a privacy risk to let an AI write it.

## The failure we demonstrate (real, from the hosted app)

Source field `angelegt_am` ("created on") holds dates like `03/02/2026`. In this German CRM that means **3 February 2026**. Every date in the imported sample has day and month ≤ 12, so nothing in the sample proves which comes first.

| Step | What happened | Source |
| --- | --- | --- |
| Intended meaning | `03/02/2026` = 3 February 2026 → `createdAt: 2026-02-03` | Scenario owner's declaration |
| Initial Gemini mapping | `parse_date … inputFormat: "MM/DD/YYYY"` | Real Gemini output · `IN_CLOUD`, hosted run 2026-11-13 ([screenshot 06](../demo/screenshots/sprint-12-hosted/06-blind-revision-result.png)) |
| Why it is wrong | The engine writes `2026-03-02` for this record: **schema-valid, wrong by a month**. A day > 12 (`25/03/2026`) is refused as `INVALID_DATE` | Deterministic engine, same mapping |
| Detected | Locally: the Reality Check runs hidden cases the model never saw, and the semantic verifier proves the day-first order from local evidence → `SEMANTIC_MISMATCH` | Hosted run; runtime stage 11 *failed* |
| Corrected | The user approves one blind revision request: the finding and the constraint, **no records, no values**. Gemini returns `inputFormat: "DD/MM/YYYY"` | Hosted run, revision `ACCEPTED` |
| Verified | Before → after on imported + revision-feedback records: **transformed 0 → 7**, handled by approved rule 0 → 1, unresolved 1 → 0, **no regressions**; 1 record with an unusable email stays quarantined for manual review and is **not** counted as transformed | Hosted run, [screenshot 06](../demo/screenshots/sprint-12-hosted/06-blind-revision-result.png), [07](../demo/screenshots/sprint-12-hosted/07-outcome-verdict.png) |
| Delivered | Export `VERIFIED_WITH_EXCEPTIONS`; `node run.mjs verify` exit 0 outside the app | [hosted-acceptance.json](../evidence/sprint-12/hosted-acceptance.json) |

### What that error means in a support workflow

- **Valid-looking wrong dates.** Every account created on days 1–12 of a month gets day and month swapped. Customer tenure, renewal reminders, SLA eligibility ("customer for more than a year") and audit trails are then wrong, and nothing flags it, because the date is a perfectly valid date.
- **Silently missing records.** Accounts created on days 13–31 cannot be parsed month-first. In a naive pipeline they fail or are dropped; here they are refused and counted.
- **Schema checks do not help.** Every wrong output passes the destination JSON Schema. Only a check of *meaning* finds it.

The same class of error appeared in the support-ticket scenario in earlier real runs: a priority scale was inverted, so an urgent ticket would have been filed as low priority (Sprint 7–8 evidence). The local verifier flagged every such output in the Sprint 8 benchmark (CRM 20 / 20, support 36 / 36, 0 false alarms).

## What the user gets instead of a chat answer

| Property | What it means here |
| --- | --- |
| Inspectable | A declarative mapping of 5 operations from an 8-operation allowlist; each operation is shown and diffed before/after |
| Executable | A ZIP that runs with plain Node 22: `node run.mjs verify`, then `run` with local bindings |
| Locally verifiable | Structure, meaning and record outcomes are judged by deterministic code in the browser, against hidden cases the model never saw |
| Reproducible | The exported runtime is the app's own engine, hash-pinned; the same state gives a byte-identical archive |
| Governed | Two cloud requests in the whole run, each approved by the user on the exact prompt hash; nothing is sent before approval |

It is not a production SaaS connector: nothing is deployed, scheduled or connected by the export. The user runs it with their own bindings.

## What we can and cannot claim

- **Can:** the failure is real model behavior; the detection, the approved correction and the verified export happened in the deployed application with real Gemini Nano and real Gemini Cloud, twice on 2026-11-13 (2 / 2 hosted runs `ACCEPTED`).
- **Cannot:** time or money saved, adoption, or that independent developers complete this flow. No independent usability session has been run yet ([../usability/README.md](../usability/README.md)).
- **Honest limit:** a blind revision does not always succeed. In Sprint 9, 3 of 5 live runs ended `ACCEPTED`; one ended `HUMAN_REVIEW_REQUIRED` (exported only as a draft) and one initial proposal was invalid and rejected unrepaired.
