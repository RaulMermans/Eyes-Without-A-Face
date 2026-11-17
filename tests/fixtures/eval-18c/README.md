# Independent evaluation set (Sprint 18C)

## Authorship statement

An independent evaluation author wrote this set. The author had no access to the implementation: they did not read `src/`, `scripts/`, `docs/`, any other test or fixture directory, any earlier holdout or git history, and they saw no prompts. The only files they read were `tests/fixtures/eval-18b/README.md` and the four `tests/fixtures/eval-18b/dev/*.json` files, used only as a format reference. They did not run the project's tests or tools.

Ground truth, including every `expectedSamples` output, records what the author meant each field to mean. It was not derived from the behaviour of any tool, prompt or model. The records were produced by a small deterministic author script from hand-written field definitions; the expected outputs apply the author's own ground truth to the chosen records and were checked by a second, independent author script.

All records, people, companies and email addresses are fictional. Every email address is on `example.com`, `example.org` or `example.net`, or on a subdomain of one of them.

## Splits

| Split | Scenarios | Completable | Purpose |
| --- | --- | --- | --- |
| `dev/` | 4 | 3 | Engineers may read these and tune against them. |
| `holdout/` | 16 | 12 | Engineers never open these. They are scored only by a script that prints aggregate metrics, never per-field contents. |

Both splits follow the same authoring rules and come from the same distribution. No industry repeats across the 20 scenarios.

## Scenario file format (`<scenarioId>.json`)

The keys are those of `tests/fixtures/eval-18b/README.md`: `scenarioId`, `split`, `industry`, `sourceLanguage`, `description`, `fictional`, `completable`, `records`, `destination`, `groundTruth`, `confusablePairs`, `sourceConcepts`, `destinationConcepts`. `groundTruth` entries use the same keys (`source`, `sources`, `transform`, `dateFormat`, `separator`, `categoryMap`, `why`) and the same transform semantics. Every destination field carries a `description` that states its business meaning.

Additions:

| Key | Meaning |
| --- | --- |
| `expectedSamples` | Completable scenarios only. Exactly 4 objects `{ "recordIndex": n, "outcome": "transformed" \| "held", "output"?: {...} }`. `output` is present only when transformed and is the destination object exactly as a correct integration must produce it. |
| `groundTruth[dest].unsupportedReason` | Optional, only on `transform: "none"`. Says that the field could only be filled by a transformation outside the supported list (for example a difference between two dates, a product of two numbers, an age). The field still has no source. |

Output semantics for `expectedSamples`:

- `copy`: value as is. `trim`: leading and trailing whitespace removed. `normalize_email`: trimmed and lower-cased. `parse_date`: `YYYY-MM-DD` (an `ISO-8601` source keeps its date part). `concat`: the source strings joined by `separator`, exactly as they are (concat sources never contain stray whitespace and are never null). `map_enum`: the `categoryMap` value.
- An optional destination field whose source value is `null` or missing is absent from the output (not `null`, not `""`). Fields with `transform: "none"` are absent.
- A nested destination object is present whenever one of its fields is present.
- `held`: the record must not be transformed, because it carries a category label that maps to `null` (on any enum field, required or optional), or because a required destination field's source is `null` or missing.

## Authoring rules (all hold for every file)

All authoring rules of `tests/fixtures/eval-18b/README.md` hold: key pattern and length, at most 20 source leaf fields, at most 10 distinct values per category field, shuffled field order, at least 3 confusable pairs, at least 2 unused source fields, at least two destination enum fields fed by category fields (at least one required), labels mostly different from enum values, at least one label mapping to `null`, at least one optional destination field with no valid source, at least one slash-format date target, the ambiguous-date rule, nested objects (some with 3-segment paths) and flat files, `null` and missing optional values, padded whitespace, mixed-case emails, no arrays, 20 to 40 records, 6 to 12 destination leaf fields with at most one nested level.

Additional rules for this set:

- Category labels are realistic (capitals, spaces, accents, codes) and in the source language. Each label occurs at least twice in its field.
- Every scenario has at least two category fields that compete for the destination enum fields (for example lifecycle state vs payment state, product vs billing cycle). They are listed in `confusablePairs` with kind `competing-category-fields`.
- Many scenarios contain a field of repeated person names (staff, coordinator, instructor, inspector) that must not feed any target.
- Every completable scenario has an optional destination field whose valid source is `null` in some records and missing in others.
- Some completable scenarios have a required destination field whose source is `null` in a few records; those records are held.
- Some scenarios have an optional destination field that needs an unsupported transformation (`unsupportedReason`). In at least one not-completable scenario the missing required field is one that would need an unsupported transformation.
- Not-completable scenarios are realistic: the source simply lacks the information, and it contains a plausible-looking but wrong decoy field (kind `decoy-for-missing-field`).
- Many scenarios contain two identifier-like fields (for example a business number and an export row counter) where only one is correct for the destination identifier.
- Excluded industries: retail e-commerce, clinic appointments, hotel bookings, parcel shipments, payroll, B2B SaaS invoices, CRM contacts/helpdesk, music schools, gyms/fitness, public libraries.

## Per-split counts

| | dev | holdout |
| --- | --- | --- |
| Scenarios | 4 | 16 |
| `completable: true` | 3 | 12 |
| `completable: false` | 1 | 4 |
| Scenarios with ambiguous slash dates | 2 | 8 |
| Scenarios with a `concat` target | 1 | 5 |
| Scenarios with an unused repeated person-name field | 4 | 11 |
| Completable scenarios with a required field that is `null` in some records | 1 | 3 |
| Scenarios with an `unsupportedReason` | 2 | 7 |
| Scenarios with two competing identifier fields | 4 | 16 |
| Fully flat scenarios | 1 | 3 |
| Scenarios with 3-segment source paths | 2 | 6 |
| Source languages | de, en, fr, nl | de, en, es, fr, it, mixed, nl, pt |

## Dev scenarios

- `vineyard-wholesale-orders-to-distributor-portal`: wine estate wholesale orders into a distributor order portal; order vs payment status, buyer contact name built by `concat` (fr)
- `driving-school-students-to-exam-booking`: flat driving-school student export into a licence-exam booking system; training stage vs payment status, birth date missing in some rows (de)
- `coworking-desk-bookings-to-access-scheduler`: coworking desk bookings into a door-access scheduler; plan tier vs billing cycle, booking length needs an unsupported computation (en)
- `vet-vaccination-reminders-to-sms-gateway`: veterinary vaccination recalls into an SMS reminder gateway; not completable, because the owner's mobile number is not exported (nl)

Holdout scenario names and contents are intentionally not listed here.
