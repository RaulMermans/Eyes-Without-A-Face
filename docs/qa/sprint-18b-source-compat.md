# Sprint 18B (Worker E): source preparation and compatibility

Status: **CODE_READY**. Nothing was deployed, and no cloud request was made.

## Question

Two evaluation sets were written by different authors. Each had one scenario that could not be built in the app: holdout #1 of Sprint 18A and holdout #8 of Sprint 18A.5.

- **Live harness.** After the destination schema validated, clicking `build-integration` never reached OBSERVE (`toBeVisible()` failed in the step "build").
- **Offline evaluator.** The scenario "could not be built in either configuration", and the cause was not the synthetic-collision check (O5 = 0).

Nobody had looked into the cause.

**The holdouts were not opened.** No file under `tests/fixtures/ai-value-18a/holdout/` or `tests/fixtures/ai-value-18a5/holdout/` was read, listed or loaded during this work. Only these sources were used:

- the two README files;
- the 18A `dev/` split;
- the aggregate evidence already in the repository (`docs/evidence/sprint-18a*/`);
- fresh synthetic data written for this report.

## What the existing evidence already narrows down

| Evidence | What it shows |
| --- | --- |
| The live step is `build`: `destination-schema-ok` was visible and the click on `build-integration` succeeded | `canBuild` needs a prepared twin (`App.tsx`: `Boolean(workspace.source && prepared)`). A disabled button would have timed out on the click instead. So profiling and twin generation succeeded, and the failure came later, in `prepareDisclosureReview`. |
| Offline O5 = 0 | `summarize` counts every `twin-twin` failure in O5, so the twin stage did not fail. The offline failure is `twin-profile` or `disclosure`. The live evidence rules out `profile`. |
| Both T0 (no concepts) and T1 failed | The mechanism does not depend on the Sprint 18A meaning wording. |

That leaves `buildDisclosureDraft`, which has three possible causes:

1. the destination description (`describeTargetSchema`);
2. the gate (`evaluateCloudDisclosure`);
3. the private-value leak scan (`findPrivateValueLeaks`).

## Rejection paths between "records + destination loaded" and "preview created"

| # | Stage | Path | Supported per README? | Result on fresh data |
| --- | --- | --- | --- | --- |
| 1 | source adapter | not JSON, not records, empty, > 1 MiB, > 250 records | n/a | unchanged |
| 2 | profile | `inspectJsonValue`: forbidden key `__proto__` / `prototype` / `constructor` | key regex allows them | **fails**: refusal kept, message made precise (below) |
| 3 | profile | nesting > 3 object levels inside a record | README: ≤ 3 levels | 3 levels OK; 4 levels fails, message made precise |
| 4 | profile | > 64 fields, non-JSON values, circular references | n/a | unchanged |
| 5 | profile | bad field names, arrays, mixed types, always-null fields | excluded with a warning, not a failure | builds |
| 6 | profile | missing fields, nulls, null parent objects, empty objects | optional fields allowed | builds |
| 7 | profile | categories (accented, uppercase, single value, > 12 values), ISO / slash dates, date-times with or without a timezone, emails, empty strings, numeric strings, very large or negative numbers | allowed | builds |
| 8 | twin | synthetic collision, invalid contract, bindings, canary | O5 = 0 rules out | builds (currency codes, yes/no and country-style values tried) |
| 9 | destination | non-2020-12 `$schema` | README requires 2020-12 | fails with a clear message (unchanged) |
| 10 | destination | nested required, `additionalProperties`, `enum` with `null`, integer enum, `const`, date-time, non-identifier property names | allowed | builds (non-identifier names become notes) |
| 11 | gate | private field marked shareable | never for a generated twin | builds |
| 12 | **leak scan** | **a private value of 4+ characters as a substring of EYES's own fixed wording** | **allowed** | **fails in T0 and T1** |
| 13 | preview | schema, forbidden substrings, canary, the same leak scan, 24 KiB payload | allowed | 20 fields × 40 records with 12 long-enum targets: builds |

The probe ran each mechanism through the same path as the app and the evaluator:

```text
prepareTwin → buildDisclosureDraft → inspectDisclosurePayload
```

It ran with and without concepts.

## Reproduction

Fresh synthetic data reproduces the failure. Take any source in which some string value, after trimming and lowercasing, is a substring of the twin's fixed text. Building the disclosure then fails in both configurations with:

```text
Private value reproduced at /fields/N/semanticDescriptor
```

or at `/entities/0` or `/disclosureConstraints/N`.

