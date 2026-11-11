# Security

- [threat-model.md](threat-model.md)
- [disclosure-policy.md](disclosure-policy.md)
- [secret-handling.md](secret-handling.md)
- [../setup/app-check.md](../setup/app-check.md)

GitHub private-vulnerability reports: see root [SECURITY.md](../../SECURITY.md).

## Security model in one page

**What the product guarantees** (each claim is enforced in code and covered by tests):

1. Raw source records, original field names and alias bindings stay in the browser tab. Nothing is persisted, and there is no backend.
2. Cloud inference receives only a `CloudDisclosurePayload` built by allowlist projection, as one exact application prompt that you approved by SHA-256. One approval authorizes one request. A changed prompt, destination or request id invalidates it. Timed-out cloud calls are never retried.
3. Firebase AI Logic runs in `ONLY_ON_DEVICE` or `ONLY_IN_CLOUD`, never `PREFER_*`, so private-data steps never fall back to the cloud. When a model is unavailable, the app says so and offers the labeled manual path.
4. Model output is data. Proposals must pass the canonical Mapping Contract (eight-operation allowlist) and alias resolution. They are rejected, never repaired. No model-generated code executes.
5. Provenance comes from the SDK's `inferenceSource`, never from the requested mode. Simulated test-adapter and manual results are labeled as such.

**What it does not claim:**

- A Phantom Twin is **not anonymization**. Aliases, field counts, value formats, descriptors, disclosed category labels and the destination schema can reveal structure or meaning. You review the exact payload for that reason.
- The product controls the **application payload only**. The Firebase SDK adds App Check tokens, Firebase installation and transport metadata, and normal HTTP headers. Google sees the network connection like any web request.
- A SHA-256 binds an approval to a prompt. It does not prove that the prompt is harmless or anonymous.

## Release controls (Sprint 5)

- `pnpm build:release` + `scripts/verify-release.mjs`: production mode, App Check debug off, correct Firebase project, no debug token, no source maps or `.env` files, no credential patterns, and the Git SHA stamped.
- App Check enforcement for Firebase AI Logic (`firebaseml.googleapis.com`) is ON. The reCAPTCHA key is restricted to the two Hosting domains.
- CI runs only deterministic suites. Live Gemini and debug-token tests are opt-in and local.

## Pre-publication audit (2026-11-11, all 11 reachable commits)

| Check | Result |
| --- | --- |
| `.env*` (other than `.env.example`), keys, service accounts, traces, archives, logs, `test-results` ever committed | None |
| Private-key blocks, service-account JSON, GitHub/Slack/AWS/OpenAI tokens, Google OAuth tokens | 0 matches in history |
| The registered App Check debug token value | 0 matches in history (compared against the private file; the value was never printed) |
| UUID-shaped strings at `HEAD` | 0 |
| Firebase web API key | Present in `docs/setup/firebase.md` since `45971db`. A public browser identifier, protected by App Check enforcement. Key restrictions could not be inspected (API Keys API disabled). Owner to review them in Cloud Console before publishing |
| Fictional data only | Bundled CRM, edge cases and screenshots are synthetic (`example.com`, `PRIVATE_CANARY_PII_DO_NOT_SHARE` canary) |
| Largest blobs | Emblem PNG (642 KB) and two demo screenshots |
| Commit author metadata | All commits carry the owner's personal email address. It becomes public with the repository (owner decision) |
| Emblem rights | Owner-supplied artwork without embedded metadata. The owner must confirm the right to publish it ([../branding/README.md](../branding/README.md)) |
