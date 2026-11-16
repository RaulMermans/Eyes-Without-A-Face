# AI-value benchmark fixtures (Sprint 18A)

Authored independently, before the Sprint 18A implementation, by an author without access to the implementation.

These fixtures measure whether the mapping pipeline picks the correct source field for each destination field. Every record, person, company and email address is fictional; email domains are all `example.com`, `example.org` or `example.net` (or subdomains of them).

## Splits

- `dev/`: 6 scenarios. Engineers may read and tune against these.
- `holdout/`: 10 scenarios. Engineers do not open these; they are only used to score a finished pipeline.

Both splits follow the same authoring rules and come from the same distribution. Only the industries, languages and field names differ.

## Scenario file format (`<scenarioId>.json`)

| Key | Meaning |
| --- | --- |
| `scenarioId`, `split`, `industry`, `sourceLanguage`, `description`, `fictional` | Metadata |
| `records` | 20 to 40 source records. Values are primitives only, there are no arrays, and nested objects go at most 3 levels deep |
| `destination` | Target JSON Schema 2020-12 object. It has 5 to 12 leaf fields and at most one level of nested objects. It uses `type`, `format` (email/date/date-time) and `enum` |
| `groundTruth` | For each destination leaf path (dotted when nested): `source` (a dotted source path, or `null` when no valid source exists), `dateFormat` (for date targets, the format of the *source* values) and `why` |
| `confusablePairs` | Source-field pairs with the same primitive type and similar value shapes, where only meaning separates them. `correctFor` names the destination field the pair competes for |
| `sourceConcepts` / `destinationConcepts` | One concept label per source/destination path, from the fixed vocabulary below |

Concept vocabulary: customer-id, transaction-id, product-id, employee-id, other-identifier, given-name, family-name, person-name, organization-name, job-title, email, phone, street-address, city, postal-code, region, country, birth-date, created-date, start-date, end-date, modified-date, transaction-date, due-date, amount, currency-code, quantity, account-status, payment-status, order-status, priority, category, consent-flag, language-code, note, url, other.

## Authoring rules

- Source keys match `^[A-Za-z_][A-Za-z0-9_]*$`, are at most 64 characters, and each scenario has at most 20 source fields. Category fields have at most 10 distinct values.
- Every record has the same field set. Optional fields may be `null` or, in some records, missing.
- Every scenario has at least 3 confusable pairs from these kinds: customer-id vs transaction-id; birth date vs signup/start date; organization vs person name; account status vs transaction status; currency/amount confusion; nested entity relationship; two email fields; modified vs created date; phone vs fax/mobile or postal code vs internal code.
- Every scenario has at least one destination field with no valid source (`"source": null`), at least two unused source fields, at least one `enum` target fed by a category field, and at least one date target whose source uses `DD/MM/YYYY` or `MM/DD/YYYY`.
- About half of those date targets can be proven from the data (some day > 12). In the other half every day is 12 or lower, so the order cannot be proven from the data. The true format is recorded either way.
- Source field order inside records is shuffled. It does not follow destination order.
- Naming styles vary across scenarios: snake_case, camelCase, PascalCase, heavy abbreviations, vendor prefixes (`fld_`, `c_`) and non-English names (de, es, nl, fr, pt, it, mixed).
- Ground truth follows from the meaning the author intended, not from the behaviour of any tool.
