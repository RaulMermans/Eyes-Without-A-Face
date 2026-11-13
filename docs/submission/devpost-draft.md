# Devpost submission draft — Eyes Without a Face

**Status: DRAFT, ready for owner review (Sprint 12, 2026-11-13). Not submitted.** Written against the Official Rules read on 2026-11-13 ([../hackathon-requirements.md](../hackathon-requirements.md)). Every number below is backed by [evidence.md](evidence.md). Before submitting: record and upload the video (owner approval), fill in the video URL, confirm the eligibility items in [../hackathon-history.md](../hackathon-history.md), and decide on the web API key ([../hackathon-requirements.md](../hackathon-requirements.md)).

## Form fields

| Field | Value |
| --- | --- |
| Project name | Eyes Without a Face |
| Tagline | Build integrations for systems your AI cannot see. |
| Platform | Web (Chrome) — Gemini Nano via Firebase AI Logic |
| Hosted demo (testing URL) | <https://eyes-without-a-face-b7281.web.app> (no login; Chrome desktop 139+ for on-device AI; any modern browser for the deterministic path) |
| Repository | <https://github.com/RaulMermans/Eyes-Without-A-Face> (public, Apache-2.0) |
| Video (YouTube, ≤ 3:00) | **TODO after recording and owner-approved upload** |
| Built with | TypeScript, React, Vite, Firebase AI Logic (`firebase/ai`), Gemini Nano, Gemini (`gemini-3.5-flash-lite`), Firebase App Check (reCAPTCHA Enterprise), Firebase Hosting, Ajv, Zod, Vitest, Playwright |

### Testing instructions (for judges)

1. Open <https://eyes-without-a-face-b7281.web.app> in desktop Chrome. No account or key is needed.
2. Click **Try the fictional CRM demo**, or **Advanced sources → Customer CRM (EU accounts) → Load scenario** for the full date-error story. All data is fictional.
3. Optional, if your Chrome has Gemini Nano: **Interpret private fields on-device**. Without Nano the app says *Deterministic, not hybrid* and everything else still works.
4. **Build Integration** → **Review what crosses the boundary** → **Approve this exact prompt** → **Send approved request**. Nothing is sent before you approve.
5. **Run Reality Check**, then follow the revision and **Export Integration**. Unzip and run `node run.mjs verify` with Node 22.

If the cloud model is overloaded, the app says so and offers a fresh request that you approve again; it never retries on its own.

---

## Inspiration

A cloud model could write the integration between your CRM and your helpdesk in seconds. But the data it would need to see (customers, emails, internal notes) is exactly the data that must not leave the company. So the AI either gets the data anyway ("just paste a few rows") or it is not used at all. We wanted a third option: let the AI design the integration **without seeing the records**, and let the developer prove the result is right.

## What it does

Eyes Without a Face is a privacy-aware hybrid AI integration studio. You import a private source, choose the destination, watch EYES build the integration, approve exactly what the cloud may see, verify the result locally, and export an executable integration.

1. **Import locally.** A private JSON export is profiled by deterministic code in the browser.
2. **Understand privately.** Gemini Nano runs **on-device** (`ONLY_ON_DEVICE`) and interprets private field names and values. Its suggestions are validated against the profile and change anything only when you apply them.
3. **Phantom Twin.** Every field becomes an alias (`f_01`…) with fictional examples.
4. **Approve exactly what leaves.** You read the exact prompt with its SHA-256 and approve one request.
5. **Cloud mapping.** Gemini (`ONLY_IN_CLOUD`, App Check enforced) proposes a declarative mapping over aliases from an eight-operation allowlist. It cannot run code.
6. **Reality Check and meaning.** The browser runs the mapping on the real records and on hidden cases the model never saw, then checks what it *means*.
7. **Blind revision.** If the meaning is wrong, you approve one feedback request with the finding and the rule, never the records. Gemini revises; a local, ground-truth-blind decision says whether it improved.
8. **Export.** A ZIP that runs with plain Node 22: the alias-level mapping, the app's own engine and a value-free report, all hash-pinned. No records, no field names, no bindings.

**Example (real, on the hosted build).** A German CRM writes `03/02/2026` for 3 February. Gemini's first mapping read it month-first: schema-valid, but the date becomes 2 March. The local verifier caught it, one approved blind revision switched the parser to day-first, and correct records went from **0 to 7** with no regressions. See [business-impact.md](business-impact.md).

## How we built it

**Local intelligence for private understanding. Cloud intelligence for integration design. Deterministic verification for correctness and safety.**

| Where | What runs | Firebase AI Logic mode |
| --- | --- | --- |
| On-device | Gemini Nano: private field interpretation, validated against the deterministic profile | `ONLY_ON_DEVICE` |
| Cloud | Gemini `gemini-3.5-flash-lite`: initial mapping and one blind revision, from approved payloads only | `ONLY_IN_CLOUD`, App Check (reCAPTCHA Enterprise) |
| Local, deterministic | Profiling, twin, approval binding, contract validation, alias resolution, execution, semantic verification, revision decision, export | — |

