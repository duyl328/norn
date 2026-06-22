import { spawn } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);

const tauriCli = join("node_modules", "@tauri-apps", "cli", "tauri.js");

const run = (cmd, cmdArgs) => {
  const child = spawn(cmd, cmdArgs, { stdio: "inherit", env: process.env });
  child.on("error", (error) => {
    console.error(`Failed to start ${cmd}: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
};

// 'dev' without '--config': first call from user, use instance script for auto port
// 'dev' with '--config': already inside tauri-dev-instance.mjs, pass through to real tauri
if (args[0] === "dev" && !args.includes("--config")) {
  run("node", ["scripts/tauri-dev-instance.mjs"]);
} else {
  run("node", [tauriCli, ...args]);
}