Confirmed coincidences, each a plausible lowercase category label:

`email`, `date`, `code`, `life`, `text`, `true`, `false`, `name`, `data`, `used`, `exam`, `record`, `value`, `status`, `address`, `label`, `null`, `flag`, `source`, `place`, `holder`, `produce`, `form`, `held`, `cycle`, `unique`, `numeric`, `calendar`, `short`

| Wording | Where it comes from | Example labels it contains |
| --- | --- | --- |
| "Lifecycle status category" | every status field | `life`, `cycle`, `status` |
| "Email address" | every email field | `email`, `address` |
| "Unique record identifier (opaque code)" | identifiers | `code`, `record`, `unique` |
| "Calendar date in … format" | dates | `date`, `form`, `calendar` |
| "True/false flag" | booleans | `true`, `false`, `flag` |
| "One record of the private source dataset." | the entity description | `data`, `record`, `source` |
| "Some category labels are withheld; placeholder labels are used in examples." | a disclosure constraint | `place`, `holder`, `used`, `exam`, `label` |

Some words fail only when the matching kind of field is present. For example, `short` needs a "Short text value" field.

The fixture `tests/fixtures/source-compat-18b/it-insurance-policies-to-crm.json` is a fresh scenario that follows the README rules:

- fictional Italian policy records: 32 records and 16 leaf fields;
- three levels of nesting, nulls and a field missing from some records;
- two email fields, slash and ISO dates, and three confusable pairs;
- a target with no valid source;
- a nested destination.

Its contact-channel label `email` and line-of-business label `life` are ordinary values. Before the fix:

- the offline evaluator returned `ok: false` in T0 and T1;
- the draft failed at 7 descriptors.

This is the same signature as the unopened holdouts.

## Root cause

`findPrivateValueLeaks` (`src/privacy/leak-scan.ts`) flags a descriptor, an entity description or a disclosure constraint when any private value of 4 or more characters occurs in it as a substring. This is right for text that could carry data. But most of that text is **application-owned constant wording**: it is identical for every dataset, so it cannot disclose a private value. The scan did not tell the two apart.

Many CRM sources hold a category label that is a common English word. Such a source:

- profiled and produced a twin without trouble;
- then failed the draft at `buildDisclosureDraft`, and in the app the same scan inside `inspectDisclosurePayload`.

So "Build integration" could never succeed for that source, in any configuration. Because the twin was valid, `build-integration` was enabled. That matches the live evidence exactly.

Sprint 7 had already met one instance of this ("email" as a channel label matched "Email address"). It was fixed only for labels the user approved for disclosure. Labels withheld by default, which is the normal case, were still blocked.

**Is this the same cause as the two holdouts?** It is the only mechanism found that fits all the evidence for both:

- the step is after the twin and inside the disclosure draft;
- it fails in T0 and in T1;
- the twin is not rejected;
- inputs that follow the README hit it with ordinary lowercase category labels.

It is therefore **the most likely shared mechanism**. It is not proven to be the holdouts' cause, because the holdouts were not opened and must stay that way.

## Fix

The fix judges by provenance, as the Sprint 16B export scan does. An occurrence that lies **entirely inside application-owned wording** is not a finding. Everything else is scanned as before.

- **`src/phantom/fixed-text.ts` (new) defines the owned wording.**
  - The entity text and the three disclosure constraints are listed as the exact strings the generator emits.
  - `OWNED_DESCRIPTOR_SEGMENTS` is **derived** by running `defaultDescriptor` over every role, date format and qualifier flag, so it is never hand-listed.
  - A drift test checks that every entity description and constraint the generator emits is in the owned set. It also checks that every T0 descriptor segment is owned.
- **`src/privacy/leak-scan.ts` matches only exact owned text.**
  - In a descriptor, only whole `"; "`-separated segments equal to an owned segment are owned.
  - An entity description or constraint is owned only when the whole string equals an owned sentence.
  - A private value still counts if it has **any** occurrence outside the owned spans, or one that crosses a segment boundary.
  - If lowercasing changes the text's length, the spans are ignored and the whole text is scanned (fail closed).
- **What is unchanged:**
  - the exact-match checks (entity label, synthetic examples);
  - the revision and semantic-feedback blocks;
  - the approved-label rule;
  - the meaning wording, which stays unowned, so the Sprint 18A guard in `withConcept` and the scan both still read it.

`src/twin/authorization.ts` and the app call the same function, so the preview gate gets the same fix. No allowlist of words was added, and nothing in the scan was widened beyond text the application itself wrote.

