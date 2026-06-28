// 一键发布:把已构建的产物 + 自动更新清单(latest.json)推到 GitHub Release。
// 前置:已 `pnpm tauri build`(带 TAURI_SIGNING_PRIVATE_KEY 签名),且 `gh auth login` 完成。
// 用法:pnpm release  (版本号取 package.json,即上次构建自增后的值)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = "duyl328/norn";
const bundle = "src-tauri/target/release/bundle";
const macos = join(bundle, "macos");
const dmgDir = join(bundle, "dmg");

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;

// 定位产物:updater 包(.app.tar.gz)+ 其签名(.sig)+ dmg。
const find = (dir, test) => {
  const hit = readdirSync(dir).find(test);
  if (!hit) throw new Error(`在 ${dir} 找不到匹配文件`);
  return join(dir, hit);
};
const updater = find(macos, (f) => f.endsWith(".app.tar.gz"));
const sig = find(macos, (f) => f.endsWith(".app.tar.gz.sig"));
const dmg = find(dmgDir, (f) => f.endsWith(".dmg"));

// 平台 url 用 releases/latest/download/<asset>,始终指向最新 release,免去 tag 拼接。
const assetName = updater.split("/").pop();
const latest = {
  version,
  notes: process.env.RELEASE_NOTES ?? `Norn ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: readFileSync(sig, "utf8").trim(),
      url: `https://github.com/${REPO}/releases/latest/download/${assetName}`,
    },
  },
};
writeFileSync("latest.json", JSON.stringify(latest, null, 2));

console.log(`[release] 发布 ${tag} 到 ${REPO}`);
execFileSync(
  "gh",
  [
    "release", "create", tag,
    dmg, updater, sig, "latest.json",
    "--repo", REPO,
    "--title", tag,
    "--notes", latest.notes,
  ],
  { stdio: "inherit" },
);
console.log(`[release] 完成:https://github.com/${REPO}/releases/tag/${tag}`);
