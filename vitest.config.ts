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
        // 基线按当前实测覆盖率略向下取整设定（实测约 stmts 36.8% / branches 26.0% /
        // functions 39.8% / lines 35.4%），作为“防回退”地板：低于此值 CI 失败。
        // autoUpdate 实现“只升不降”——本地跑覆盖率时若实测更高，会自动把这里的
        // 数值抬高并写回本文件，提交后地板随之上移。补充测试是抬高基线的唯一途径。
        autoUpdate: true,
        branches: 26,
        functions: 39,
        lines: 35,
        statements: 36,
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