**Ownership note.** ADR 0018 gives Worker E `src/sources/`, `src/domain/profile/` and `src/twin/target-disclosure.ts`. The defect is in `src/privacy/leak-scan.ts`, a module outside that list. The brief asked for the fix in the owning module, so the change is kept minimal there and in one new constant module. `src/phantom/generate.ts` was not edited; the drift test guards it instead. The lead should review and accept this before integration.

## Inputs that stay unsupported, now with a precise reason

Messages carry field names and record positions, never values.

- **A field named `__proto__`, `prototype` or `constructor` is still refused**, for engine safety.
  - Before: one line per record (`[0].constructor`, `[1].constructor`, …, capped at 16) saying only "Forbidden object key".
  - Now (in `profile.ts`): one issue per field path. It names the field and the first record where it appears, explains why, and says to rename it, for example `constructor_name`.
  - Nothing is renamed or dropped automatically.
- **Objects nested more than 3 levels inside a record are refused.**
  - Before: "Objects nested deeper than 4 levels are not supported." This counted the record itself, so it seemed to contradict the README's "3 levels".
  - Now: it names the object path, gives its depth inside the record, states the limit of 3, and says to move its fields up one level.
- **A non-2020-12 destination `$schema` is refused.** The message is unchanged and already clear.

## Tests

`tests/unit/source-compat-18b.test.ts`, 38 tests:

| Group | What it proves |
| --- | --- |
| **SC18B-1** | For 22 coincidental labels: (a) the label is a private value; (b) it really is a substring of the payload's fixed wording; (c) the scan reports nothing; (d) the app's preview gate accepts the payload. Also checks T0 and T1. |
| **SC18B-2** | The fresh fixture follows the README rules. It loads through the JSON Source Adapter (`importFile` → `toImportedSource`), reaches the preview in T0 and T1, and `scoreScenario` returns `ok: true` with 0 leak findings and 0 verbatim keys. |
| **SC18B-3** | The scan stays precise. It still flags: a private value in a segment that is not owned; one that also occurs outside the owned segment; one that crosses a segment boundary; the fail-closed Unicode case; a changed entity description or constraint; an exact private entity label; a synthetic example equal to a private value. |
| **SC18B-4** | Owned wording cannot drift away from what the generator emits. |
| **SC18B-5** | The precise reasons for `constructor` (top level and nested) and for over-deep nesting contain no values. Three nested levels, the published limit, are accepted. |

Run against the old `leak-scan.ts`, 30 of the 38 fail:

- all of SC18B-1;
- the end-to-end and evaluator tests in SC18B-2. The draft failed at 7 descriptors, and the evaluator returned `ok: false`.

The SC18B-3 cases fail too, because the old scan reports more locations than the exact set the tests expect. That is the over-matching being fixed.

No existing test was changed. The E2E check that `profile-error` contains `PROTOTYPE_POLLUTION` still passes, because the code is unchanged.

| Check | Result |
| --- | --- |
| `pnpm lint` | PASS (0 findings) |
| `pnpm typecheck` | PASS |
| `pnpm test:unit` | PASS: 34 files, 494 tests |
| `pnpm test:contracts` | PASS: 7 files, 53 tests |
| `pnpm test:privacy` | PASS: 13 files, 99 tests |
| `pnpm test:evaluation` | PASS: 9 files, 108 tests, 1 skipped (pre-existing opt-in) |
| `pnpm build` | PASS |
| `pnpm test:e2e` | PASS: 162 tests |

## Remaining limitations

- **The holdouts are not re-scored.** Whether #1 (18A) and #8 (18A.5) now build is unknown, and it must not be checked by opening them. A fresh independent holdout (Worker F, `tests/fixtures/eval-18b/`) is the right place to confirm.
- **A meaning wording that coincides with a private value is still withheld.** The Sprint 18A `withConcept` guard does this: the twin builds, but that field states no meaning. For example, a source with the label `email` gets no "email address" meaning on its email field. This is deliberate and unchanged. Alternative wordings are the documented remedy.
- **Deep nesting caps the number of reports.** For nesting deeper than 5 levels including the record, the generic structural check (`inspectJsonValue`) fires first, and its message stays generic. For reserved names, that check stops at 16 issues. When one reserved name appears in every record, a second reserved field may go unreported until the first is renamed.
- **The live path was not re-run.** No cloud requests were allowed in this task. The live path differs from the offline one only by `inspectDisclosurePayload`, which uses the same scan and is covered by SC18B-1 and SC18B-2.
