# c7220768bed9 — failed, unrun and noteworthy checks

**Release status: `PRODUCTION_ACCEPTED`.** No mandatory check failed. No critical privacy, mapping, export or security issue was found. No rollback was needed or performed.

| Item | Kind | Detail | Decision |
| --- | --- | --- | --- |
| First identity read after the deploy | Observation | For under 30 s, `build-info.json` and `index.html` were still the previous release (edge cache); the 29 hashed assets already matched | Re-checked: 31 / 31 files identical to the artifact. Not a failure |
| 62-case matrix: FAIL 4, PARTIAL 7, UNSUPPORTED 8 | Disclosed limitations | Unchanged from production `489c6ba` (0 discrepancies): click-through probes that explicitly accept wrong suggestions; the optional-field limit; locale formats, depth, arrays, unusable column names | Disclosed in README and Devpost |
| DRAFT export of an incomplete mapping | Disclosed limitation | Still offered behind the DRAFT confirmation (export eligibility unchanged) | Sprint 17A report § 6 |
| Human usability (≥ 3 developers), manual screen reader | NOT RUN | No participants available to the agent; never simulated | Owner action: Sprint 16C protocols |
