import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "norn-native-e2e-"));
const repository = join(fixtureRoot, "repository");
const remote = join(fixtureRoot, "remote.git");
const peer = join(fixtureRoot, "peer");
const files = join(fixtureRoot, "files");
const hooks = join(fixtureRoot, "hooks");
const artifacts = join(workspace, "artifacts", "native-e2e");

const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const configureRepository = (cwd) => {
  git(cwd, "config", "user.name", "Norn Native E2E");
  git(cwd, "config", "user.email", "native-e2e@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "config", "core.autocrlf", "false");
  git(cwd, "config", "pull.rebase", "false");
  const excludes = join(cwd, ".git", "norn-test-global-ignore");
  writeFileSync(excludes, "", "utf8");
  git(cwd, "config", "core.excludesFile", excludes);
};

const run = (command, args, extraEnv = {}) => {
  const result = spawnSync(command, args, {
    cwd: workspace,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status === 0;
};

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const listNornProcessIds = () => {
  const output = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='norn.exe'\" | Select-Object -ExpandProperty ProcessId",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Set(
    output
      .split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter(Number.isFinite),
  );
};

const waitForMarker = async (path, child, timeout = 60_000) => {
  const startedAt = Date.now();
  while (!existsSync(path)) {
    if (child.exitCode !== null) throw new Error(`native crash setup exited early with code ${child.exitCode}`);
    if (Date.now() - startedAt > timeout) throw new Error(`timed out waiting for ${path}`);
    await delay(50);
  }
};

const waitForExit = (child, timeout = 30_000) =>
  new Promise((resolveExit, rejectExit) => {
    if (child.exitCode !== null) {
      resolveExit(child.exitCode);
      return;
    }
    const timer = setTimeout(() => rejectExit(new Error("native crash setup did not exit")), timeout);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });

const runForcedTerminationRecovery = async (wdioCli, baseEnv) => {
  const readyMarker = join(hooks, "forced-termination.ready");
  const killedMarker = join(hooks, "forced-termination.killed");
  rmSync(readyMarker, { force: true });
  rmSync(killedMarker, { force: true });
  rmSync(join(hooks, "drafts-config"), { force: true, recursive: true });
  const existingProcessIds = listNornProcessIds();
  const crashEnv = {
    ...process.env,
    ...baseEnv,
    NORN_NATIVE_E2E_CRASH_MODE: "1",
    NORN_NATIVE_E2E_CRASH_READY: readyMarker,
    NORN_NATIVE_E2E_CRASH_KILLED: killedMarker,
  };
  const seed = spawn(
    process.execPath,
    [wdioCli, "run", "wdio.native.conf.ts", "--spec", "tests/native-e2e/crash-recovery-seed.spec.ts"],
    { cwd: workspace, env: crashEnv, stdio: "inherit" },
  );

  try {
    await waitForMarker(readyMarker, seed);
    const processIds = [...listNornProcessIds()].filter((processId) => !existingProcessIds.has(processId));
    if (processIds.length !== 1) {
      throw new Error(`expected one native test process, found ${processIds.join(", ") || "none"}`);
    }
    execFileSync("taskkill.exe", ["/PID", String(processIds[0]), "/F"], { stdio: "ignore" });
    writeFileSync(killedMarker, "killed\n", "utf8");
    const seedStatus = await waitForExit(seed);
    if (seedStatus !== 0) {
      console.warn(`forced-termination setup exited with expected connection-loss code ${seedStatus}`);
    }
  } catch (error) {
    seed.kill();
    throw error;
  }

  return run(
    process.execPath,
    [wdioCli, "run", "wdio.native.conf.ts", "--spec", "tests/native-e2e/crash-recovery-restore.spec.ts"],
    crashEnv,
  );
};

try {
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(repository);
  mkdirSync(remote);
  mkdirSync(files);
  mkdirSync(hooks);
  git(remote, "init", "--bare", "-b", "main");

  git(repository, "init", "-b", "main");
  configureRepository(repository);
  writeFileSync(join(repository, "README.md"), "native e2e fixture\n", "utf8");
  git(repository, "add", "README.md");
  git(repository, "commit", "-m", "initial fixture");
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "-u", "origin", "main");

  git(repository, "checkout", "-b", "native-feature");
  writeFileSync(join(repository, "feature.txt"), "feature branch\n", "utf8");
  git(repository, "add", "feature.txt");
  git(repository, "commit", "-m", "feature fixture");
  git(repository, "checkout", "main");
  writeFileSync(join(repository, "native-e2e.txt"), "created before app launch\n", "utf8");

  git(fixtureRoot, "clone", remote, peer);
  configureRepository(peer);

  const tscCli = join(workspace, "node_modules", "typescript", "bin", "tsc");
  const viteCli = join(workspace, "node_modules", "vite", "bin", "vite.js");
  if (!run(process.execPath, [tscCli])) process.exit(process.exitCode ?? 1);
  if (!run(process.execPath, [viteCli, "build"])) process.exit(process.exitCode ?? 1);
  if (
    !run("cargo", [
      "build",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--bin",
      "norn",
      "--features",
      "tauri/custom-protocol",
    ])
  ) {
    process.exit(process.exitCode ?? 1);
  }

  const wdioCli = join(workspace, "node_modules", "@wdio", "cli", "bin", "wdio.js");
  const requestedSpec = process.argv[2];
  const wdioArgs = [wdioCli, "run", "wdio.native.conf.ts"];
  if (requestedSpec) wdioArgs.push("--spec", requestedSpec);
  const nativeEnv = {
    NORN_NATIVE_E2E_REPO: repository,
    NORN_NATIVE_E2E_REMOTE: remote,
    NORN_NATIVE_E2E_PEER: peer,
    NORN_NATIVE_E2E_FILES: files,
    NORN_NATIVE_E2E_HOOK_DIR: hooks,
    NORN_NATIVE_E2E_ARTIFACTS: artifacts,
  };
  const passed = run(process.execPath, wdioArgs, nativeEnv);
  const shouldRunCrashRecovery = !requestedSpec || /lifecycle\.spec\.ts$/i.test(requestedSpec);
  const crashRecoveryPassed = passed && (!shouldRunCrashRecovery || (await runForcedTerminationRecovery(wdioCli, nativeEnv)));
  if (!crashRecoveryPassed) {
    cpSync(fixtureRoot, join(artifacts, `fixture-${Date.now()}`), { recursive: true });
  }
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}
