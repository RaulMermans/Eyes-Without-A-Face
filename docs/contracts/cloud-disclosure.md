# Cloud Disclosure Payload

**Kind:** `cloud-disclosure`  
**Schema versions:** `1.0.0` (diagnostic payload), `1.1.0` (Phantom Twin mapping requests, adds `target`)  
**Schemas:** `src/domain/contracts/schemas/cloud-disclosure.v1.schema.json`, `cloud-disclosure.v1.1.schema.json`

Outbound application payload for cloud inference. It is **not** a Phantom Contract.

## Construction

`projectCloudDisclosurePayload` copies only allowlisted fields from a Phantom Twin:

- `phantomId`
- entity `id`, `label`, `description`
- shareable field `alias`, `entityId`, `type`, `semanticDescriptor`, `enumValues`
- synthetic example values keyed by those aliases
- `disclosureConstraints`
- destination (`firebase-ai-logic` / `google-ai` / model / `mapping-proposal`)
- at most 8 synthetic examples
- 1.1.0 only: `target.fields[]` with `name`, `type`, `required`, `nullable`, `format`, and `enumValues`, produced by `describeTargetSchema` from the destination JSON Schema. Titles, descriptions, `$id`, defaults, and unsupported constructs (`$ref`, `oneOf`, arrays) are dropped and listed as local notes ([ADR 0007](../decisions/0007-target-disclosure-and-proposal-boundary.md))

It does not clone the Phantom Contract and then delete keys. Internal references such as `sourceFieldId`, `sourceDatasetId`, and `nonShareableSourceFieldIds` are never copied.

`additionalProperties` is false. Unexpected keys fail schema validation.

## Authorization

1. Canonical JSON (sorted keys) of the payload bytes.
2. SHA-256 fingerprint of those bytes.
3. Exact outbound application prompt (fixed instructions + canonical JSON), fingerprinted separately. 1.1.0 uses the mapping-proposal instructions in `src/inference/prompts.ts`, which declare the payload untrusted data.
4. Human approval bound to `requestId` + `payloadHash` + `outboundHash` + destination + purpose.
5. `submitApprovedCloudInference` is the only cloud entry point. Approvals are single-use.
6. The runtime destination must be `firebase-ai-logic:google-ai:gemini-3.5-flash-lite:mapping-proposal`.

Phantom `approvedForCloud: true` is not sufficient to send data.

## Private-value scan

`inspectDisclosurePayload` also runs `findPrivateValueLeaks` (`src/privacy/leak-scan.ts`) against the in-memory index of the imported dataset's string values. It rejects `PRIVATE_VALUE_PRESENT` if a descriptor, entity, constraint, or synthetic example reproduces a private value. The only exception is category labels the user explicitly approved for disclosure, and only for that same alias. The index lives in module memory only and is cleared when the source is removed.

## Honest limitation

Approval of a synthetic payload is not anonymization. Aliases, constraints, rare values, and error text can still reveal information about a private system.
