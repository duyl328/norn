import { defineConfig, devices } from "@playwright/test";

/**
 * 前端冒烟测试配置。针对 Vite 浏览器版（`pnpm dev`）运行，
 * 验证工作台界面可正常渲染、无运行时报错。
 *
 * 注意：浏览器版不含 Tauri 运行时，native invoke 能力（真实文件 / Git）
 * 不在此覆盖范围；那部分需在真实 Tauri 窗口手动验证。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:1420",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      // 使用系统已安装的 Google Chrome，避免下载 Playwright 内置浏览器
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
