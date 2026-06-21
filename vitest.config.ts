import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        branches: 7,
        functions: 6,
        lines: 7,
        statements: 7,
      },
    },
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/components/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
