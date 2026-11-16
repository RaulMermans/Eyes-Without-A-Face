# Sprint 18A.5 — Does a stricter planner stop invalid and invented mappings? (pre-registration)

**Status: PRE-REGISTERED.** Written and committed before the A.5 implementation and before any model saw the evaluation set. Results are appended in [§ Results](#results) and never edit the sections above them. A change to a frozen input is recorded with `node scripts/freeze-ai-value.mjs --set a5 --amend "reason"` and reported.

All data is fictional. The owner approved the live budget on 2026-11-16.

## Question

The Sprint 18A live run (G1, the concept-bearing twin) left two planner defects:

- **Every rejected proposal was `INVALID_ENUM_MAPPING` (8 of 8).** Category names are withheld by default, yet Gemini wrote `map_enum` with labels it had never seen.
- **16 invented values.** These were `default_if_missing` or `map_enum` with `unmapped: "default"`, written on destination fields that have no valid source or that take a fixed list.

The acceptance policy already rejects both. They still make whole proposals unusable, or hide a gap behind a constant.

**Hypothesis H18A5.** The planner is changed in two ways:

1. Instructions (initial prompt v4): never use `map_enum` from a field without disclosed labels, never invent a value, and leave such destination fields unwritten.
2. A constrained initial response schema with no `default_if_missing` and `unmapped` limited to `"fail"`.

With this change, more proposals become valid and none invent values. Correct field choice is not lost on the fields the planner can legitimately map.

The converter, resolver, engine, acceptance policy and verifier are **unchanged**. No invalid output is repaired.

## Evaluation set

`tests/fixtures/ai-value-18a5/holdout/` holds **10 fresh scenarios**.

- **Authorship.** A new independent author wrote them, without access to the implementation or to earlier holdouts, before any A.5 code existed.
- **What every scenario contains:**
  - at least two destination `enum` fields fed by category source fields, at least one of them required;
  - at least two destination fields with no valid source, at least one of them required;
  - at least three confusable pairs.
- **Industries:** none repeats the 18A dev set.
- **Handling:**
  - The engineer never opens the set.
  - `scripts/freeze-ai-value.mjs --set a5` hashes it as one digest.
  - It is used only by the live harness and the scorer, which outputs aggregates and per-index rows only.
- **Development data:** the 18A `dev/` split, which has been inspected and is allowed for development.

## Configurations

| Config | App | Twin | Initial prompt | Initial response schema |
| --- | --- | --- | --- | --- |
| **P0** | branch `sprint-18a-ai-mapping` @ `2127cb9` (temporary worktree) | concept-bearing | Sprint 3 instructions (`MAPPING_PROPOSAL_INSTRUCTIONS`) | `mapping-response-per-operation-1` |
| **P1** | A.5 branch | concept-bearing (same) | v4 (new module) | `mapping-response-initial-2` (new) |

Everything else is the same in both configurations:

- the technical-view UI path, seed, model (`gemini-3.5-flash-lite`, `ONLY_IN_CLOUD`), approval gate and App Check debug token;
- no revision and no retry;
- no category names shared, which is the default a new user meets.

## Metrics and thresholds (fresh holdout, live)

All metrics are scored from the recorded alias-level model text by an extended EVAL-184 scorer. Before scoring, the scorer reconstructs each prompt with the configuration's own prompt version and proves the hash equal to the one sent.

Definitions:

- **Category target:** a destination `enum` field whose ground-truth source is a category field. No labels are shared in this run.
- **Empty target:** a destination field whose ground truth is `null`.

| ID | Metric | Definition | Pass condition |
| --- | --- | --- | --- |
| **V** | **Valid proposals (primary)** | Share of sent requests whose answer `convertProposal` accepts. A provider failure counts as not valid. | P1 ≥ P0 + 0.20 |
| **I** | Invented values | Count of `default_if_missing` operations, plus `map_enum` operations with `unmapped: "default"`. | P1 = 0 |
| **C** | Correct correspondences on mappable targets | L1 of Sprint 18A, restricted to targets that are neither category targets nor empty targets. | P1 ≥ P0 − 0.05 (non-inferiority) |
| W | Category abstention | Share of category targets left unwritten. | reported (P1 expected ≥ 0.8) |
| N | Empty-target abstention | Share of empty targets left unwritten. | reported |
| H | Hallucinated references | As L3 in Sprint 18A. | P1 ≤ P0 |
| — | Privacy | In-run request-body scan; evidence trace. | 0 findings |
| — | Proof | Sent prompt hash = previewed prompt hash = reconstruction hash. | every request |

**A.5 passes** only when V, I, C, H, privacy and proof all hold. A failure is reported as a failure. The prompt is not tuned on this holdout.

## Budget (owner-approved)

| Item | Value |
| --- | --- |
| Requests | 10 scenarios × 2 configs × 2 trials = **40 cloud requests** at most |
| Order | ABBA: P0 t1, P1 t1, P1 t2, P0 t2 |
| Revision | None |
| Retries | None. A provider failure or a harness failure is recorded and not repeated |
| Stop rule | Stop on the first privacy finding or on a breach of the per-scenario budget |
| Rehearsal | A zero-request rehearsal on the 18A dev split precedes the run |

## Results

### Run 1 — stopped by the pre-registered stop rule (2026-11-16)

**What happened.**

- The zero-request rehearsal passed on the 18A dev split and on the fresh holdout for both P0 and P1.
- Holdout #8 cannot be built in either app and sends nothing. It is the same failure class as 18A holdout #1, so A.3 is now seen in two independent sets.
- The live run started in ABBA order. During **P0, trial 1, scenario #7**, the in-run request-body scan reported **2 matches**, and the stop rule ended the run.
- **7 requests had been sent, all P0. No P1 request was sent.**
- The evidence is kept unchanged in [planner-live.json](../evidence/sprint-18a5/planner-live.json); the match count of 2 is preserved.

**Trace before any conclusion.**

- The sent prompt is hash-proven identical to the offline reconstruction, so the matches could be located exactly. Both terms are source category values that occur **only as substrings of destination enum values** in the reviewed `target` block:
  - `pledge` inside the destination value `pledged`;
  - `refund` inside `refunded`.
- The harness excluded exact destination words but not substrings.
- **No source-derived text contained a private term. This was not a leak.** It is the same class of false positive as Sprint 12's "Copperfield Partners".

**Correction (scan precision, not an allowlist).**

- The scan moved to `privateTermsInBody` (`src/evaluation/ai-value-live.ts`). Before matching, it blanks the reviewed destination names and values **as exact quoted strings**, the established `checkOutboundPrompt` method. The same value anywhere else is still a finding.
- EVAL-188 covers it:
  - the traced case;
  - positive controls for a value in a descriptor, a person name, a coded key and an identifier;
  - a re-scan of all 35 Sprint 18A requests (0 findings).
- An offline re-scan of the 7 recorded A.5 requests found 0 source-derived findings (#7: 2 harness matches, 0 source-derived). A pre-scan of every prompt the remaining run would send (P0 and P1, 9 buildable scenarios each) also found 0.

**Partial data, P0 only (n = 7). Not a verdict.**

- valid proposals 0 of 7, all `INVALID_ENUM_MAPPING`;
- 21 invented values;
- mappable correct 0.674.

Resuming needs the owner's decision: the stop rule fired, and the budget was approved under it.
