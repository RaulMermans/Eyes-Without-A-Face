# 489c6baaf18b — failed, unrun and noteworthy checks

**Release status: `PRODUCTION_ACCEPTED`.** No production check failed. No critical privacy, mapping, export or security issue was found.

| Item | Kind | Cause | Decision |
| --- | --- | --- | --- |
| First Nano-subset attempt: 3 / 4 harness failures, 0 rows recorded | Harness defect, not product | The QA spec waited for “Next” to be enabled before the app had started holding it; Nano was in fact running (“reading field 9 of 11”, rows labeled real on-device). 0 cloud requests | Fixed in `tests/qa/sprint-16a-nano.spec.ts` (wait for the hold, then its release, as `S14-NANO` does). Re-run 4 / 4 PASS. On-device only; no budget used |
| 62-case matrix: FAIL 4 | Disclosed product limitation | Click-through probes A1-D, C1-D, E1-D and G1-D click “Use …” on every suggestion; four suggestions are wrong (generic name token “id” / “at”). Each wrong field entered by an explicit click; no headline says “Integration ready”; G1-D's package is VERIFIED (structural) | Known since Sprint 16B. No ranking tuning on the benchmark; needs fresh held-out data and a reviewed change |
| 62-case matrix: PARTIAL 7, UNSUPPORTED 8 | Disclosed limitations | Optional fields absent in some records (L1); locale numbers/dates, depth > 4, single-record categories, unusable column names (listed with reasons), arrays | Unchanged; disclosed in README and Devpost |
| No App Check exchange observed during the real hybrid run | Observation | The dedicated Chrome profile reused a still-valid App Check token from minutes earlier; the request succeeded with real `IN_CLOUD` output | Not a failure. Enforcement proven by P-002 (a tokenless request is refused) on this deployment |
| Human usability (≥ 3 developers), manual screen reader | NOT RUN | No participants available to the agent; never simulated | Owner action: [../../sprint-16c/usability/protocol.md](../../sprint-16c/usability/protocol.md), [../../sprint-16c/accessibility/README.md](../../sprint-16c/accessibility/README.md) |
