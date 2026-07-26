import { describe, expect, it } from "vitest";

import { extractReleaseNotes } from "../../scripts/release-notes.mjs";

describe("release notes", () => {
  const changelog = `# 变更日志

## [Unreleased]

- 未发布内容

## [1.2.3] - 2026-07-26

### 新增

- 增加版本说明。

### 修复

- 修复发布流程。

## [1.2.2] - 2026-07-20

### 修复

- 修复旧问题。
`;

  it("只提取指定版本章节", () => {
    const notes = extractReleaseNotes(changelog, "v1.2.3");

    expect(notes).toContain("### 新增");
    expect(notes).toContain("修复发布流程");
    expect(notes).not.toContain("未发布内容");
    expect(notes).not.toContain("修复旧问题");
  });

  it("接受不带 v 前缀的版本号", () => {
    expect(extractReleaseNotes(changelog, "1.2.3")).toContain("增加版本说明");
  });

  it("拒绝缺少对应版本章节", () => {
    expect(() => extractReleaseNotes(changelog, "v2.0.0")).toThrow("缺少版本章节");
  });

  it("拒绝没有具体变更项的版本章节", () => {
    const emptySection = `## [1.2.3] - 2026-07-26\n\n### 修复\n\n## [1.2.2] - 2026-07-20`;

    expect(() => extractReleaseNotes(emptySection, "v1.2.3")).toThrow("至少需要一条变更记录");
  });

  it("拒绝带占位内容的版本章节", () => {
    const placeholder = `## [1.2.3] - 2026-07-26\n\n### 修复\n\n- TODO：补充说明`;

    expect(() => extractReleaseNotes(placeholder, "v1.2.3")).toThrow("仍包含占位内容");
  });
});
