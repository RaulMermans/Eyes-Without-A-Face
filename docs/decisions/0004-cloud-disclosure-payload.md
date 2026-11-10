# ADR 0004 — Separate Cloud Disclosure Payload

**Status:** Accepted  
**Date:** 2026-11-10

A Phantom Contract may contain internal references (`sourceFieldId`, `sourceDatasetId`, `nonShareableSourceFieldIds`) that must never travel to cloud Gemini merely because the twin was marked approved.

Sprint 1 introduces a sixth versioned contract, `cloud-disclosure`, built by an explicit allowlist projection. The cloud adapter accepts only an `AuthorizedCloudRequest` that wraps that payload plus a request-scoped approval hash.
