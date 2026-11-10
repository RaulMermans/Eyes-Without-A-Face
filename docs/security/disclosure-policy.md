# Data disclosure policy

1. Private source records never leave the machine for cloud inference.
2. On-device inference may inspect structure. It must not be used as a channel to upload rows.
3. Cloud inference may receive only an approved `CloudDisclosurePayload` plus the fixed mapping-proposal instructions shown in the diagnostic workspace.
4. A Phantom Contract is never the outbound request. Internal keys such as `sourceFieldId` must not appear in the serialized cloud payload.
5. Fields with sensitivity `private` must appear in `nonShareableSourceFieldIds` and must not be `shareable: true` on the phantom.
6. Diagnostics in validation reports must not echo raw private payloads.
7. Exports include synthetic fixtures only, by default.
8. Approval is bound to SHA-256 of the disclosure bytes, SHA-256 of the exact outbound application prompt, destination, purpose, and request id.
9. Each approval is single-use. Missing, stale, modified, destination-mismatched, reused, or concurrent submissions are rejected.
10. Synthetic data is not inherently anonymous. Field names, constraints, rare categories, and error text can still leak information about a private system.

SDK transport (App Check tokens, HTTP headers) is not part of the approved application payload and cannot be displayed. That limitation is stated in the UI.

The only cloud entry point is `submitApprovedCloudInference`.
