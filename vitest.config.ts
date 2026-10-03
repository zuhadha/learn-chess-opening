import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Component tests use the automatic JSX runtime; no Babel/React plugin needed.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    testTimeout: 30_000,
    // The store is a single process-wide SQLite handle; suites that touch it
    // must not run concurrently against each other.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/client/**", "lib/db/sqlite.ts"],
    },
  },
});