**Why no automatic fallback.** Firebase AI Logic's hybrid SDK can fall back from device to cloud. We use the same SDK but route by **data sensitivity**: a step that reads private data runs only on-device, and a step that reads approved synthetic data runs only in the cloud. A silent fallback would move a private-data step to the cloud, so it is forbidden. Provenance comes from the SDK's reported `inferenceSource`, never from the mode requested.

The model proposes **data, not code**: a mapping contract in a small DSL. Every proposal passes a JSON Schema 2020-12 contract and alias checks. Invalid output is rejected, never repaired. The same deterministic interpreter runs in the browser and inside the exported package.

## Challenges we ran into

- **Semantic correctness.** Real Gemini mappings were *schema-valid but wrong* (month-first dates, an inverted priority scale). Structural validation alone would have shipped them, so we built a local semantic verifier with trusted constraints.
- **Privacy boundaries.** Every outbound byte had to be reviewable. Approvals are single-use and bound to the prompt hash, and any upstream change clears them visibly.
- **Model unreliability.** Provider overloads and timeouts hit a third of requests in one benchmark week. We classify failures and offer a safe next step instead of retrying behind the user's back.
- **Gemini Nano in practice.** Playwright's default Chrome flags silently disable the Nano component; we found the root cause and run real on-device tests with a dedicated profile.
- **Deployment.** The release build refuses App Check debug mode, and preview channels fail closed because reCAPTCHA allows only the production domains.

## Accomplishments that we're proud of

- **A real, public, working product.** Deployed on Firebase Hosting; the full journey (Nano → approval → Gemini → semantic failure → blind revision → export) passed **2 / 2** runs on the public URL with production App Check, and both exports verified outside the app.
- **Silent errors caught locally.** The verifier flagged every schema-valid but wrong output in our real-model benchmark (CRM 20 / 20, support 36 / 36, 0 false alarms), and 3 / 3 wrong dates in each of six runs of a new scenario.
- **Blind correction that works, measured honestly.** Real revisions fixed the meaning on a frozen holdout (support 0 → 6, CRM 1 → 9 of 10); in live end-to-end runs, 3 of 5 (Sprint 9) and 2 of 2 (hosted) ended `ACCEPTED`.
- **Portable output.** Every live export passed `node run.mjs verify` in a fresh directory.
- **Privacy evidence.** 0 private source values in 61 real request bodies (51 earlier plus 10 this sprint); one scanner match on a fictional example word was traced and explained.
- **An honest answer about local AI** (next section).

## What we learned

Hybrid AI needs explicit trust boundaries, deterministic verification and honest uncertainty. Each side should do what it can be trusted with: the on-device model may look at what the cloud must not, the cloud model reasons over what you approved, and deterministic code keeps the final say, including whether the AI was right.

We also tested our own claim. In a pre-registered experiment on a Dutch CRM, Gemini Nano correctly understood private field names that our English rules could not (8 / 8 applied suggestions correct, 5 wrong ones blocked by validation), but Gemini Cloud's mapping was identical with and without it, and Nano did not fix the date order. Our honest answer: **today Nano's value in EYES is private understanding and transparency, not measured accuracy**. The local verifier is what catches the errors ([docs/evaluation/sprint-12-nano-value.md](../evaluation/sprint-12-nano-value.md)).

## What's next

Not built yet, and not claimed:

- Independent usability sessions with external developers (the facilitator kit is ready; none run yet).
- A manual screen-reader pass.
- Letting validated on-device findings propose semantic constraints for the user to confirm, so local understanding can reach the verifier.
- More source formats and semantic rule families. Connectors to live systems would need their own security review.

## Development during the submission period

EYES existed before the period: Sprints 0–4 (foundation, Firebase AI Logic adapters, the mapping engine, the first Phantom Twin flow and the first real Nano and cloud inference) were committed before 2026-11-11 1:30 PM PT. In the period we built blind revision, local semantic verification, the deterministic revision decision, the portable executable export, provider-failure handling, the redesigned CONNECT / OBSERVE / OUTCOME experience with the Black Halo identity, the evaluation infrastructure and the public deployment: +18,946 / −1,006 hand-written source lines. Commit-level detail: [docs/hackathon-history.md](../hackathon-history.md).

## Privacy model and limits

- **Stays local:** records, field names, alias bindings, hidden cases, failure values, Nano prompts and rationales.
- **Disclosed after approval:** aliases, generated descriptors, fictional examples, labels you choose to disclose, a minimal destination description; for a revision, finding codes and the constraints you tick.
- **Not anonymization.** A twin reduces disclosure; structure and approved labels still reveal something, so you review every request. Zero detected private strings is evidence, not proof.
- **Known limits:** small fictional scenarios, no statistical claim; a deterministic patch with the same approved rule matched Gemini's revisions; no independent usability test yet.
