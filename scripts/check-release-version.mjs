import { readFileSync } from "node:fs";

const tag = process.env.RELEASE_TAG ?? process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`发布标签必须是 vX.Y.Z，实际为：${tag ?? "<empty>"}`);
}

const expected = tag.slice(1);
const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargoText = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  "package.json": packageVersion,
  "src-tauri/tauri.conf.json": tauriVersion,
  "src-tauri/Cargo.toml": cargoVersion,
};
const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  const details = mismatches.map(([file, version]) => `${file}: ${version ?? "<missing>"}`).join("\n");
  throw new Error(`标签 ${tag} 与项目版本 ${expected} 不一致：\n${details}`);
}

console.log(`发布版本校验通过：${tag}`);
