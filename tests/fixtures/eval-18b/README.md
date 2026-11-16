# Independent evaluation set (Sprint 18B)

## Authorship statement

An independent evaluation author wrote this set for Sprint 18B. The author had no access to the implementation: they did not read `src/`, `tests/` (except the 18A fixture README and the 18A `dev/` files, used only as a format reference), `scripts/`, `docs/decisions/`, `docs/evaluation/`, `docs/evidence/` or any earlier holdout. The set was written before any Sprint 18B model run.

Ground truth records what the author meant each field to mean. It was not derived from the behaviour of any tool, prompt or model.

All records, people, companies and email addresses are fictional. Every email address is on `example.com`, `example.org` or `example.net`, or on a subdomain of one of them.

## Splits

| Split | Scenarios | Completable | Purpose |
| --- | --- | --- | --- |
| `dev/` | 4 | 3 | Engineers may read these and tune against them. Includes the required "CRM contacts export → helpdesk requester/customer" scenario. |
| `holdout/` | 10 | 7 | Engineers never open these. They are scored only by a script that prints aggregate metrics, never per-field contents. |

Both splits follow the same authoring rules and come from the same distribution. Industries, languages and field names differ, and no industry repeats across the 14 scenarios.

## Scenario file format (`<scenarioId>.json`)

The keys follow the Sprint 18A format (`tests/fixtures/ai-value-18a/README.md`), with these additions.

| Key | Meaning |
| --- | --- |
| `scenarioId`, `split`, `industry`, `sourceLanguage`, `description`, `fictional` | Metadata. `sourceLanguage` is one of `en`, `de`, `es`, `nl`, `fr`, `pt`, `it` or `mixed` (field names in more than one language). |
| `completable` | **New.** `true` when every required destination field has a valid source, so a correct integration can transform records. `false` when at least one required field has no valid source. A correct integration must then say it cannot complete the mapping, not invent a source. |
| `records` | 20 to 40 source records. Values are primitives only and there are no arrays. Nested objects are allowed, and a source path has at most 3 segments. Optional fields are `null` or missing in some records. |
| `destination` | Target JSON Schema 2020-12 object with 6 to 12 leaf fields and at most one level of nested objects. It uses `type`, `format` (`email`, `date`) and `enum`, plus a `required` list. Nested objects have their own `required` list. |
| `groundTruth` | One entry per destination leaf path (dotted when nested). See below. |
| `confusablePairs` | Source-field pairs that only meaning can tell apart. `correctFor` names the destination field they compete for. |
| `sourceConcepts` / `destinationConcepts` | One concept label per source/destination path, using the 18A vocabulary. |

### `groundTruth[destPath]`

| Key | Meaning |
| --- | --- |
| `source` | Dotted source path, or `null` when no valid source exists. For a concatenation, `source` is `null` and `sources` is used instead. |
| `sources` | Only for `concat`: 2 to 4 dotted source paths, in output order. |
| `transform` | One of `copy`, `trim`, `normalize_email`, `parse_date`, `map_enum`, `concat`, `none`. `none` if and only if there is no source. |
| `dateFormat` | Date targets only: the format of the **source** values, one of `YYYY-MM-DD`, `ISO-8601`, `DD/MM/YYYY`, `MM/DD/YYYY`. |
| `separator` | Only for `concat`. |
| `categoryMap` | Enum targets fed by a category field. Maps **every** distinct source label that occurs in the records to a destination enum value. A label maps to `null` when it has no correct destination value. A record carrying that label must be held for review, not transformed. |
| `why` | One sentence explaining the author's intent. |

Transform semantics:

- `trim` means the source text contains stray leading or trailing whitespace in some records.
- `normalize_email` means the source email contains upper-case letters in some records and must be lower-cased.
- `copy` is used for values that can be taken as they are, including emails that are already lower case.

## Authoring rules (all hold for every file)

- Source keys match `^[A-Za-z_][A-Za-z0-9_]*$` and are at most 64 characters long. A scenario has at most 20 source leaf fields. A category field has at most 10 distinct values. Field order inside records is shuffled.
- At least 3 confusable pairs and at least 2 unused source fields per scenario.
- At least two destination `enum` fields per scenario are fed by category source fields, and at least one of them is required. Source labels mostly differ from the enum values: they use other words, other languages, codes or other casing, so translating them needs business meaning. Each scenario has at least one label that maps to `null`, such as a test, legacy, internal or not-yet-active status.
- At least one optional destination field per scenario has no valid source (`transform: "none"`).
- At least one date target per scenario has a slash-format source (`DD/MM/YYYY` or `MM/DD/YYYY`). In the *ambiguous* scenarios, every day value in those fields is 12 or lower, so the data alone cannot prove the day/month order. The true format is still recorded, following the regional convention the author intended. In the other scenarios, every slash date target has some day value above 12.
- Structural variety:
  - nested source objects, some with 3-segment paths
  - optional fields that are `null` or missing
  - padded whitespace in text fields
  - mixed-case emails
  - two scenarios with mixed-language field names
  - no arrays
- Excluded industries: retail e-commerce, clinic appointments, hotel bookings, parcel shipments, payroll and B2B SaaS invoices.

## Per-split counts

| | dev | holdout |
| --- | --- | --- |
| Scenarios | 4 | 10 |
| `completable: true` | 3 | 7 |
| `completable: false` | 1 | 3 |
| Scenarios with ambiguous slash dates | 2 | 5 |
| Scenarios with a `concat` target | 1 | 4 |
| Source languages | en, de, es, nl | en, de, es, nl, fr, pt, it, mixed |

## Dev scenarios

- `crm-contacts-to-helpdesk-requester`: an unfamiliar CRM contact export loaded into a helpdesk requester/customer destination (en)
- `music-school-enrollments-to-student-portal` (de)
- `gym-memberships-to-access-control` (es)
- `public-library-patrons-to-notification-service` (nl, not completable)

Holdout scenario names and contents are intentionally not listed here.
