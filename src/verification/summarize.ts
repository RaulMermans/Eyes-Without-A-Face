import type { ValidationContract } from "../domain/contracts/types.ts";

export interface VerificationSummary {
  mappingVersion: string;
  total: number;
  passed: number;
  failed: number;
  failureCodes: string[];
}

export function summarizeValidation(report: ValidationContract): VerificationSummary {
  const failed = report.results.filter((result) => result.status === "fail");
  return {
    mappingVersion: report.mappingVersion,
    total: report.results.length,
    passed: report.results.length - failed.length,
    failed: failed.length,
    failureCodes: failed
      .map((result) => result.failureCode)
      .filter((code): code is NonNullable<typeof code> => Boolean(code)),
  };
}
