# Data-flow boundaries

Private source data never travels the same path as cloud prompts.

```text
Browser session (no backend)
│
├─ Local only
│  ├─ JSON import (not implemented)
│  ├─ Source Contract
│  ├─ On-device interpretation (ONLY_ON_DEVICE)
│  ├─ Mapping execution / verification (not implemented)
│  └─ Export package (synthetic fixtures only)
│
└─ Cloud (after request-scoped human approval)
   └─ CloudDisclosurePayload → Gemini via Firebase AI Logic (ONLY_IN_CLOUD)
```

## What may leave the machine

- Phantom field aliases and semantic descriptors (allowlisted)
- Synthetic example records for those aliases
- Disclosure constraints
- Declarative mapping proposals returned from the model

## What must not leave the machine

- Raw source JSON
- Phantom `sourceFieldId` / `sourceDatasetId` / `nonShareableSourceFieldIds`
- Fields with sensitivity `private`
- Private-data canary `PRIVATE_CANARY_PII_DO_NOT_SHARE`
- App Check debug tokens
- Service-account credentials (not used in this MVP)

## Fallback policy

If on-device inference is unavailable, the product reports unavailable. It does not automatically call Gemini. If cloud inference is unconfigured, mapping proposal stays disabled. There is no second provider.

## Disclosure honesty

Approval of a synthetic payload is not proof of anonymization. Aliases, constraints, rare values, metadata, and error text may still reveal information.
