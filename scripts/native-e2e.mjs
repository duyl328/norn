import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "norn-native-e2e-"));
const repository = join(fixtureRoot, "repository");
const remote = join(fixtureRoot, "remote.git");
const peer = join(fixtureRoot, "peer");
const files = join(fixtureRoot, "files");

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

try {
  mkdirSync(repository);
  mkdirSync(remote);
  mkdirSync(files);
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
  run(process.execPath, wdioArgs, {
    NORN_NATIVE_E2E_REPO: repository,
    NORN_NATIVE_E2E_REMOTE: remote,
    NORN_NATIVE_E2E_PEER: peer,
    NORN_NATIVE_E2E_FILES: files,
  });
} finally {
  rmSync(fixtureRoot, { force: true, recursive: true });
}
