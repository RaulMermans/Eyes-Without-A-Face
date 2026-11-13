import { useEffect, useState } from "react";
import { Disclosure, StatusMark, type Status } from "../components/spectral.tsx";
import type { AppConfig } from "../config/env.ts";
import { listDiagnostics } from "../inference/diagnostics.ts";
import { PREFLIGHT_LIMITATIONS, runtimePreflight, type PreflightStatus } from "../inference/preflight.ts";
import type { InferenceServices, OnDeviceCapability } from "../inference/types.ts";

const TONE: Record<PreflightStatus, Status> = {
  VERIFIED: "pass",
  AVAILABLE: "pass",
  CONFIGURED: "pending",
  UNVERIFIED: "not_evaluated",
  UNAVAILABLE: "warn",
};

/**
 * Compact runtime preflight (Sprint 9, B4). Local probes only: it sends no
 * cloud request and requests no App Check token. Re-derived on every render
 * from config, the local capability probe and this session's diagnostics.
 */
export function RuntimePreflight({ config, inference, refreshKey }: { config: AppConfig; inference: InferenceServices; refreshKey?: unknown }) {
  const [capability, setCapability] = useState<OnDeviceCapability | null>(null);
  useEffect(() => {
    let cancelled = false;
    void inference.onDevice
      .probeCapability()
      .then((value) => {
        if (!cancelled) setCapability(value);
      })
      .catch(() => {
        if (!cancelled) setCapability({ chromeVersion: null, promptApi: "missing", languageModelAvailability: "error", guidance: "The local capability probe failed." });
      });
    return () => {
      cancelled = true;
    };
  }, [inference]);
  const harness = typeof window !== "undefined" && Boolean(window.__EYES_WITHOUT_A_FACE_TEST__);
  void refreshKey;
  const rows = runtimePreflight({ config, capability, harness, diagnostics: listDiagnostics() });
  const summary = rows.map((row) => `${row.label.split(" ")[0]} ${row.status.toLowerCase()}`).join(" · ");
  return (
    <section aria-label="Runtime check" className="border border-rule bg-panel px-4 py-3" data-testid="runtime-preflight">
      <Disclosure summary={<span>Runtime check <span className="ml-2 font-mono text-[11px] font-normal text-mute">{summary}</span></span>}>
        <table className="w-full text-left text-xs">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-rule/60 align-top" data-testid={`preflight-${row.id}`} data-status={row.status}>
                <th scope="row" className="py-1.5 pr-3 font-medium">{row.label}</th>
                <td className="py-1.5 pr-3 font-mono whitespace-nowrap">
                  <StatusMark status={TONE[row.status]}>{row.status}</StatusMark>
                </td>
                <td className="py-1.5 text-mute [overflow-wrap:anywhere]">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[11px] text-mute">
          {PREFLIGHT_LIMITATIONS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-1 text-[11px] text-mute">CONFIGURED means the build is ready, not that the provider is up. VERIFIED appears only after a real result in this session.</p>
      </Disclosure>
    </section>
  );
}
