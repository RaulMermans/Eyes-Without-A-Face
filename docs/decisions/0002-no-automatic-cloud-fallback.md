# ADR 0002 — No automatic cloud fallback

**Status:** Accepted  
**Date:** 2026-11-10

Firebase AI Logic offers `PREFER_ON_DEVICE` and `PREFER_IN_CLOUD`, which silently change execution location. This product’s privacy model requires the user to know whether a call is local or cloud. Sprint 1 will use `ONLY_ON_DEVICE` and `ONLY_IN_CLOUD` only.
