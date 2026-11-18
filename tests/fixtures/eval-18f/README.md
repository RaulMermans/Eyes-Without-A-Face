# Independent evaluation set (Sprint 18F)

## Authorship statement

An independent evaluation author wrote this set. The author had no access to the implementation: they did not read `src/`, `scripts/`, `docs/`, any other test or fixture directory, any earlier holdout or `author/` directory, or git history, and they saw no prompts. The only files they read were `tests/fixtures/eval-18c/README.md`, `tests/fixtures/eval-18d/README.md` and the six `tests/fixtures/eval-18d/dev/*.json` files, used only as a format reference. They did not run the project's tests or tools.

Ground truth, including every `expectedSamples` output, records what the author meant each field to mean. It was not derived from the behaviour of any tool, prompt or model. The records were produced by a deterministic author script from hand-written field definitions (`author/specs_holdout_*.py`, `author/lib.py`, run with `python3 author/build.py`). The expected outputs apply the author's own ground truth to the chosen records and were checked by a second, independent author script (`author/check.mjs`, plain Node), which re-implements the output semantics and the authoring rules without sharing code with the first. Both scripts agree on all 72 samples.

All records, people, companies and email addresses are fictional. Every email address is on `example.com`, `example.org` or `example.net`, or on a subdomain of one of them. No real product, vendor or organization is named.

## Splits

| Split | Scenarios | Completable | Purpose |
| --- | --- | --- | --- |
| `holdout/` | 24 | 18 | Engineers never open these. They are scored only by a script that prints aggregate metrics, never per-field contents. |

There is no `dev/` split in this set. The `author/specs_holdout_*.py` files describe holdout contents and are sealed like `holdout/`.

## Tracks

| Track | Meaning |
| --- | --- |
| `wedge` | A CRM or customer-account export from a small or medium business (varied company types) loaded into a helpdesk-compatible requester, end-user, customer or contact schema. Destination field names, nesting, required fields and enum lists differ per scenario. Source naming conventions vary: snake_case, camelCase, PascalCase, vendor prefixes, abbreviations, eleven source languages including one mixed English/Dutch export. |
| `general` | Unfamiliar domains that are neither CRM nor helpdesk. None of the domains excluded by the 18C and 18D READMEs, or used in their dev splits, is used. |

Typical confusions in both tracks: another party's name or contact field (account managers, assistants, administrators, guardians, emergency contacts, reviewers, invoice mailboxes) vs the target person's; primary vs secondary or billing email; business identifier vs record key, tax number, row counter or legacy id; net vs gross amounts or volumes; start vs end, renewal, next-visit or created dates; lifecycle status vs payment, contract or consent status; tier or plan vs segment or frequency.

## Scenario file format (`<scenarioId>.json`)

Exactly the 18D format: `scenarioId`, `split`, `track`, `industry`, `sourceLanguage`, `description`, `fictional`, `completable`, `records`, `destination`, `groundTruth`, `confusablePairs`, `sourceConcepts`, `destinationConcepts`, and `expectedSamples` on completable scenarios only. `groundTruth` entries use the same keys (`source`, `sources`, `transform`, `dateFormat`, `separator`, `categoryMap`, `why`, `unsupportedReason`) with the 18C transform and output semantics. `expectedSamples` has exactly 4 entries per completable scenario (at least one `held`), with the 18C meaning. `confusablePairs` kinds are the six kinds used in the 18D files. Destination descriptions vary in quality as in 18D.

## Authoring rules (all hold for every file, enforced by `author/check.mjs`)

All 18C and 18D authoring rules hold: 20 to 40 records; at most 20 source leaf fields; 6 to 12 destination leaf fields with at most one nested level; no arrays; keys of letters, digits and underscores; at least 3 confusable pairs including competing category fields and competing identifiers; at least 2 unused source fields; at least two destination enum fields fed by category fields (at least one required); realistic category labels in the source language, each label used at least twice, at most 10 distinct values per category field, at least one label mapping to `null`; at least one optional destination field without a valid source; at least one slash-format date target and the ambiguous-date rule (a slash-date target either contains at least one value with a part above 12, or all its values are ambiguous and the format follows the source locale); padded whitespace, mixed-case emails and an unused repeated person-name field in every scenario; `concat` sources never null and never padded; `copy` sources never padded. Every completable scenario has an optional destination field whose valid source is `null` in some records and missing in others. Not-completable scenarios lack the information for a required field and contain a plausible decoy (kind `decoy-for-missing-field`). Descriptions are under 160 characters and contain no example values, digits, emails, URLs, ids or instructions; every scenario has 1 or 2 fields that are vague (at most three words) or have no description.

## Per-split counts

| | holdout `wedge` | holdout `general` | holdout total |
| --- | --- | --- | --- |
| Scenarios | 12 | 12 | 24 |
| `completable: true` | 9 | 9 | 18 |
| `completable: false` | 3 | 3 | 6 |
| Scenarios with ambiguous slash dates | 5 | 5 | 10 |
| Scenarios with a `concat` target | 6 | 5 | 11 |
| Scenarios with an unused repeated person-name field | 12 | 12 | 24 |
| Scenarios with another party's name or contact field as a listed decoy | 12 | 11 | 23 |
| Scenarios with an `unsupportedReason` | 7 | 10 | 17 |
| Not-completable scenarios whose missing required field would need an unsupported transformation | 1 | 1 | 2 |
| Completable scenarios with a required field that is `null` in some records | 2 | 1 | 3 |
| Scenarios with two competing identifier fields | 12 | 12 | 24 |
| Fully flat scenarios | 4 | 4 | 8 |
| Scenarios with 3-segment source paths | 2 | 2 | 4 |
| Source languages | da, de, en, es, fr, it, mixed (en/nl), nl, pl, pt, sv | da, de, en, es, fr, it, mixed (fr/en), nl, pl, pt, sv | 11 codes |
| Destination fields with a vague description | 12 | 13 | 25 |
| Destination fields with no description | 6 | 10 | 16 |
| `expectedSamples` checked by both scripts | 36 | 36 | 72 |

Scenario names and contents are intentionally not listed here.

## Regenerating and checking

```sh
cd tests/fixtures/eval-18f/author
python3 build.py   # deterministic: rewrites holdout/ from the specs
node check.mjs     # independent check of rules and every expectedSamples entry
```
