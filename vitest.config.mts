import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      // `server-only` throws outside the Next.js server bundle; stub it so server modules are testable.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // DB tests share one throwaway database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
