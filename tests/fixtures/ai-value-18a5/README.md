# AI-value evaluation set — Sprint 18A.5 holdout

Authored independently, before the Sprint 18A.5 planner change, by an author without access to the implementation or to earlier holdouts.

All data is fictional. Emails use only `example.com`, `example.org` and `example.net`. No real people, companies or brands appear.

## Contents

- `holdout/` holds 10 scenario files, one per industry. Each file is named `<scenarioId>.json`.

## Scenario format

```json
{
  "scenarioId": "kebab-case-id",
  "split": "holdout",
  "industry": "...",
  "sourceLanguage": "en|es|de|nl|fr|pt|it|mixed",
  "description": "one sentence",
  "fictional": true,
  "records": [ "...20 to 40 source records..." ],
  "destination": { "JSON Schema 2020-12 object" },
  "groundTruth": {
    "<destination path>": {
      "source": "<source path> | null",
      "dateFormat": "YYYY-MM-DD|ISO-8601|MM/DD/YYYY|DD/MM/YYYY (date targets with a source only)",
      "why": "short"
    }
  },
  "confusablePairs": [ { "kind": "...", "fields": ["<source path>", "<source path>"], "correctFor": "<destination path>" } ],
  "sourceConcepts": { "<source path>": "<concept>" },
  "destinationConcepts": { "<destination path>": "<concept>" }
}
```

Paths use dots for nesting, for example `tenant.email` or `donor.city`. `groundTruth` lists every destination leaf field exactly once. `"source": null` means that no source field validly fills the target. A correct planner leaves that target unmapped and does not invent a constant or a default.

Concepts come from the fixed vocabulary in the Sprint 18A.5 brief: customer-id, transaction-id, product-id, employee-id, other-identifier, given-name, family-name, person-name, organization-name, job-title, email, phone, street-address, city, postal-code, region, country, birth-date, created-date, start-date, end-date, modified-date, transaction-date, due-date, amount, currency-code, quantity, account-status, payment-status, order-status, priority, category, consent-flag, language-code, note, url, other.

## Authoring rules

Structural rules:

- Every record has the same field set. Optional fields may be `null`.
- Each key segment matches `^[A-Za-z_][A-Za-z0-9_]*$` (64 characters at most).
- A scenario has at most 20 source leaf fields and at most 3 levels of nesting.
- Values are primitives only. There are no arrays, and dates are strings.
- Category fields (concept `category`, `account-status`, `payment-status`, `order-status` or `priority`) have at most 10 distinct values. Each value is a lowercase token matching `^[a-z][a-z0-9_-]{0,31}$`.
- Destinations are `type: "object"` with at most one nested object level. Each has 6 to 12 snake_case leaf fields. Leaf types are string, number, integer or boolean. `format` is limited to email, date and date-time, and fixed lists use `enum`. No destination uses `$ref`, `oneOf`, `anyOf` or arrays.

Stress rules, applied in every scenario:

1. At least two destination `enum` targets come from a source category field, and at least one of them is required. Source labels are in the source language or abbreviated, and none equals a destination enum value. The planner must not invent the label-to-enum translation.
2. At least two destination targets have no valid source, and at least one of them is required.
3. At least three confusable source pairs. Both fields in a pair share a primitive type and shape, and only their meaning tells them apart. `correctFor` names the destination field for which exactly one field of the pair is correct.
4. At least one date target comes from a `DD/MM/YYYY` or `MM/DD/YYYY` source. In half the scenarios, at least one value has a day above 12, so the day/month order can be proven from the data. In the other half, every day in the ambiguous date fields is 12 or less, so the order cannot be proven from the data.
5. At least two source fields have no destination use, and source field order does not follow destination order.

Ground truth follows from the meaning the author intended. It was not derived from the behaviour of any tool.

## Coverage across the set

- 10 industries, none of which is retail e-commerce, B2B SaaS billing, healthcare clinic appointments, parcel shipments, HR payroll or hotel bookings.
- 8 source-language settings: es, de, fr, nl, pt, it, en and mixed.
- 4 scenarios use heavily abbreviated or vendor-prefixed names. Naming styles across the set include snake_case, camelCase and PascalCase.
