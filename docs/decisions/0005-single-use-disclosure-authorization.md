# ADR 0005 — Single-use disclosure authorization

**Status:** Accepted  
**Date:** 2026-11-10

Cloud mapping may run only after a human approves the **exact application-level outbound request**: canonical `CloudDisclosurePayload`, destination (`provider` / `backend` / `model` / `purpose`), request id, and SHA-256 of that envelope.

The approval is reserved atomically at `submitApprovedCloudInference` and consumed when the adapter returns or fails. Timeouts are treated as potentially submitted because Firebase `AbortSignal` does not cancel the backend operation. Automatic retries are forbidden.

The effective runtime destination is `firebase-ai-logic` + `google-ai` + `gemini-3.5-flash-lite`. An approval for any other model is rejected before `generateContent`.
