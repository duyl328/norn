// 一键发布:把已构建的产物 + 自动更新清单(latest.json)推到 GitHub Release。
// 前置:已 `pnpm tauri build`(带 TAURI_SIGNING_PRIVATE_KEY 签名),且 `gh auth login` 完成。
// 用法:pnpm release  (版本号取 package.json,即上次构建自增后的值)
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO = "duyl328/norn";
const REPO_URL = "https://github.com/duyl328/norn";
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

// 防呆:签名密钥必须与 tauri.conf.json 里写死的 pubkey 是同一把,否则老用户验签失败、自动更新静默作废
// (曾因换了新密钥打包却没同步 pubkey,导致 GitHub 自动更新全线失效)。minisign 文件第 2 行 base64
// 解出的 [2:10] 8 字节即 keyID,只比 keyID 足以拦住「换错密钥」这类事故。
// ponytail: 只校验 keyID,不做完整 ed25519 验签;要更强就把 .tar.gz 一起验,目前没必要。
const keyId = (minisignText) => {
  let decoded = minisignText.trim();
  if (!decoded.includes("\n")) {
    const candidate = Buffer.from(decoded, "base64").toString("utf8");
    if (candidate.includes("\n")) decoded = candidate;
  }
  const payload = decoded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[A-Za-z0-9+/]+={0,2}$/.test(line));
  if (!payload) throw new Error("无法解析 minisign keyID");
  return Buffer.from(payload, "base64").subarray(2, 10).toString("hex");
};
const pubkeyB64 = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).plugins.updater.pubkey;
const pubKeyId = keyId(Buffer.from(pubkeyB64, "base64").toString("utf8"));
const sigKeyId = keyId(readFileSync(sig, "utf8"));
if (pubKeyId !== sigKeyId) {
  throw new Error(
    `签名密钥与 pubkey 不匹配,拒绝发布。\n` +
      `  产物签名 keyID: ${sigKeyId}\n  tauri.conf pubkey keyID: ${pubKeyId}\n` +
      `请用与 pubkey 配对的私钥重新构建:TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/norn-updater.key)" pnpm tauri build`,
  );
}

// 平台 url 用 releases/latest/download/<asset>,始终指向最新 release,免去 tag 拼接。
const assetName = updater.split("/").pop();
const latest = {
  version,
  notes: process.env.RELEASE_NOTES ?? `Norn ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: readFileSync(sig, "utf8").trim(),
      url: `${REPO_URL}/releases/latest/download/${assetName}`,
    },
  },
};
writeFileSync("latest.json", JSON.stringify(latest, null, 2));

console.log(`[release] 发布 ${tag} 到 ${REPO}`);
execFileSync(
  "gh",
  ["release", "create", tag, dmg, updater, sig, "latest.json", "--repo", REPO, "--title", tag, "--notes", latest.notes],
  { stdio: "inherit" },
);
console.log(`[release] 完成:${REPO_URL}/releases/tag/${tag}`);
