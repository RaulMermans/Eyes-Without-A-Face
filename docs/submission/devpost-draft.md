# Devpost submission draft — Eyes Without a Face

**Status: DRAFT. Not submitted.** Before submitting: read the Official Rules in a browser, publish the repository (owner decision), deploy and verify the hosted build (owner approval, [../deployment.md](../deployment.md)), record and upload the video, and replace every `TODO`. Do not invent URLs. Every number below is backed by [evidence.md](evidence.md).

- **Tagline:** Build integrations for systems your AI cannot see.
- **Repository:** TODO, once public: `https://github.com/RaulMermans/Eyes-Without-A-Face`
- **Hosted demo:** TODO, only after an approved and verified Hosting deployment
- **Video (YouTube, ≤ 3:00):** TODO, only after it exists ([../demo/hero-demo.md](../demo/hero-demo.md))

---

## Inspiration / the problem

A cloud model could write the integration between your CRM and your helpdesk in seconds. But the data it would need to see (customers, emails, internal notes) is exactly the data that must not leave the company. So the AI either gets the data anyway ("just paste a few rows") or it is not used at all.

## What it does

Eyes Without a Face is a privacy-aware integration studio. Gemini designs a data integration for a private system **without being shown its records**. Your browser proves the result, and you take away a package that runs anywhere.

1. **Import locally.** A private JSON export is profiled by deterministic code in the browser.
2. **Understand privately.** Gemini Nano runs **on-device** (Firebase AI Logic, `ONLY_ON_DEVICE`) and may interpret private fields; its output is validated and applied only by you.
3. **Phantom Twin.** Every field becomes an alias (`f_01`…) with fictional examples.
4. **Approve exactly what leaves.** You read the exact prompt with its SHA-256 and approve one request.
5. **Cloud mapping.** Gemini (`ONLY_IN_CLOUD`, App Check enforced) proposes a declarative mapping over aliases from an eight-operation allowlist. It cannot run code.
6. **Reality Check and meaning.** The browser runs the mapping on the real records and hidden cases, then checks what it *means* against constraints you declared or that local records prove.
7. **Blind revision.** If the meaning is wrong, you approve one feedback request with the finding and, optionally, the constraint, but never the records. Gemini revises; a local, ground-truth-blind decision says whether it improved.
8. **Export.** Download a ZIP that runs with plain Node 22: the alias-level mapping, destination schema, fictional fixtures, a value-free report, the acceptance policy and the app's own engine, all hash-pinned. No records, no field names, no bindings.

## The hybrid design

**Local intelligence for private understanding. Cloud intelligence for integration design. Deterministic verification for correctness and safety.**

| Where | What runs | Mode |
| --- | --- | --- |
| On-device | Gemini Nano: optional private field interpretation, validated against the deterministic profile | `ONLY_ON_DEVICE` |
| Cloud | Gemini `gemini-3.5-flash-lite`: initial mapping and one blind revision, from approved payloads only | `ONLY_IN_CLOUD`, App Check (reCAPTCHA Enterprise) |
| Local, deterministic | Profiling, twin, approval binding, contract validation, alias resolution, execution, semantic verification, revision decision, export | — |

No `PREFER_*` modes: an automatic fallback would quietly move a private-data step to the cloud. Provenance comes from the SDK's reported `inferenceSource`, never from the mode requested. We do not claim every step needs an LLM: once a correction is known, deterministic code can apply it (and we measured that it does as well as Gemini). The model's job is designing an integration for a structure it has never seen, from a representation you approved.

## Results (real models, measured)

- **Silent errors exist and are caught locally.** Real Gemini mappings that passed every structural check read dates month-first or inverted a priority scale. The local verifier flagged every such output in the Sprint 8 benchmark (CRM 20/20, support 36/36, 0 false alarms).
- **Blind correction works, sometimes.** Sprint 8: two real revisions fixed the meaning on a pre-frozen holdout (support 0 → 6, CRM 1 → 9 correct of 10). Sprint 9 live end-to-end: 3 of 5 runs ended `ACCEPTED` and exported (clean transformations 0 → 8, 0 → 8, 7 → 8). One initial proposal was invalid and rejected unrepaired. One revision was labeled `HUMAN_REVIEW_REQUIRED` and exported only as a `DRAFT`.
- **The export runs outside the app.** All 4 live-exported packages passed `node run.mjs verify` in a fresh directory with no install. Deterministic tests prove that the packaged runner reproduces the app's engine output exactly.
- **Privacy:** 0 private terms in 47 real request bodies (38 in Sprint 8, 9 in Sprint 9). A blocking privacy scan runs on every export.
- **Honest limits:** a deterministic patch using the same approved constraint matched or beat Gemini's revisions. Gemini Nano added no measurable accuracy on our fixtures. Provider failures (500 high demand, timeouts) hit a third of Sprint 8 requests; Sprint 9 saw none in 9 requests.

## Technical architecture

The model proposes **data**, not code: a mapping contract in a small DSL. Every proposal passes a canonical JSON Schema 2020-12 contract and alias checks. Invalid output is rejected, never repaired. A deterministic interpreter executes it, and that same interpreter is bundled into the exported package.

Stack: TypeScript (strict), React + Vite, Ajv, Zod, Firebase JS SDK (`firebase/ai`, App Check), Firebase Hosting, Vitest + fast-check, Playwright.

## Privacy model

- **Stays local:** records, field names, alias bindings, hidden cases, failure values, Nano prompts and rationales.
- **Disclosed after approval:** aliases, generated descriptors, fictional examples, labels you choose to disclose, a minimal destination description; for a revision, finding codes and constraints you tick.
- **Approval:** bound to the SHA-256 of the exact prompt, the model and one request id; single use; consumed approvals are never reused, and recovery after a provider failure needs a fresh approval.
- **Not anonymization.** A twin reduces disclosure; structure and approved labels still reveal something, so you review every request. The Firebase SDK adds App Check tokens and transport metadata.

## Challenges

- Playwright's default Chrome flags silently disable the Gemini Nano component.
- Real Gemini mappings were *schema-valid but wrong*. Structural validation alone would have shipped them, so we built a local semantic verifier.
- The provider was the bottleneck: we classify failures (high demand, rate limit, timeout, App Check) and give the user a safe next action instead of retrying behind their back.

## What we learned

Hybrid AI is most useful when each side does what it is trusted to do. The on-device model may look at what the cloud must not. The cloud model reasons over what you approved. Deterministic code keeps the final say, including whether the AI was right.

## What's next

Independent usability testing (protocol ready), a hosted production verification, more connectors and semantic rule families.

## Development history (competition period)

Sprints 0–2 are dated 2026-11-10, before the submission period opened. The Phantom Twin workflow, real on-device and cloud qualification, blind revision, semantic verification and portable export were built from 2026-11-11 onward. Details: [../hackathon-history.md](../hackathon-history.md). TODO: confirm against the Official Rules how pre-existing work must be declared.

## Try it

- `pnpm install && pnpm dev`. The full walkthrough, including export, works without Firebase configuration; AI steps are shown as unavailable, never simulated.
- Full hybrid reproduction: README, `docs/setup/browser-compatibility.md`, `docs/demo/hero-demo.md`.
- Hosted: TODO.
