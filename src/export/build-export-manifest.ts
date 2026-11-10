import type { ExportContract } from "../domain/contracts/types.ts";
import { CURRENT_CONTRACT_SCHEMA_VERSION } from "../domain/contracts/kinds.ts";

export interface ExportManifestInput {
  exportId: string;
  mappingId: string;
  mappingVersion: string;
  validationReportRef: string;
  syntheticFixtureRefs: string[];
  knownLimitations: string[];
  minAppVersion?: string;
}

export function buildExportManifest(input: ExportManifestInput): ExportContract {
  return {
    contractKind: "export",
    schemaVersion: CURRENT_CONTRACT_SCHEMA_VERSION,
    exportId: input.exportId,
    mappingId: input.mappingId,
    mappingVersion: input.mappingVersion,
    runtime: {
      engine: "phantom-twin-mapping",
      minAppVersion: input.minAppVersion ?? "0.1.0",
    },
    syntheticFixtureRefs: input.syntheticFixtureRefs,
    validationReportRef: input.validationReportRef,
    includesPrivateSourceFixtures: false,
    knownLimitations: input.knownLimitations,
  };
}
