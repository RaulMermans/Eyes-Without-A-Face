# Threat model (Sprint 0)

## Assets

- Imported CRM JSON (private)
- Firebase web config (public identifiers)
- App Check debug tokens (private)
- Gemini prompts (must contain only approved Phantom Twin data)

## Adversaries / mistakes

1. Accidental cloud disclosure of private rows.
2. Model-generated JavaScript executed as a mapping.
3. Debug tokens committed to git or baked into `VITE_*`.
4. Automatic on-device → cloud fallback.
5. Export packages that include private fixtures.

## Mitigations in place

- Source contracts are `localOnly: true`.
- Mapping schema and safety walker reject executable fields.
- Export schema requires `includesPrivateSourceFixtures: false`.
- Inference adapters throw instead of returning mock success.
- Application boot does not import the Firebase SDK.
- `.gitignore` excludes `.env.local` and `*.local`.

## Known limitations

- Network-level prompt inspection is not implemented (no live path yet).
- There is no runtime secret scanner beyond gitignore and tests.
- Hosting / App Check production attestation is not configured.
- Data lives in browser memory; a compromised machine can still read it.

See `disclosure-policy.md` and `secret-handling.md`.
