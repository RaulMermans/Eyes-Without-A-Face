# Data-flow boundaries

Private source data never travels the same path as cloud prompts.

```text
Browser session (no backend)
│
├─ Local only
│  ├─ JSON import (session memory)
│  ├─ Source profile + Source Contract
│  ├─ Phantom Twin generation + PrivateBindings
│  ├─ On-device role suggestions (ONLY_ON_DEVICE, synthetic samples only)
│  ├─ Proposal conversion + alias resolution
│  ├─ Mapping execution / verification (`executeMapping`)
│  └─ Export package (synthetic fixtures only)
│
└─ Cloud (after request-scoped human approval)
   └─ CloudDisclosurePayload → Gemini via Firebase AI Logic (ONLY_IN_CLOUD)
```

## What may leave the machine

- Phantom field aliases (`f_NN`) and semantic descriptors (allowlisted)
- Synthetic example records for those aliases (at most 8)
- Category labels the user explicitly opted in to disclose
- Disclosure constraints
- Minimal destination description (names, types, required, nullable, format, enum)
- Declarative mapping proposals returned from the model

## What must not leave the machine

- Raw source JSON and reserved hidden cases
- Original field names and alias bindings
- Dataset label
- Raw engine diagnostics (may quote private values)
- Destination schema titles and descriptions
- Phantom `sourceFieldId` / `sourceDatasetId` / `nonShareableSourceFieldIds`
- Fields with sensitivity `private`
- Private-data canary `PRIVATE_CANARY_PII_DO_NOT_SHARE`
- App Check debug tokens
- Service-account credentials (not used in this MVP)

## Fallback policy

If on-device inference is unavailable, the product reports unavailable. It does not automatically call Gemini. If cloud inference is unconfigured, mapping proposal stays disabled. There is no second provider.

## Disclosure honesty

Approval of a synthetic payload is not proof of anonymization. Aliases, constraints, rare values, metadata, and error text may still reveal information.
