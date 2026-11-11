import type { ProposalOrigin } from "../proposal/convert.ts";
import type { InferenceResult } from "../inference/types.ts";

export function resultKindLabel(result: InferenceResult): string {
  switch (result.provenance.resultKind) {
    case "real-on-device":
      return "Real on-device result";
    case "real-cloud":
      return "Real cloud result";
    case "simulated-test":
      return "Simulated test result";
    case "unavailable":
      return "Unavailable model";
    case "failed":
      return "Failed inference";
  }
}

export const ORIGIN_LABELS: Record<ProposalOrigin, string> = {
  "gemini-cloud": "Real Gemini output · IN_CLOUD",
  "test-adapter": "Simulated test adapter — not Gemini",
  "manual-edit": "Manually edited locally — not model output",
};
