# Development history — pre-existing work and competition-period work

For the submission's required disclosure. The Official Rules (read 2026-11-13, [hackathon-requirements.md](hackathon-requirements.md)) say an existing project "must have been significantly updated after the start of the Hackathon Submission Period", that entrants "must disclose any other pre-existing code or work incorporated into the Project", and that they "must provide a summary of what you built during the submission period".

## The boundary

The Submission Period opened on **2026-11-11 at 1:30 PM PT = 21:30 UTC = 22:30 CET**. All commits carry their original timestamps (+01:00, the developer's local time). Nothing was rebased or re-dated.

- **Last commit before the period:** `e1d4b03`, 2026-11-11 21:53 CET (merge of PR #5).
- **First commit in the period:** `158dfa6`, 2026-11-11 23:04 CET (Sprint 5).

**Correction (Sprint 12).** Earlier versions of this page said Sprint 3 and Sprint 4 were built in the period, because they share the opening *date*. Measured against the opening *time*, Sprints 0–4 (including the first real Gemini Nano and Gemini Cloud qualification, `HYBRID_QUALIFIED`) were committed **before** the period opened. They are pre-existing work.

## Pre-existing work (before 2026-11-11 21:30 UTC)

| Commit | Date (CET) | Sprint | Work |
| --- | --- | --- | --- |
| `ab8169c` | 11-10 17:42 | 0 | Repository foundation: canonical JSON Schema contracts, test harness, docs |
| `87ede9c`, `45971db` | 11-10 18:07–19:04 | 1, 1.1 | Firebase AI Logic adapters (`ONLY_ON_DEVICE` / `ONLY_IN_CLOUD`), disclosure gate, provenance validation, single-use approval |
| `11ba810` | 11-10 21:32 | 2 | Deterministic eight-operation mapping engine |
| `b8a6d73` | 11-11 19:08 | 3 | Phantom Twin generation, cloud disclosure 1.1.0, proposal conversion, alias resolution, Reality Check, guided UI |
| `0d67a90` | 11-11 21:24 | 4 | Root cause of the on-device blocker, first real Gemini Nano inference, App Check preparation, adversarial privacy tests, license |
| `9a58928` | 11-11 21:50 | 4 | First real Gemini Cloud inference through Firebase AI Logic: `HYBRID_QUALIFIED` |

State at `e1d4b03`: 107 source files, 13,656 lines in `src/`; 50 test files. A working single-page prototype: profile a JSON file, build a Phantom Twin, approve one cloud request, get a Gemini mapping, run it locally.

## Built during the Submission Period (from 2026-11-11 21:30 UTC)

| Commits | Date | Sprint | Work |
| --- | --- | --- | --- |
| `158dfa6`, `2ecd437` | 11-11 23:04 | 5 | On-device crash investigation and bounded user retry; release build that cannot ship App Check debug mode; Hosting/App Check audit; first-use UX; full-history security audit |
| `43dd30e` | 11-12 | 6 | Spectral Forensics redesign: landing, Phantom transformation, Integration Studio |
| `82c6462`, `afb56f7` | 11-12 | 7 | **Blind Integration:** private on-device understanding by Nano, Blind Revision Feedback 1.0.0, one approved blind revision, outcome classes, evaluation scenarios, real-model runs |
| `d7e7cba`…`f3989c8` | 11-12 | 8 | **Semantic verification**, Feedback 1.1.0 / disclosure 1.3.0, deterministic revision decision, frozen holdout, replayable real-model benchmark, Nano ablation |
| `5ac67ec`…`a572cf9` | 11-13 | 9 | **Portable integration export** (Export Contract 1.1.0, bundled engine, Node runner, local bindings, blocking privacy scan), provider-failure classification, fresh-approval recovery, preflight |
| `ce8a5d9`, `0710556` | 11-13 | 10 | **CONNECT / OBSERVE / OUTCOME**, Live Intelligence Runtime, Black Halo identity |
| `a9cf261`, `c92d5d9` | 11-13 | 11 | Compact OBSERVE, Nano before the request, outcome verdict, export hand-off, Privacy Boundary |
| `sprint-12` branch | 11-13 | 12 | **First public deployment** with hosted acceptance on real models, focused Nano-value experiment, business-impact evidence, submission materials |

Measured change since `e1d4b03` (hand-written `src/`, excluding the generated export runtime bundle): **+18,946 / −1,006 lines**, now 31,596 lines; tests 50 → 95 files (538 tests at the Sprint 11 head).

**Summary of what was built in the period:** everything that makes the prototype a product: blind revision, local semantic verification, the deterministic revision decision, the portable executable export, provider-failure handling, the redesigned three-moment experience, the evaluation and benchmark infrastructure, and the public hosted release.

## Tools and third-party code

- Built with AI coding assistants (permitted by the rules as standard development tools).
- Open-source dependencies installed through pnpm. The production dependency tree is permissive: Apache-2.0, MIT, BSD-3-Clause, ISC and 0BSD (`pnpm licenses list --prod`). No copied proprietary code. The emblem's provenance is in [branding/README.md](branding/README.md).
- **Owner to confirm before submitting:** the project received no financial or preferential support from Google or Devpost (Official Rules §6), and the entrant is not employed by a Contest Entity or a government agency (§3).
