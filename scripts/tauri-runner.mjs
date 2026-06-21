import { spawn } from "node:child_process";

const args = process.argv.slice(2);

const run = (cmd, cmdArgs) => {
  const child = spawn(cmd, cmdArgs, { stdio: "inherit", env: process.env });
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
  run("tauri", args);
}
