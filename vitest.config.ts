import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(rootDir, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/contracts/**/*.test.ts", "tests/privacy/**/*.test.ts", "tests/evaluation/**/*.test.ts"],
  },
});
