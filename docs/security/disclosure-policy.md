# Data disclosure policy

1. Private source records never leave the machine for cloud inference.
2. On-device inference may inspect structure. It must not be used as a channel to upload rows.
3. Cloud inference may receive only an approved `CloudDisclosurePayload`: aliases, semantic descriptors, synthetic examples, and safe constraints.
4. A Phantom Contract is never the outbound request. Internal keys such as `sourceFieldId` must not appear in the serialized cloud payload.
5. Fields with sensitivity `private` must appear in `nonShareableSourceFieldIds` and must not be `shareable: true` on the phantom.
6. Diagnostics in validation reports must not echo raw private payloads.
7. Exports include synthetic fixtures only, by default.
8. Approval is bound to the SHA-256 of the exact outbound bytes and a request id. Changing the payload or destination requires a new approval.

Unverified: live Gemini network payloads, because no Firebase project is configured in this environment. Deterministic tests instrument `submitApprovedCloudInference`.
