# Source Contract

**Kind:** `source`  
**Schema version:** `1.0.0`  
**Schema:** `src/domain/contracts/schemas/source.v1.schema.json`

Describes the structure of a locally imported JSON dataset. It is inventory and sensitivity metadata, not a shareable payload.

## Required fields

- `contractKind`: `source`
- `schemaVersion`: `1.0.0` (other versions are rejected)
- `datasetId`
- `localOnly`: always `true`
- `fields[]` with `id`, `path`, `type`, `required`, `sensitivity`

## Sensitivity

| Value | Meaning |
| --- | --- |
| `private` | Must not appear as a shareable phantom field |
| `internal` | Local operational field; not for cloud by default |
| `synthetic-ok` | Structure may be reflected on an approved Phantom Twin |

`localOnlyMetadata` may store original column names and notes. That object is local-only.

## Unsupported

- Schema versions other than `1.0.0`
- Empty `fields`
- `enum` types without `enumValues`
