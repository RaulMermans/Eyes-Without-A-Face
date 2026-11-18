# 0021 — Semantic intelligence recovery: model configurations, destination semantics, local matching, ranked plans

Status: Accepted (implementation). **Not shipped.** Every new behaviour is off in the product until a pre-registered live comparison selects it. Stage 1 (live, dev) awaits the owner's budget approval
Date: 2026-11-18
Builds on: [ADR 0018](0018-integration-intent-plan.md), [ADR 0020](0020-category-groupings-and-plan-recovery.md)

## Context

- Sprint 18C: 0 / 24 complete integrations, about 53 % correct correspondences, about 40 % correct category correspondences. The engine, verifier and privacy layer did their part ([report](../sprints/sprint-18c.md)). **The bottleneck is semantic correspondence.**
- Three candidate causes, none measured so far:
  1. the model (`gemini-3.5-flash-lite` at its default MINIMAL thinking);
  2. information loss: the disclosure target carries destination names and types but drops the destination's own descriptions, so two same-typed fields look alike;
  3. a single pick per field: when it is wrong, the right field is nowhere in the plan.
- **Structural fact.** Source field names never leave the device. A local matcher can read them; Gemini cannot. Local evidence is therefore not redundant with Gemini's.

## External findings (verified 2026-11-17/18)

**Firebase AI Logic models and thinking** (firebase.google.com/docs/ai-logic/models, /thinking):

- Backend `GoogleAIBackend` (Gemini Developer API).
- `gemini-3.6-flash` is stable with no shutdown date on this backend; its listed replacement is `gemini-3.8-flash`.
  - On the Agent Platform backend, 3.6-flash shuts down on 2026-11-19. Not our backend, but a reason not to standardize on it.
- `gemini-3.8-flash` is the current Flash. Billing is not required.
- Thinking levels: MINIMAL, LOW, MEDIUM, HIGH. XHIGH is not supported by Firebase AI Logic.
  - Flash-Lite defaults to MINIMAL; 3.x Flash to MEDIUM.
  - 3.8-flash, 3.7-flash and gemini-4-* reject MINIMAL (HTTP 400).
  - Gemini 3.x always thinks (dynamic, up to the level).
- **Installed SDK:** firebase 13.2.0 (`@firebase/ai` 3.0.0) exposes `thinkingConfig.thinkingLevel` with the values MINIMAL, LOW, MEDIUM and HIGH.
- **Prices (Gemini Developer API, paid tier):**
  - `gemini-3.5-flash-lite`: $0.30 / $2.50 per 1M input / output tokens.
  - `gemini-3.8-flash`: $0.75 / $3.75 (introductory, through 2026-12-31; $1.50 / $7.50 from 2027-01-01).
  - `gemini-3.6-flash`: $1.50 / $7.50.
  - Output tokens include thinking tokens.
- Availability to **our** project is unverified until a live request succeeds. Nothing is assumed.

**Structured output.** Unchanged from ADR 0018: the decoder refuses nested array bounds (HTTP 400). Bounds stay in the canonical schema only.

**Transformers.js and Valentine.** See [sprint-18d-local-matching.md](../evaluation/sprint-18d-local-matching.md).
- Transformers.js 4.3.2 (Apache-2.0) runs feature extraction with ONNX on WASM or WebGPU, with model weights fetched from a CDN.
- Valentine 1.1.1 (Apache-2.0) is a Python library: COMA (pure-Python port in 1.1.1), Cupid, Similarity Flooding, Jaccard and distribution-based matchers.

## Decision

**A. Allowlisted model configurations** (`src/inference/cloud-models.ts`):
- The allowlist is `gemini-3.5-flash-lite` (default), `gemini-3.6-flash`, `gemini-3.8-flash`, and `gemini-4-hydrogen` (diagnostic only), each with its supported thinking levels.
- The product default is unchanged.
- Another configuration is selectable only in a dev build, through `window.__EYES_EVAL_CONFIG__`. This global selects an arm **without** switching to the simulated adapters (any `__EYES_WITHOUT_A_FACE_TEST__` object does that).
- The model and thinking level are part of the approved destination:
  - `destinationKey` appends `:thinking=<level>`;
  - `assertEffectiveDestination` compares the thinking level too;
  - the live adapter builds each model from the approved payload's destination, after an allowlist check;
  - approving one configuration never authorizes another, and there is no fallback between models.
- Plan output cap: 8192 for Flash-Lite at MINIMAL (the 18C cap, unchanged); 24 576 otherwise, because thinking tokens count against the cap.

