# Sprint 4 readiness

Do not start Sprint 4 automatically.

## Where Sprint 3 leaves the product

| Question | Answer |
| --- | --- |
| Does the controlled-disclosure workflow work end to end? | Yes, locally and in deterministic Playwright, with a labeled test adapter standing in for Gemini. |
| Can real Gemini proposals drive local execution? | The path is implemented and is identical for real and simulated output (same gate, conversion, resolution and engine). It is **not yet proven live**: App Check returns 403. |
| Is hidden-case verification trustworthy? | For the bundled fixtures, yes. Reserved cases are never profiled or disclosed. `vip_customer` produces a real `UNMAPPED_ENUM` from the unchanged engine, and the value appears only in local detail. Trust beyond the fixtures needs more reserved cases per field type. |
| Can a bounded correction / retest loop be built? | Yes, on the existing pieces: `disclosureSummary()` already produces code + operation index + alias without values. A correction request must be a new 1.1.0-style payload (or a versioned extension) with its own exact-prompt approval. It must never auto-send failures. |

## Blockers before export and release

1. **App Check debug token** (owner): register a UUID token and qualify LIVE-004 and LIVE-009 with `EYES_APPCHECK_DEBUG_TOKEN`.
2. **GitHub repository** (owner): the remote is missing (404). Restore it, push the stacked branches, open PRs, and observe real Actions runs.
3. **On-device**: still `ON_DEVICE_BLOCKED` on Chrome 157 Linux (`LanguageModel.availability() = unavailable`). Retest on Chrome desktop hardware that reports `available` or `downloadable`. Without it the submission is not `HYBRID_QUALIFIED`.
4. **Official Rules**: unverified (HTTP 403 to automated fetches). Confirm originality, pre-existing code, deliverables and license terms.
5. **Export**: the ZIP package is not implemented. The manifest schema exists (`includesPrivateSourceFixtures: false`).

## Suggested Sprint 4 scope (for the owner to confirm)

- One bounded correction cycle:
  - safe failure summary;
  - reviewed and approved correction prompt;
  - re-validate, re-resolve, re-run;
  - a hard cap of one cycle with no automatic loop.
- Emit a `ValidationContract` from the Reality Check, with safe diagnostics only.
- More reserved hidden cases (date format drift, padded enum, missing required).
- Portable export from mapping + synthetic fixtures + validation report.
