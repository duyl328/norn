import { createServer } from "node:net";
import { basename, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const cwd = process.cwd();

const hashText = (value) => {
  let hash = 2166136261;

  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

const sanitizeIdentifierPart = (value) => {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "");

  return /^[a-z]/.test(cleaned) ? cleaned : `w${cleaned || "dev"}`;
};

const getGitValue = (args) => {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0) {
    return "";
  }

  return result.stdout.trim();
};

const canListen = (port) =>
  new Promise((resolvePort) => {
    const server = createServer();

    server.once("error", () => resolvePort(false));
    server.once("listening", () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, "127.0.0.1");
  });

const findPort = async (preferredPort) => {
  for (let port = preferredPort; port < preferredPort + 80; port += 1) {
    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error(`No free local port found near ${preferredPort}.`);
};

const explicitName = process.env.NORN_INSTANCE_NAME;
const branch = getGitValue(["branch", "--show-current"]);
const worktreeName = basename(resolve(cwd));
const instanceName = explicitName || branch || worktreeName;
const instanceHash = hashText(cwd).slice(0, 6);
const preferredPort = Number(process.env.NORN_DEV_PORT ?? 1420 + (parseInt(instanceHash, 36) % 400));
const port = await findPort(preferredPort);
const identifier = `com.norn.workbench.${sanitizeIdentifierPart(instanceName)}.${instanceHash}`;
const config = {
  identifier,
  build: {
    beforeDevCommand: `pnpm dev --host 127.0.0.1 --port ${port}`,
    devUrl: `http://127.0.0.1:${port}`,
  },
};
const childEnv = {
  ...process.env,
  NORN_DEV_PORT: String(port),
};

console.log(`Starting Norn (${instanceName})`);
console.log(`Worktree: ${cwd}`);
console.log(`Dev URL:  http://127.0.0.1:${port}`);
console.log(`Bundle:   ${identifier}`);

const child = spawn("pnpm", ["tauri", "dev", "--config", JSON.stringify(config)], {
  cwd,
  env: childEnv,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
