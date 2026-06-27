import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);

// 每次构建强制递增 patch 版本号,保证每个安装包版本唯一且单调递增。
// 三处版本号(package.json / tauri.conf.json / Cargo.toml)必须同步。
// 用正则只替换 version 字段,保留各文件原有格式。
const bumpVersion = () => {
  const files = ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"];
  let next;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const re = file.endsWith("Cargo.toml")
      ? /^version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m
      : /"version":\s*"(\d+)\.(\d+)\.(\d+)"/;
    const m = text.match(re);
    if (!m) throw new Error(`无法在 ${file} 中找到版本号`);
    if (!next) next = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
    writeFileSync(file, text.replace(re, m[0].replace(/\d+\.\d+\.\d+/, next)));
  }
  console.log(`[tauri-runner] 版本号已递增为 ${next}`);
};

if (args[0] === "build") {
  bumpVersion();
}

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
