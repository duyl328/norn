import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

if (!process.env.NORN_NATIVE_E2E_REPO) {
  throw new Error("NORN_NATIVE_E2E_REPO is required; use pnpm test:e2e:native");
}
if (!process.env.NORN_NATIVE_E2E_FILES) {
  throw new Error("NORN_NATIVE_E2E_FILES is required; use pnpm test:e2e:native");
}
if (!process.env.NORN_NATIVE_E2E_HOOK_DIR) {
  throw new Error("NORN_NATIVE_E2E_HOOK_DIR is required; use pnpm test:e2e:native");
}

const application = resolve("src-tauri/target/debug/norn.exe");
const artifactRoot = process.env.NORN_NATIVE_E2E_ARTIFACTS ?? resolve("artifacts/native-e2e");
mkdirSync(join(artifactRoot, "screenshots"), { recursive: true });

export const config = {
  runner: "local",
  specs: ["./tests/native-e2e/**/*.spec.ts"],
  exclude:
    process.env.NORN_NATIVE_E2E_CRASH_MODE === "1"
      ? []
      : ["./tests/native-e2e/crash-recovery-seed.spec.ts", "./tests/native-e2e/crash-recovery-restore.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application,
      },
    },
  ],
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath: application,
        driverProvider: "external",
        autoInstallTauriDriver: true,
        autoDownloadEdgeDriver: true,
        captureBackendLogs: true,
        captureFrontendLogs: true,
        startTimeout: 120_000,
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "warn",
  outputDir: join(artifactRoot, "logs"),
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
  mochaOpts: {
    timeout: 120_000,
  },
  afterTest: async function (_test: unknown, _context: unknown, result: { passed: boolean }) {
    if (!result.passed) {
      await browser.saveScreenshot(join(artifactRoot, "screenshots", `failure-${Date.now()}.png`));
    }
  },
};
