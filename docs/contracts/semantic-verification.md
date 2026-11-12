# Semantic Verification Contract 1.0.0

Schema: `src/domain/contracts/schemas/semantic-verification.v1.schema.json`
Code: `src/semantics/` (contract, observation, verifier)
Decision: [ADR 0009](../decisions/0009-semantic-verification.md)

**Local only.** The contract references local source paths and never leaves the device. Only an allowlisted projection of a constraint the user authorized may reach the cloud, as Blind Revision Feedback 1.1.0. See [blind-revision-feedback.md](blind-revision-feedback.md).

## Shape

```json
{
  "contractKind": "semantic-verification",
  "semanticContractVersion": "1.0.0",
  "contractId": "support-tickets-semantics",
  "localOnly": true,
  "constraints": [
    {
      "id": "support-priority-order",
      "kind": "ordered-categories",
      "source": "prio",
      "target": "priority",
      "sourceOrder": ["p1", "p2", "p3", "p4"],
      "targetOrder": ["urgent", "high", "normal", "low"],
      "undeclared": "review",
      "trust": "trusted",
      "evidence": { "kind": "user-declared" }
    },
    {
      "id": "observed-date-1",
      "kind": "date-interpretation",
      "source": "angelegt_am",
      "format": "DD/MM/YYYY",
      "trust": "trusted",
      "evidence": { "kind": "deterministic-observation", "observation": { "checkedValues": 9, "disambiguating": 1, "conflicting": 0 } }
    }
  ]
}
```

Every object level has `additionalProperties: false`. There is no free-text field.

## Constraint kinds

| Kind | Fields | Verified as |
| --- | --- | --- |
| `date-interpretation` | `source`, `format` (`null` when ambiguous), `candidates` | Static: every `parse_date` of `source` declares `format`. Dynamic: each produced date equals the trusted reading of the same source value |
| `ordered-categories` | `source`, `target`, `sourceOrder`, `targetOrder` (highest first), `undeclared` | No pair of declared labels maps to inverted ranks, statically (map) or per record. A value outside `targetOrder` conflicts with meaning |
| `enum-meaning` | `source`, `target`, `meaning`, `undeclared` | Each declared label produces exactly its declared value |
| `allowed-values` | `target`, `values` | Each produced value is in the set |

`undeclared: "review"` means a category outside the declared set must not become a successful output.

## Trust and evidence

| `evidence.kind` | May be `trusted`? |
| --- | --- |
| `user-declared` | Yes |
| `source-contract` | Yes |
| `local-rule` | Yes |
| `deterministic-observation` | Only if sufficient: for date order, at least 1 disambiguating value and 0 conflicting |
| `model-suggestion` | **Never** (only `proposed`) |

`validateSemanticContract` fails closed on structural or trust violations; an invalid contract verifies nothing. It also reports conflicts without rejecting the contract, and the verifier then marks those constraints `SEMANTIC_POLICY_CONFLICT`:

- a target or value outside the destination;
- two trusted date formats for one source;
- a declared meaning that inverts a declared order.

## Building the contract

`buildSemanticContract({ declared, profile, records })`:

1. Starts from the declared constraints. In the app these are the scenario's owner declarations plus any date order the user confirmed in the Semantic verification panel.
2. Adds one observed date constraint per slash-date field of the profile, over `records`.
   - `records` must be imported plus revision-feedback cases. **Never holdout.**
   - A trusted declaration replaces an ambiguous observation of the same field.
   - A proven observation that disagrees with a declaration is kept, so the conflict is reported.

## Verification output

`verifySemantics` returns per-constraint results, per-destination status, an overall status and coverage. The statuses are defined in ADR 0009. Unknown is never collapsed into a pass:

- meaning-bearing operations without a constraint report `SEMANTIC_EVIDENCE_MISSING`;
- structural operations report `SEMANTIC_UNVERIFIED`.

`violatingRows` are local row indices. They stay on the device and appear only in the local-only detail of the UI.

## Tests

- `tests/evaluation/semantic-verification.test.ts` (SEM-001…005):
  - Sprint 7 failure analysis;
  - detection of both silent errors;
  - ambiguity and missing evidence;
  - no ground-truth leakage.
- `tests/unit/semantic-verifier.test.ts`: generic checks on synthetic rows.
- `tests/contracts/semantic-contracts.test.ts`: schema strictness, scenario specs, version migration.
