import { resolve } from "node:path";

if (!process.env.NORN_NATIVE_E2E_REPO) {
  throw new Error("NORN_NATIVE_E2E_REPO is required; use pnpm test:e2e:native");
}
if (!process.env.NORN_NATIVE_E2E_FILES) {
  throw new Error("NORN_NATIVE_E2E_FILES is required; use pnpm test:e2e:native");
}

const application = resolve("src-tauri/target/debug/norn.exe");

export const config = {
  runner: "local",
  specs: ["./tests/native-e2e/**/*.spec.ts"],
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
  waitforTimeout: 30_000,
  connectionRetryTimeout: 120_000,
  mochaOpts: {
    timeout: 120_000,
  },
};
