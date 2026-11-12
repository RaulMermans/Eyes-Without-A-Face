# Data disclosure policy

1. Private source records never leave the machine for cloud inference.
2. On-device inference may inspect structure. It must not be used as a channel to upload rows.
3. Cloud inference may receive only an approved `CloudDisclosurePayload` plus the fixed instructions for its schema version, exactly as shown in the Disclosure Review step.
4. A Phantom Contract is never the outbound request. Internal keys such as `sourceFieldId` must not appear in the serialized cloud payload.
5. Fields with sensitivity `private` must appear in `nonShareableSourceFieldIds` and must not be `shareable: true` on the phantom.
6. Diagnostics in validation reports must not echo raw private payloads.
7. Exports include synthetic fixtures only, by default.
8. Approval is bound to SHA-256 of the disclosure bytes, SHA-256 of the exact outbound application prompt, destination, purpose, and request id.
9. Each approval is single-use. Missing, stale, modified, destination-mismatched, reused, or concurrent submissions are rejected.
10. Synthetic data is not inherently anonymous. Field names, constraints, rare categories, and error text can still leak information about a private system.
11. Local profiling may read private values to infer types. That does not authorize those values to appear in a cloud-bound payload.
12. Original field names never appear in a disclosure. Aliases are `f_NN`. Alias-to-field bindings (`PrivateBindings`) are local-only and cannot be serialized.
13. Category labels are withheld by default. Disclosing them is an explicit per-field opt-in, and the UI flags rare labels.
14. User-edited descriptors are rejected if they repeat a local field name or a private value, contain the canary, or contain control characters.
15. The destination schema is described minimally (names, types, required, nullable, format, enum) inside the approved payload (1.1.0). Titles and descriptions are never sent. Nothing is appended to the prompt outside the fingerprinted payload.
16. The gate rejects any payload that reproduces a value from the local private-value index (`PRIVATE_VALUE_PRESENT`). Explicitly approved category labels are the only exception.
17. Changing the source, seed, field decisions, or destination invalidates the review, the approval, and any proposal.
18. Reality Check failures are shown as fixed explanations with aliases. Raw engine messages stay in a collapsed local-detail view. No failure information is sent to Gemini in Sprint 3.
19. Imported field names, descriptors, and labels are untrusted. The prompt says so, and model output has no execution authority: it must pass `convertProposal` and alias resolution.

SDK transport (App Check tokens, HTTP headers) is not part of the approved application payload and cannot be displayed. That limitation is stated in the UI.

The only cloud entry point is `submitApprovedCloudInference`.

## Sprint 7: second disclosure (blind revision)

A blind revision request (cloud-disclosure 1.2.0) may add only Blind Revision Feedback 1.0.0 to the already-approved twin. It requires its own review and approval, and the UI lists exactly what is newly disclosed. Engine messages, values, source names, bindings, Nano rationales and exact counts above four are never included. See [../contracts/blind-revision-feedback.md](../contracts/blind-revision-feedback.md).

## Sprint 8: semantic findings and approved constraints

A semantic revision request (cloud-disclosure 1.3.0) may add only Blind Revision Feedback 1.1.0 to the approved twin. Every 1.2.0 rule still applies, plus these:

1. **Codes are sent by default.** Semantic findings are fixed codes with operation numbers, disclosed aliases, approved destinations and coarse buckets. They are listed under "Newly disclosed" and need the same explicit approval as every other request.
2. **Constraints need their own opt-in.** A semantic *constraint* is sent only when the user ticks it. Nothing is ticked by default. It may repeat only labels already approved for its alias, destination enum values and fixed date formats. It discloses meaning (an order or a correspondence), never a new label or value.
3. **Never sent, regardless of selection:**
   - the local Semantic Verification Contract;
   - source paths;
   - which records violated a constraint;
   - local-only detail;
   - Nano rationales;
   - unselected constraints;
   - `allowed-values` constraints;
   - "no constraint covers this operation" notes.
4. **Changing the selection invalidates the request.** Ticking or unticking a constraint, or confirming a date order, discards any prepared request and its pending approval. The new request has a new hash.
5. **Ambiguous evidence is never sent as a fact.** It may be sent only as the code `ambiguous-date-interpretation`. A model suggestion is never trusted and never becomes a constraint.
6. **The cumulative ledger.** The review shows request 1 against what request 2 adds: findings, semantic findings, selected constraints, and new labels (always 0).
