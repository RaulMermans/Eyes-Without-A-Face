# Security

Do not file public issues that include private CRM samples, App Check debug tokens, or live Firebase secrets.

## Reporting

Email or a GitHub private vulnerability report on this repository. Do not paste production credentials into tickets.

## Product rules

Private source JSON stays in the browser session. Cloud Gemini may receive an approved Phantom Twin only. Mapping execution is local. Exports omit private fixtures by default.

Details: [docs/security/threat-model.md](docs/security/threat-model.md), [docs/security/disclosure-policy.md](docs/security/disclosure-policy.md), [docs/security/secret-handling.md](docs/security/secret-handling.md).
