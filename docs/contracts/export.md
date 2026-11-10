# Export Contract

**Kind:** `export`  
**Schema version:** `1.0.0`  
**Schema:** `src/domain/contracts/schemas/export.v1.schema.json`

Manifest for a portable integration package.

## Required fields

- `exportId`, `mappingId`, `mappingVersion`
- `runtime.engine`: `phantom-twin-mapping`
- `runtime.minAppVersion`
- `syntheticFixtureRefs[]`
- `validationReportRef`
- `includesPrivateSourceFixtures`: **must be `false`**
- `knownLimitations[]`

`buildExportManifest` in `src/export/build-export-manifest.ts` always sets `includesPrivateSourceFixtures: false`. Manifests that try to pack private source fixtures fail validation.
