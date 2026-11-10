# ADR 0001 — JSON Schema is canonical for contracts

**Status:** Accepted  
**Date:** 2026-11-10

TypeScript types in `src/domain/contracts/types.ts` are a convenience view of the JSON Schema 2020-12 documents. Contract tests load fixtures through Ajv. If types and schemas drift, the schema wins and the types are updated.
