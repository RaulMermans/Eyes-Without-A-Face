# Sprint 19 — UX simplification, product polish and README

| Item | Value |
| --- | --- |
| Branch | `sprint-19-ux-polish`, from `main` at `2d3c9d7` (merge of release `65cbf0e`, `PRODUCTION_ACCEPTED`) |
| Release status | **`CODE_READY`**. Not deployed: a deployment needs the owner's approval of the exact SHA ([deployment.md](../deployment.md)) |
| Scope | Presentation, copy, responsive layout and the root README only |
| Unchanged | Mapping semantics, the DSL, the planner and its prompts, disclosure contracts, cloud gating, approval, semantic verification criteria, export integrity, Firebase/App Check configuration, evaluation thresholds |

## What changed

### Three stages over the same five steps

The guided runtime keeps its five steps, gates and test ids. The header now presents them as three stages (`GUIDED_STAGES` in `src/app/experience.ts`, presentation only):

| Stage | Steps (button label) | What the user does |
| --- | --- | --- |
| 1 · Add your data | Your data | Upload a file or try a fictional example |
| 2 · Build & review | Destination · Approve · Review | Choose the destination, approve the one request, review the field matches and answer questions |
| 3 · Check & export | Export | See what was checked and download the results |

- The step caption reads "Step 2 of 3 · Build & review" (derived, never hand-written).
- Each stage is a labelled `role="group"`. Each button's accessible name matches its visible label.
- At phone width, only the current step shows its name. The other steps show a stage number or a dot.

### Copy and hierarchy

- **Header tagline (guided view):** "Build integrations for systems your AI cannot see."
- **Data step:** the heading changes from "Where is your data?" to "Add your data". The new subtitle reads: "Upload a file or try an example. Your original records stay on your device…". Example data is now labelled "Try an example with fictional CRM data".
- **Review → export:** the button reads "Continue to check & export". The step names in the empty states were updated to match.
- **Export step:** a new **"What was checked"** summary sits above the downloads. It shows the counts on your records and the Structure and Meaning rows. These are the same readings shown on Review, never a promotion, plus one line on why a valid shape is not verified meaning.

### Responsive and accessibility fixes

- **Field matches table at phone width.** The "Matched by" column slid off-screen with no sign that it scrolled. It now folds under the source field ("matched by …"), so the Status column stays visible.
- **"Stays on this device" line.** It wrapped as broken flex fragments; it now wraps as normal text.
- **Stage navigation.** A visible `:focus-visible` outline was added.

### README

The README was rewritten as a product landing page:
- problem, the three stages, what makes EYES different, a Mermaid architecture diagram and what crosses the boundary;
- validated evidence, split into deterministic tests, real-model evaluation, production smoke tests and end-to-end semantic correctness (not established);
- known limitations, verified setup commands and environment variables, repository structure, contributing, license and the hackathon disclosure.

The per-sprint status history moved out of the README. It remains in the sprint reports ([index](README.md)).

The screenshots in `docs/design/screenshots/sprint-19/` are real captures of this build: the local dev server, fictional data and the labelled simulated test planner. They are not Gemini output.

## Checks (this tree)

| Check | Result |
| --- | --- |
| lint, typecheck, build | PASS |
| unit | 703 / 703 PASS (1 new: GUI-STAGE-001) |
| contracts / privacy | 100 / 100, 105 / 105 PASS |
| evaluation | 223 PASS, 13 skipped by design (env-gated live scoring) |
| E2E (Playwright, inference disabled) | 176 / 176 PASS, including 4 new (E2E-S19-001…004) |
| README links | every relative link and image resolves; the live demo URL returns HTTP 200 |

The new E2E tests cover:
- **E2E-S19-001:** the three-stage journey on fictional demo data: upload, destination, approval, review with an ambiguous field answered, a partially verified result, and export. The Export check summary must match the Review readings. Stage back-navigation keeps the work.
- **E2E-S19-002:** cloud inference unavailable. Approve is disabled with a reason, and 0 provider requests are made.
- **E2E-S19-003:** 375 px. No horizontal page scroll on any stage, and the folded "matched by" line.
- **E2E-S19-004:** stage buttons are focusable and their accessible names match their visible labels.

The existing suites already cover the remaining scenarios in the brief:
- Gemini Nano unavailable: every E2E run, since on-device is disabled;
- a custom source and destination: E2E-180;
- a verified export: E2E-193.

No real model was called this sprint. Live Gemini quality is unchanged by construction: no AI code changed.

## Not done

- Independent usability sessions and a manual screen-reader pass (still open since Sprint 15).
- No production deployment. Next: the owner reviews the branch and, if wanted, approves deploying its exact SHA. Then run `pnpm build:release` and the production acceptance standard.
