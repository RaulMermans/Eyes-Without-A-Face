# Phantom Contract

**Kind:** `phantom`  
**Schema version:** `1.0.0`  
**Schema:** `src/domain/contracts/schemas/phantom.v1.schema.json`  
**Generator:** `src/phantom/generate.ts` (`generatePhantomTwin`)

The Phantom Contract is a synthetic representation of the private source structure. It contains aliases, semantic descriptors and synthetic examples, never raw rows. It is still an internal contract: cloud inference only ever receives the allowlisted `CloudDisclosurePayload` projected from it ([cloud-disclosure.md](cloud-disclosure.md)).

## Generation pipeline (Sprint 3)

1. **Profile locally.** `profileRecords` (`src/domain/profile/profile.ts`) works out paths, types, presence, nulls, formats (email, date formats), categories, string shapes and padding or case quirks. It rejects non-JSON values, circular references, prototype keys, depth over 4, more than 250 records, more than 1 MiB and more than 64 fields with structured issues. Arrays, mixed types, all-null fields and non-identifier names are excluded with a warning.
2. **Infer a role.** `inferRole` (`src/phantom/roles.ts`) may read the local field name, but its output is always a label from a fixed vocabulary (identifier, email, organization, person-name, status, date, timestamp, free-text, number, flag, text). Descriptors come from fixed templates plus structural qualifiers such as "may be missing", "values may have surrounding whitespace" or "category labels withheld".
3. **Assign aliases.** Aliases are `f_01 … f_NN`, assigned by a seeded permutation of the sorted path list. They are stable for a given `(seed, field set)`, are unaffected by descriptor or disclosure edits, and do not reveal alphabetical order.
4. **Generate synthetic examples.** Six rows come from fixed fictional vocabularies and `.test` / `.invalid` email domains, generated with a mulberry32 PRNG seeded per `(seed, alias, role, row)`. Rows reproduce cleaning needs (padding, mixed case, an omitted optional value, a null) without copying values. Every string is checked against the local private-value index and regenerated on collision.
5. **Build the contracts.** The Phantom Contract and a `localOnly` Source Contract (opaque `src_NN` ids, real paths, `sensitivity: private`) are produced. Both are validated with Ajv, together with alias uniqueness, binding consistency, the canary check and the collision check (`validateGeneratedTwin`).

The same input and seed produce byte-identical canonical JSON.

## Private bindings

`PrivateBindings` (`src/phantom/bindings.ts`) maps `alias → sourceFieldId → sourcePath`. It is local-only:

- Entries live in an ES private field, so canonical JSON sees no entries and `JSON.stringify` throws.
- `validateBindings` checks that aliases are unique, source paths and ids are unique, every phantom alias is bound, and every binding matches the Source Contract.
- Phantom fields do not carry `sourceFieldId`. `nonShareableSourceFieldIds` holds opaque `src_NN` ids only.

## User decisions (reviewed, local)

Per field, keyed by local path:

- **Describe to Gemini** (`shareable`). When unchecked, the field keeps its alias but is excluded from the disclosure.
- **Disclose category labels.** Off by default. Turning it on puts the observed labels in `enumValues` and in the examples. The UI warns about rare labels.
- **Reviewed descriptor.** Rejected if it repeats a local field name or a private value, contains the canary or control characters, or exceeds 200 characters.

## Disclosure rules

- Must not contain the private-data canary `PRIVATE_CANARY_PII_DO_NOT_SHARE`.
- Shareable fields must not point at source fields with sensitivity `private`. Generated twins never set `sourceFieldId`.
- Source fields listed in `nonShareableSourceFieldIds` must not be marked `shareable: true`.
- `approvedForCloud` is an internal flag only. Cloud requests additionally need request-scoped approval of the exact prompt (`src/twin/authorization.ts`).

## Limitations

A twin is not automatically anonymous. Descriptors (fixed vocabulary), field count, types, formats, optionality, disclosed category labels and identifier shapes (for example `AAAA-999`) are structural information about the private system. The reviewer approves them explicitly.
