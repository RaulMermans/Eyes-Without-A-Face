# Threat model (Sprint 3)

## Assets

- Imported CRM JSON (private)
- Firebase web config (public identifiers)
- App Check debug tokens (private)
- Gemini prompts (must contain only an approved CloudDisclosurePayload and the fixed instruction prefix)

## Adversaries / mistakes

1. Accidental cloud disclosure of private rows or Phantom internal references.
2. Model-generated JavaScript executed as a mapping.
3. Debug tokens committed to git or baked into `VITE_*`.
4. Automatic on-device → cloud fallback.
5. Export packages that include private fixtures.
6. Stale approval reused after the payload changes.
7. Claiming provenance from the requested mode when `inferenceSource` is missing.
8. Executing an approval against a different backend or model.
9. Blind retries after a timeout that may already have reached Gemini.
10. Private field names or values reaching Gemini through aliases, descriptors, synthetic examples, or the destination schema.
11. Prompt injection through imported field names, descriptors, labels, or destination schema text.
12. Model output that smuggles code, unknown ops, prototype keys, undeclared aliases, or unauthorized destination fields into execution.
13. Alias bindings leaking through logs, prompts, telemetry, or exports.
14. Private values echoed by engine error messages.
15. Non-JSON or circular inputs crashing the engine (denial of service and uncontrolled exceptions).

## Mitigations in place

- Source contracts are `localOnly: true`.
- Allowlist projection builds `CloudDisclosurePayload`; unexpected properties fail schema validation.
- Preview builds the exact outbound application prompt **before** approval.
- `submitApprovedCloudInference` is the canonical cloud entry; the live adapter requires a reserved approval and matching effective destination.
- Authorization ledger: unused → in-flight → consumed.
- Mapping schema and safety walker reject executable fields.
- Export schema requires `includesPrivateSourceFixtures: false`.
- Live adapters never label a test-harness result as real AI.
- Application boot does not import the Firebase SDK.
- `.gitignore` excludes `.env`, `.env.local`, and `*.local`.
- Production builds refuse App Check debug mode.
- Cloud generate is not retried.
- Aliases are `f_NN` from a seeded permutation. Descriptors come from a fixed vocabulary or from user text that is checked for local names and values. Synthetic values are collision-checked against the private-value index.
- `PrivateBindings` uses an ES private field and throws on `JSON.stringify`.
- Destination disclosure is a minimal projection inside the fingerprinted payload (cloud-disclosure 1.1.0).
- The gate scans for private values (`PRIVATE_VALUE_PRESENT`) on every preview and bind.
- `convertProposal` rejects and does not repair. Alias resolution validates bindings and re-validates the resolved contract. The engine is unchanged.
- The prompt declares the payload untrusted data. Output is never trusted for execution.
- The Reality Check separates local detail, safe summaries, and a disclosure-shaped summary (codes and aliases only, never sent).
- Workflow telemetry accepts only allowlisted codes, SHA-256 hashes, counts, and durations.
- `inspectJsonValue` guards the profiler and the engine against non-JSON and circular values.

## Known limitations

- App Check debug token registration is a manual Firebase Console step.
- The reCAPTCHA Enterprise site key must be copied by the owner; a placeholder is treated as missing.
- Firebase `AbortSignal` does not cancel the backend request.
- Approval of a synthetic payload is not anonymization.
- Hosting / production attestation is not deployed in this sprint.
- Data lives in browser memory; a compromised machine can still read it.
- The private-value scan uses exact and substring matching of normalized strings of at least 3–4 characters. It does not catch paraphrases or derived values.
- Fixed-vocabulary roles still reveal field semantics. Identifier shapes (character classes and length) and disclosed category labels are structural disclosures that the reviewer must accept.
- Canary tests are evidence for the bundled fixtures, not proof of anonymity.

See `disclosure-policy.md`, `secret-handling.md`, and ADR 0005.
