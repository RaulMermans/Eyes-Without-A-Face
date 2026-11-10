# Data disclosure policy

1. Private source records never leave the machine for cloud inference.
2. On-device inference may inspect structure. It must not be used as a channel to upload rows.
3. Cloud inference may receive an approved Phantom Contract: aliases, semantic descriptors, synthetic examples, and safe constraints.
4. Fields with sensitivity `private` must appear in `nonShareableSourceFieldIds` and must not be `shareable: true` on the phantom.
5. Diagnostics in validation reports must not echo raw private payloads.
6. Exports include synthetic fixtures only, by default.

Unverified: actual network payloads, because live inference is not implemented.
