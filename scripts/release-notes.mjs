import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^v?(\d+\.\d+\.\d+)$/;

function parseVersion(tag) {
  const match = tag?.match(VERSION_PATTERN);
  if (!match) {
    throw new Error(`发布版本必须是 vX.Y.Z 或 X.Y.Z，实际为：${tag ?? "<empty>"}`);
  }
  return match[1];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractReleaseNotes(changelog, tag) {
  const version = parseVersion(tag);
  const normalized = changelog.replace(/\r\n/g, "\n");
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\] - \\d{4}-\\d{2}-\\d{2}\\s*$`, "m");
  const match = heading.exec(normalized);

  if (!match) {
    throw new Error(`CHANGELOG.md 缺少版本章节：## [${version}] - YYYY-MM-DD`);
  }

  const sectionStart = match.index + match[0].length;
  const remaining = normalized.slice(sectionStart);
  const nextSection = remaining.search(/^## /m);
  const notes = remaining.slice(0, nextSection === -1 ? undefined : nextSection).trim();

  if (!/^### .+/m.test(notes)) {
    throw new Error(`CHANGELOG.md 的 ${version} 版本至少需要一个三级分类标题`);
  }
  if (!/^- .+/m.test(notes)) {
    throw new Error(`CHANGELOG.md 的 ${version} 版本至少需要一条变更记录`);
  }
  if (/\b(?:TODO|TBD)\b|待补充|暂无/iu.test(notes)) {
    throw new Error(`CHANGELOG.md 的 ${version} 版本仍包含占位内容`);
  }

  return notes;
}

export function readReleaseNotes(tag, changelogPath = process.env.CHANGELOG_PATH ?? "CHANGELOG.md") {
  return extractReleaseNotes(readFileSync(changelogPath, "utf8"), tag);
}

function writeGitHubOutput(notes) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("使用 --github-output 时必须提供 GITHUB_OUTPUT");
  }

  const delimiter = `NORN_RELEASE_NOTES_${process.pid}_${Date.now()}`;
  appendFileSync(outputPath, `release_body<<${delimiter}\n${notes}\n${delimiter}\n`, "utf8");
}

function main() {
  const tag = process.env.RELEASE_TAG ?? process.argv.find((arg, index) => index >= 2 && !arg.startsWith("--"));
  const notes = readReleaseNotes(tag);

  if (process.argv.includes("--github-output")) {
    writeGitHubOutput(notes);
  }

  process.stdout.write(`${notes}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
