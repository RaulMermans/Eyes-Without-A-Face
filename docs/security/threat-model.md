# Threat model (Sprint 1)

## Assets

- Imported CRM JSON (private)
- Firebase web config (public identifiers)
- App Check debug tokens (private)
- Gemini prompts (must contain only an approved CloudDisclosurePayload)

## Adversaries / mistakes

1. Accidental cloud disclosure of private rows or Phantom internal references.
2. Model-generated JavaScript executed as a mapping.
3. Debug tokens committed to git or baked into `VITE_*`.
4. Automatic on-device → cloud fallback.
5. Export packages that include private fixtures.
6. Stale approval reused after the payload changes.

## Mitigations in place

- Source contracts are `localOnly: true`.
- Allowlist projection builds `CloudDisclosurePayload`; unexpected properties fail schema validation.
- `submitApprovedCloudInference` is the canonical cloud entry; adapters require a matching approval envelope.
- Mapping schema and safety walker reject executable fields.
- Export schema requires `includesPrivateSourceFixtures: false`.
- Live adapters never label a test-harness result as real AI.
- Application boot does not import the Firebase SDK.
- `.gitignore` excludes `.env.local` and `*.local`.
- Production builds refuse App Check debug mode.

## Known limitations

- Live Gemini / on-device proof is blocked in this environment (no Firebase project; on-device model `unavailable`).
- Approval of a synthetic payload is not anonymization.
- There is no runtime secret scanner beyond gitignore and tests.
- Hosting / production App Check attestation is not configured.
- Data lives in browser memory; a compromised machine can still read it.

See `disclosure-policy.md` and `secret-handling.md`.
