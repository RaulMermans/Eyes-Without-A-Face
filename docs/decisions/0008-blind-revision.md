# 0008 — Blind revision: one approved, feedback-driven cloud revision

Status: Accepted  
Date: 2026-11-12

## Context

Sprint 7 asks whether a cloud model can improve an integration for records it is never allowed to see. Gemini proposes a mapping over the approved Phantom Twin (cloud disclosure 1.1.0). The local Reality Check then finds failures on private records and reserved cases. Until now those findings stayed local (ADR 0005, AGENTS.md): the engine's messages may quote private values.

Sending anything about the failures is a second disclosure. It must not:

- widen what the cloud already saw;
- bypass the single-use approval gate;
- turn into an unbounded self-correction loop.

## Decision

**Workflow, not an agent framework.** Deterministic code owns:

- permissions and the feedback projection;
- approval, validation and execution;
- the iteration limit and the stopping rules;
- every reported number.

Gemini owns only the interpretation that produces one revised declarative proposal. The sequence is: approved disclosure → proposal → local evaluation → safe feedback → new approval → one revision → local re-evaluation (Evaluator–Optimizer, bounded to a single cycle).

**Blind Revision Feedback 1.0.0** (`blind-revision-feedback.v1.schema.json`).

- It is built by an allowlisted projection (`src/revision/feedback.ts`): it never serializes the report and deletes fields.
- It carries only:
  - operation numbers;
  - aliases already disclosed;
  - destination names from the approved target;
  - eight allowlisted engine codes, each mapped to a fixed category;
  - one evaluator-derived code, `UNAPPROVED_FALLBACK`;
  - coarse count buckets (1, 2–4, 5+);
  - the previous alias-level operations;
  - destination-side fallbacks the local policy approved;
  - fixed objectives and the budget.
- Every object level is `additionalProperties: false`.
- A semantic validator rejects undisclosed aliases or targets, operation drift and fallbacks outside the target.

**Cloud disclosure 1.2.0.** A revision request is the approved 1.1.0 payload, repeated byte-for-byte (proved by `assertSameBase`), plus a required `revision.feedback`. It goes through the unchanged gate:

- `inspectDisclosurePayload` (schema, forbidden keys, canary, private-value scan, now covering the revision block);
- exact-prompt SHA-256;
- `approveDisclosurePreview`;
- the single-use ledger and the effective-destination check.

The approval binds the exact prompt, payload version, model, request id and — through the payload — the run id, the base disclosure hash and the current mapping hash. There is no second authorization path.

**Validation of the revision.** The revised output goes through the unchanged `convertProposal` and `resolveAliases`, against the original 1.1.0 disclosure. Nothing is repaired.

**Revision-only response schema.** Revision requests use `MAPPING_REVISION_JSON_SCHEMA`: one `anyOf` branch per operation shape, constraining params per operation. Initial proposals keep the Sprint 4 schema. This tightens decoding only; the converter still validates everything.

**Budget and state.** `src/revision/run.ts` is an explicit state machine (`INITIAL_PROPOSAL_VALIDATED` … `REVISION_EVALUATED`, `REVISION_BLOCKED`).

- No transition leads back to `REVISION_SENT`.
- A session budget keyed by (base disclosure hash, initial contract hash) refuses a second revision of the same mapping, even from a "new run".
- Any upstream change discards the run.

**Exception semantics.** `src/verification/outcomes.ts` classifies rows after the unchanged engine, under a versioned local acceptance policy:

- `TRANSFORMED_VALID`
- `HANDLED_BY_APPROVED_RULE`
- `QUARANTINED`
- `UNRESOLVED`
- `REJECTED_BY_POLICY` — an unapproved fallback or default is an invented value
- `INCORRECT_TRANSFORMATION` — fixtures with ground truth only

Completion states (`VERIFIED` … `BLOCKED`) are computed from these rows only. Quarantine never counts as a transformation.

## Consequences

- A revision can add only allowlisted, coarse, alias-level information. Its new content is listed for the user before approval.
- At most two cloud requests per mapping per browser session. The limit is browser-local: a fresh page or browser has a fresh budget. This is documented, not claimed as a global guarantee.
- Gemini cannot see failing values. It cannot recover an undisclosed category or repair malformed data, and schema-valid but semantically wrong mappings (for example a reversed priority scale) produce no finding at all.
- The engine stops at the first failing operation per record, so one revision may reveal a second defect it cannot then address.
- The engine, the eight-operation DSL, the converter and the 1.1.0 path are unchanged.
