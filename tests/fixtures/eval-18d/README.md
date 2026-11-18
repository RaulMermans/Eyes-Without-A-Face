# Independent evaluation set (Sprint 18D)

## Authorship statement

An independent evaluation author wrote this set. The author had no access to the implementation: they did not read `src/`, `scripts/`, `docs/`, any other test or fixture directory, any earlier holdout or git history, and they saw no prompts. The only files they read were `tests/fixtures/eval-18b/README.md`, `tests/fixtures/eval-18c/README.md` and the four `tests/fixtures/eval-18c/dev/*.json` files, used only as a format reference. They did not run the project's tests or tools.

Ground truth, including every `expectedSamples` output, records what the author meant each field to mean. It was not derived from the behaviour of any tool, prompt or model. The records were produced by a deterministic author script from hand-written field definitions (`author/specs_*.py`, `author/lib.py`, run with `python3 author/build.py`). The expected outputs apply the author's own ground truth to the chosen records and were checked by a second, independent author script (`author/check.mjs`, plain Node), which re-implements the output semantics and the authoring rules. Both scripts agree on all 80 samples.

All records, people, companies and email addresses are fictional. Every email address is on `example.com`, `example.org` or `example.net`, or on a subdomain of one of them.

## Splits

| Split | Scenarios | Completable | Purpose |
| --- | --- | --- | --- |
| `dev/` | 6 | 5 | Engineers may read these and tune against them. |
| `holdout/` | 20 | 15 | Engineers never open these. They are scored only by a script that prints aggregate metrics, never per-field contents. |

Both splits follow the same authoring rules and come from the same distribution. No source system, company or industry repeats across the 26 scenarios.

## Tracks

| Track | Meaning |
| --- | --- |
| `wedge` | The supported product wedge: a CRM or customer-account export from a small or medium business (contacts, accounts, subscribers, members, tenants, corporate accounts) loaded into a helpdesk-compatible schema (requester, end user, customer, contact or organization import). Destination schemas differ in field names, nesting, required fields and enum lists, as different helpdesk tools would. Source naming conventions vary strongly: snake_case, camelCase, PascalCase, ALL CAPS, abbreviations, vendor prefixes (`fld_`, `c_`), seven source languages and one mixed-language export. |
| `general` | Generalization: unfamiliar domains that are neither CRM nor helpdesk (for example agriculture, event ticketing, field service, education administration, laboratory samples, fleet maintenance, municipal permits, sports clubs). |

Typical wedge confusions: account status vs payment, subscription or marketing-consent status; customer id vs CRM record id, contract id, row counter or legacy id; company name vs contact person vs account owner; primary vs billing or secondary email; customer-since date vs last activity, renewal or contract end date; plan or tier vs segment or industry.

## Scenario file format (`<scenarioId>.json`)

The keys are those of `tests/fixtures/eval-18c/README.md`: `scenarioId`, `split`, `industry`, `sourceLanguage`, `description`, `fictional`, `completable`, `records`, `destination`, `groundTruth`, `confusablePairs`, `sourceConcepts`, `destinationConcepts`, `expectedSamples`. `groundTruth` entries use the same keys (`source`, `sources`, `transform`, `dateFormat`, `separator`, `categoryMap`, `why`, `unsupportedReason`) with the same transform and output semantics. `expectedSamples` has exactly 4 entries per completable scenario, with the 18C meaning.

Additions:

| Key | Meaning |
| --- | --- |
| `track` | **New.** `"wedge"` or `"general"` (see above). |
| `destination.properties[*].description` | Descriptions now vary in quality, as in real API documentation. Most fields have a one-sentence description of their business meaning (under 160 characters). In every scenario 1 or 2 fields have a vague or generic description of at most three words (such as "Status." or "Date."), and 0 to 2 fields have no description at all. Descriptions never contain source values, emails, phone numbers, URLs, ids or instructions. |

## Authoring rules (all hold for every file)

All authoring rules of `tests/fixtures/eval-18b/README.md` and `tests/fixtures/eval-18c/README.md` hold, with the 18C industry exclusions replaced as follows: the `general` track excludes retail e-commerce, clinic appointments, hotel bookings, parcel shipments, payroll, B2B SaaS invoices, music schools, gyms/fitness, public libraries, wine wholesale, driving schools, coworking and veterinary reminders, and contains no CRM or helpdesk scenario.

In particular, for every scenario: 20 to 40 records, at most 20 source leaf fields, 6 to 12 destination leaf fields with at most one nested level, at least 3 confusable pairs, at least 2 unused source fields, at least two destination enum fields fed by category fields (at least one required), realistic category labels in the source language with each label used at least twice, at least one label mapping to `null`, at least one optional destination field without a valid source, at least one slash-format date target, and the ambiguous-date rule. Every completable scenario has an optional destination field whose valid source is `null` in some records and missing in others. Not-completable scenarios lack the information for a required field and contain a plausible decoy (kind `decoy-for-missing-field`).

## Per-split counts

| | dev | holdout |
| --- | --- | --- |
| Scenarios | 6 | 20 |
| `completable: true` | 5 | 15 |
| `completable: false` | 1 | 5 |
| `track: wedge` (completable / not) | 4 (3 / 1) | 12 (9 / 3) |
| `track: general` (completable / not) | 2 (2 / 0) | 8 (6 / 2) |
| Scenarios with ambiguous slash dates | 2 | 9 |
| Scenarios with a `concat` target | 2 | 5 |
| Scenarios with an unused repeated person-name field | 6 | 20 |
| Completable scenarios with a required field that is `null` in some records | 1 | 1 |
| Scenarios with an `unsupportedReason` | 3 | 8 |
| Scenarios with two competing identifier fields | 6 | 20 |
| Fully flat scenarios | 3 | 6 |
| Scenarios with 3-segment source paths | 1 | 3 |
| Source languages | de, en, es, fr, it, nl | de, en, es, fr, it, mixed, nl, pt |
| Destination fields with a vague description | 6 | 24 |
| Destination fields with no description | 3 | 19 |
| `expectedSamples` checked by both scripts | 20 | 60 |

Wedge source languages across both splits: de, en, es, fr, it, nl, pt and mixed (English and German field names).

## Dev scenarios

- `solar-installer-customers-to-helpdesk-contacts`, `fibre-telecom-subscribers-to-support-requesters`, `insurance-brokerage-clients-to-service-desk-users`, `property-management-tenants-to-helpdesk-customers` (wedge; en, de, es, nl; the last is not completable) · `orchard-harvest-lots-to-cold-storage-intake`, `trail-race-entries-to-timing-system` (general; it, fr)

Holdout scenario names and contents are intentionally not listed here.

## Regenerating and checking

```sh
cd tests/fixtures/eval-18d/author
python3 build.py   # deterministic: rewrites dev/ and holdout/ from the specs
node check.mjs     # independent check of rules and every expectedSamples entry
```
