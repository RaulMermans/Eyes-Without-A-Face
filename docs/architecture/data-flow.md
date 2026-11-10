# Data-flow boundaries

Private source data never travels the same path as cloud prompts.

```text
Browser session (no backend)
│
├─ Local only
│  ├─ JSON import (Sprint 1)
│  ├─ Source Contract
│  ├─ On-device interpretation (ONLY_ON_DEVICE)
│  ├─ Mapping execution / verification
│  └─ Export package (synthetic fixtures only)
│
└─ Cloud (after human approval)
   └─ Approved Phantom Contract → Gemini via Firebase AI Logic (ONLY_IN_CLOUD)
```

## What may leave the machine

- Phantom field aliases and semantic descriptors
- Synthetic example records
- Disclosure constraints
- Declarative mapping proposals returned from the model

## What must not leave the machine

- Raw source JSON
- Fields with sensitivity `private`
- Private-data canary `PRIVATE_CANARY_PII_DO_NOT_SHARE`
- App Check debug tokens
- Service-account credentials (not used in this MVP)

## Fallback policy

If on-device inference is unavailable, the product reports unavailable. It does not automatically call Gemini. If cloud inference is unconfigured, mapping proposal stays disabled. There is no second provider.
