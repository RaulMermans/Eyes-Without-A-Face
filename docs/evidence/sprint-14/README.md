# Sprint 14 evidence — real-model runs

All runs: fictional CRM demo (JSON), guided UI on `http://127.0.0.1:5174` (code of this branch at the time of the run), Gemini `gemini-3.5-flash-lite` through Firebase AI Logic with the registered local App Check debug token. Gemini Nano runs used the dedicated Chrome profile. Request bodies were scanned for private terms; none were stored.

## Inference ledger

**Declared cap: 6 cloud requests. Used: 7 — the cap was exceeded by one** (a counting error before S14-REC-3; reported, not hidden).

| # | Run | File | Requests | Result |
| --- | --- | --- | --- | --- |
| 1–3 | S14-DIAG helpdesk / billing / marketing (pre-fix code) | [guided-diagnosis.json](guided-diagnosis.json) | 3 | helpdesk and marketing refused (`INVALID_ENUM_MAPPING`, placeholders); billing accepted |
| 4–5 | S14-REC-1 helpdesk: send without names, then share and re-approve | [guided-recovery.json](guided-recovery.json) | 2 | first refused, diagnosed `withheld-categories`, no identical retry offered; second: 3/3 transformed, export `node run.mjs verify` exit 0 |
| 6 | S14-REC-2 marketing, names shared before sending | [guided-recovery.json](guided-recovery.json) | 1 | 3/3 transformed |
| 7 | S14-REC-3 hybrid (Nano + cloud) | [guided-recovery.json](guided-recovery.json) | 1 | cloud 3/3 transformed, export exit 0; **test FAILED**: the result said Nano "available, not used" because "Next" was allowed while Nano was still running. Product fix: Next is held during on-device analysis |
| — | S14-NANO on-device qualification after the fix | [guided-recovery.json](guided-recovery.json) | **0** | 6 fields interpreted by real Gemini Nano in 15.5 s, Next held while running, runtime stage `completed` |

Every outcome above is REAL (real Gemini output, `IN_CLOUD` provenance shown in the UI; real Nano). Each guided outcome was "Draft — not fully verified": structure passed, meaning not verified (no trusted constraints in the guided flow).

`a548d7f` production checks: [../production/a548d7fbd7b8/](../production/a548d7fbd7b8/).
