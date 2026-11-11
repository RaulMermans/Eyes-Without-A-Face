# Cloud Disclosure Payload

**Kind:** `cloud-disclosure`  
**Schema version:** `1.0.0`  
**Schema:** `src/domain/contracts/schemas/cloud-disclosure.v1.schema.json`

Outbound application payload for cloud inference. It is **not** a Phantom Contract.

## Construction

`projectCloudDisclosurePayload` copies only allowlisted fields from a Phantom Twin:

- `phantomId`
- entity `id`, `label`, `description`
- shareable field `alias`, `entityId`, `type`, `semanticDescriptor`, `enumValues`
- synthetic example values keyed by those aliases
- `disclosureConstraints`
- destination (`firebase-ai-logic` / `google-ai` / model / `mapping-proposal`)

It does not clone the Phantom Contract and then delete keys. Internal references such as `sourceFieldId`, `sourceDatasetId`, and `nonShareableSourceFieldIds` are never copied.

`additionalProperties` is false. Unexpected keys fail schema validation.

## Authorization

1. Canonical JSON (sorted keys) of the payload bytes.
2. SHA-256 fingerprint of those bytes.
3. Human approval bound to `requestId` + `payloadHash` + destination + purpose.
4. `submitApprovedCloudInference` is the only cloud entry point.

Phantom `approvedForCloud: true` is not sufficient to send data.

## Honest limitation

Approval of a synthetic payload is not anonymization. Aliases, constraints, rare values, and error text can still reveal information about a private system.
