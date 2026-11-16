import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

/** Sprint 16A domain-level reproductions (isolate failures found in the production matrix). Not a release gate. */
export default defineConfig({ ...base, test: { ...base.test, include: ["tests/qa/**/*.test.ts"] } });
