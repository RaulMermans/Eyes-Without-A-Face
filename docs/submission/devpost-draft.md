# Devpost submission draft — Eyes Without a Face

**Status: DRAFT. Not submitted.** Before submitting: read the Official Rules in a browser, publish the repository (owner decision), record and upload the video, and replace every `TODO` below. Do not invent URLs.

- **Tagline:** Build for systems your AI cannot see.
- **Repository:** TODO, once public: `https://github.com/RaulMermans/Eyes-Without-A-Face`
- **Hosted demo:** TODO, only after an approved and verified Hosting deployment
- **Video (YouTube, ≤ 3:00):** TODO, only after it exists

---

## Inspiration / the problem

Developers integrating enterprise systems constantly hit the same wall: a cloud model could write the integration in seconds, but the data it would need to see (customer records, internal notes, account states) is exactly the data that must not leave the company. So the AI either gets the data anyway ("just paste a few rows") or doesn't get used at all.

## What it does

Eyes Without a Face lets Gemini design a data mapping for a private system **without being shown that system's records**, and then proves the mapping locally.

1. You load a private JSON export. It is profiled by deterministic code in the browser.
2. The app builds a **Phantom Twin**: every field becomes a meaningless alias (`f_01`…) with fictional example values. **Gemini Nano runs on-device** through Firebase AI Logic and classifies the twin's fields.
3. You see the **exact application prompt** that would go to the cloud, with its SHA-256, and approve that one request.
4. **Gemini in the cloud** proposes a declarative mapping over aliases, from an eight-operation allowlist. It cannot execute code.
5. Back in the browser, a **Reality Check** validates the proposal, resolves aliases to the real fields, and runs it against the real records **and against reserved hidden cases the model never saw**.

In the demo, Gemini's mapping transforms all 3 imported records correctly, and 0 of 3 hidden cases are covered: an unseen status value, a non-string email and a null email. That gap is found before production, without showing the model the data.

## Who it is for

Developers and technical teams building integrations, migrations and ETL against private enterprise systems (CRMs, helpdesks, billing), especially in regulated settings where raw records cannot be sent to a third-party model.

## How we built it: the hybrid AI

| Where | What runs | Firebase AI Logic |
| --- | --- | --- |
| On-device | Gemini Nano classifies the twin's fields from synthetic samples. Output is constrained by a JSON Schema `responseConstraint` and validated | `InferenceMode.ONLY_ON_DEVICE` (Chrome Prompt API) |
| Cloud | Gemini (`gemini-3.5-flash-lite`, Gemini Developer API) proposes the mapping from the approved payload, with structured JSON output | `InferenceMode.ONLY_IN_CLOUD`, App Check (reCAPTCHA Enterprise) enforced |
| Local, deterministic | Profiling, twin generation, approval binding, contract validation, alias resolution, mapping execution, Reality Check | — |

We deliberately do **not** use `PREFER_ON_DEVICE` / `PREFER_IN_CLOUD`. An automatic fallback would quietly move a private-data step to the cloud, so each step runs in exactly one mode, and an unavailable model is shown as unavailable. Provenance comes from the SDK's reported `inferenceSource`, never from the mode we asked for.

## Technical architecture: why deterministic code executes the model's proposal

The model proposes **data**, not code: a mapping contract in a small DSL (`copy`, `rename`, `trim`, `normalize_email`, `parse_date`, `map_enum`, `default_if_missing`, `concat`). Every proposal must pass the canonical JSON Schema 2020-12 Mapping Contract and alias checks. Invalid output is rejected, never repaired. A deterministic interpreter then executes it. The result is reproducible and auditable, and a prompt-injected or hallucinated proposal can at worst be *refused*.

Stack: TypeScript (strict), React + Vite, Ajv, Zod, Firebase JS SDK 13.2 (`firebase/ai`, App Check), Firebase Hosting, Vitest + fast-check, Playwright.

## Privacy model

- **Stays local:** source records, original field names, alias bindings, dataset name, reserved hidden cases, failure values.
- **Disclosed after approval:** aliases, generated descriptors, fictional example values, category labels you explicitly choose to disclose, a minimal destination description.
- **Approval:** bound to the SHA-256 of the exact outbound prompt, the destination model and one request id. One approval authorizes one request.
- **Limitations, stated plainly:** a Phantom Twin reduces disclosure; it is **not anonymization**. Structure, formats, field counts and disclosed labels can still reveal information. We control the application payload; the Firebase SDK still adds App Check tokens and normal transport metadata.

## Results and evidence

- Real on-device inference: `inferenceSource = ON_DEVICE`, schema-valid, with zero cloud requests during the on-device step.
- Real cloud inference: `inferenceSource = IN_CLOUD`. Gemini's proposal passed strict validation unchanged and matched the reference mapping.
- Privacy: a live scan of the real `generateContent` request body found **0** private terms. Deterministic privacy suites include canaries, prompt-injection field names and adversarial failure messages.
- Reliability: we found that Chrome's on-device model service occasionally crashes on our Linux/AMD test machine (SIGILL in the model-service process). The app classifies it honestly, offers one user-initiated retry that resumes where it stopped, and never falls back to the cloud. Measured results: TODO, copy from `docs/sprints/sprint-5.md`.
- Tests: TODO, final counts from `pnpm test:all` (unit, contract, privacy, Playwright E2E), plus the opt-in live suite.

## Challenges

- Playwright's default Chrome flags silently disable the Gemini Nano component. Finding that turned "on-device unavailable" into real on-device inference.
- The first real Gemini call exposed a bug in our own response schema: Gemini could only emit empty params. We fixed the schema, not the validator.
- A live-test trace captured an App Check debug token, which we found and closed. A production build on a developer machine would also have shipped App Check debug mode, so `build:release` now makes that impossible.

## What we learned

Hybrid AI is most useful when each side does what it is trusted to do: the on-device model may look at things the cloud must not, the cloud model reasons over what you approved, and deterministic code keeps the final say.

## What's next

A bounded correction cycle (a safe failure summary, approved like any other disclosure), portable export of the mapping and synthetic fixtures, and more reserved hidden cases per field type.

## Development history (competition period)

Sprints 0–2 (contracts, Firebase adapters, mapping engine) are dated 2026-11-10, before the submission period opened. The Phantom Twin workflow, real on-device and cloud qualification, and the Sprint 5 release work were done from 2026-11-11 onward. Details: [../hackathon-history.md](../hackathon-history.md). TODO: confirm against the Official Rules how pre-existing work must be declared.

## Try it

- `pnpm install && pnpm dev`. The full walkthrough works without any Firebase configuration, with AI steps shown as unavailable, never simulated.
- Full hybrid reproduction (Chrome with Gemini Nano, Firebase config, App Check): see the README and `docs/setup/browser-compatibility.md`.
- Hosted: TODO.
