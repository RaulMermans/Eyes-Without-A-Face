# Threat model (Sprint 1.1)

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

## Known limitations

- App Check debug token registration is a manual Firebase Console step.
- The reCAPTCHA Enterprise site key must be copied by the owner; a placeholder is treated as missing.
- Firebase `AbortSignal` does not cancel the backend request.
- Approval of a synthetic payload is not anonymization.
- Hosting / production attestation is not deployed in this sprint.
- Data lives in browser memory; a compromised machine can still read it.

See `disclosure-policy.md`, `secret-handling.md`, and ADR 0005.