**B. Destination semantics: cloud-disclosure 1.4.0** (`cloud-disclosure.v1.4.schema.json`):
- 1.4.0 = 1.1.0 + an optional `target.fields[].description` (≤ 160 characters) + an optional `destination.thinkingLevel`. Versions 1.0.0–1.3.0 are unchanged, and historical replays still rebuild their prompts.
- Descriptions come only from the destination schema's own `description` (else `title`). They are kept locally by `describeTargetSchema` and pass `sanitizeTargetDescription`, which fails closed. A description is dropped when it:
  - fails the first-sentence or length rule;
  - contains characters outside letters, spaces and `. , ; : ' ( ) - / &`;
  - contains `//`, a run of 3 or more digits, or a word longer than 24 characters;
  - contains instruction or credential vocabulary;
  - contains a private source value;
  - contains a source field-name segment of 4 or more characters.
- Dropped descriptions are listed as local notes with a reason code. The leak scan re-checks every projected description.
- The review shows each description, and the thinking level, before approval.
- The frozen `convertProposal` gate judges a 1.4.0 plan through `gateDisclosureView`, an exact 1.1.0 view. The gate is unchanged.
- A 1.4.0 request is always a plan request. Blind revision stays 1.1.0-only (unchanged).
- **Known limit:** the field-name guard is a substring rule, so it over-drops. For example, a source field `mail` withholds "Primary contact email." This is deliberate: fail closed, as for concept wordings.

**C. Local Semantic Matcher** (`src/matching/`, frozen interface `types.ts`):
- Lexical and translated name tokens (a fixed general multilingual table), destination-description tokens, type and format compatibility, concept claims, category shape and label overlap, identifier shape, completeness, and contradiction flags.
- At most 3 candidates per field, with ordinal scores and an `uncertainty` of clear, ambiguous or none.
- **Local only.** Its output is never trusted semantic evidence (`src/semantics` never reads it), never executes anything, and never enters a payload, log, telemetry or export.
- **Build, don't integrate** (dev evidence, N = 131 fields with a source):

  | Ranker | Top-1 | Top-3 |
  | --- | --- | --- |
  | `matchLocally` | 81.7 % | 93.1 % |
  | `rankCandidates` (existing) | 49.6 % | 80.2 % |

  - On the fresh 18D dev set alone, `matchLocally` gets 78.4 % / 92.2 % against 45.1 % / 74.5 %.
  - Valentine: the best matcher is below the existing baseline, and it needs a Python runtime. Not integrated.
  - Transformers.js embeddings: below the simple matcher alone and in fusion, and a 118 MB model per device. Not added to the bundle.

**D. Ranked plans: prompt v6 and plan 1.1.0:**
- Plan 1.1.0 = 1.0.0 + `alternatives`: up to 2 other disclosed aliases, most likely first. Prompt v6 = v5 + the alternatives rule + one sentence on destination descriptions. v5 is byte-identical.
- `validateIntentPlan(…, { ranked })`:
  - 1.0.0 stays exact (`alternatives` is refused);
  - an undisclosed alternative alias rejects the entry (`UNKNOWN_ALIAS`);
  - an alternative that repeats `from`, or appears on a `no_source` entry, rejects it as `INCONSISTENT_ENTRY`.
- Alternatives are never executed. They order a choose-field question's `rankedPaths`: Gemini's pick, then its alternatives, then local candidates, at most 3. "Choose another field" still lists every usable field, and nothing is pre-selected.
- **Opt-in compile policies** (`CompileInput.local`). Without the option, compiling is byte-identical to Sprint 18C:
  - `askOnAlternatives`: a high-confidence match that lists alternatives is asked.
  - `askOnLocalDisagreement`: a high-confidence match is asked when the local matcher is `clear` about a different field and does not list Gemini's pick at all.
  - **Agreement never upgrades a match.** An uncertain match stays a question even when the matcher agrees, because both can be wrong in the same way.
- **Defect fix found in 18D (applies to ADR 0020 §7 too).** When a question about Gemini's single pick was answered with that same field, the field was rebuilt by the local Sprint 15 rule. That rule could drop Gemini's transformation (`trim` became `copy`), which gave wrong records.
  - Now Gemini's own parameterless operation (copy, trim or normalize_email) stands. It goes through the gate, with origin `gemini+user`.
  - Any other answer still builds the user's rule.

**E. Evaluation** ([pre-registration](../evaluation/sprint-18d-semantic-intelligence.md), scorer `src/evaluation/eval-18d.ts`):
- **Arms** fix what is sent. A is the 18C P1 configuration, byte-identical (EVAL-300).
- **Policies** fix what the compiler does. They are scored on the same recorded answers, so they cost no extra requests.
- **Stage 1** runs live on dev only. **Stage 2** runs on the independent 18D holdout, which is never opened by engineers.

## Not changed

- The engine, `convertProposal`, `resolveAliases`, the semantic verifier and the export.
- Single-use approval, App Check, no automatic retry, no fallback between models or modes.
- The 18A, 18A.5, 18B and 18C holdouts stay inspected and are not used.

## Consequences

- Each workstream can be measured on its own (model × context × prompt × policy).
- The product stays on the 18C-era configuration until Stage 2 passes; production stays `c7220768`.
- Rejected for now: sending local candidate hints to Gemini. A hint is derived from private field names, so it would be a new disclosure class that needs its own ADR.
