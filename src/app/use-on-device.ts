import { useCallback, useEffect, useState } from "react";
import type { InferenceServices, OnDeviceCapability } from "../inference/types.ts";
import { recordWorkflowEvent } from "../observability/workflow-log.ts";

export type OnDeviceMode =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "blocked"; reason: string }
  | { kind: "available"; availability: string };

/**
 * On-device capability for the current run (Sprint 11, Workstream C).
 *
 * Lifted out of the Phantom Twin panel so CONNECT can offer on-device
 * interpretation BEFORE the disclosure is prepared. The probe is a local
 * capability check (`LanguageModel.availability()`), never inference, and it
 * runs once per loaded source so the runtime reads it from this run's events.
 * It never starts a model, never sends anything and never falls back to the
 * cloud. `markBlocked` records a non-recoverable on-device failure for the
 * rest of the run.
 */
export function useOnDeviceProbe(inference: InferenceServices, runKey: unknown): { mode: OnDeviceMode; markBlocked: (reason: string) => void } {
  // The result is stored with the run it belongs to; another run reads as "checking" until its own probe answers.
  const [result, setResult] = useState<{ key: unknown; mode: OnDeviceMode } | null>(null);
  const mode: OnDeviceMode = !runKey ? { kind: "idle" } : result && result.key === runKey ? result.mode : { kind: "checking" };
  const setMode = useCallback((next: OnDeviceMode) => setResult({ key: runKey, mode: next }), [runKey]);

  useEffect(() => {
    if (!runKey) return;
    let cancelled = false;
    const status = inference.onDevice.status();
    void inference.onDevice
      .probeCapability()
      .then((capability: OnDeviceCapability) => {
        if (cancelled) return;
        const availability = capability.languageModelAvailability ?? "unknown";
        const usable = capability.promptApi === "available" && (availability === "available" || availability === "downloadable");
        const next: OnDeviceMode =
          status.state !== "configured"
            ? { kind: "blocked", reason: status.state === "disabled" ? "feature flag off" : "Firebase config missing" }
            : usable
              ? { kind: "available", availability }
              : { kind: "blocked", reason: `Prompt API ${capability.promptApi}, model ${availability}` };
        setMode(next);
        recordWorkflowEvent({ kind: "on-device-probe", ok: next.kind === "available", code: next.kind === "available" ? "ON_DEVICE_AVAILABLE" : "ON_DEVICE_BLOCKED" });
      })
      .catch(() => {
        if (!cancelled) setMode({ kind: "blocked", reason: "capability probe failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [inference, runKey, setMode]);

  const markBlocked = useCallback((reason: string) => setMode({ kind: "blocked", reason }), [setMode]);
  return { mode, markBlocked };
}
