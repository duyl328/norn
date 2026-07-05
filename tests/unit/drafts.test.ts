import { describe, expect, it } from "vitest";

import { buildRestoredDocuments, parseDrafts } from "@/features/workbench/drafts";

describe("parseDrafts", () => {
  it("keeps valid drafts and skips corrupt or incomplete ones", () => {
    const raw = [
      JSON.stringify({ id: "untitled-1", name: "Untitled", content: "hello" }),
      "{ not json",
      JSON.stringify({ id: "untitled-2", content: "no name" }), // 缺 name
      JSON.stringify({ name: "no id", content: "x" }), // 缺 id
      JSON.stringify({ id: "untitled-3", name: "Draft", content: "" }), // 空内容也算有效
    ];
    const drafts = parseDrafts(raw);
    expect(drafts.map((d) => d.id)).toEqual(["untitled-1", "untitled-3"]);
  });

  it("returns empty for empty input", () => {
    expect(parseDrafts([])).toEqual([]);
  });
});

describe("buildRestoredDocuments", () => {
  it("preserves draft encoding metadata", () => {
    const [document] = buildRestoredDocuments([
      { id: "untitled-1", name: "Draft", content: "hello", encoding: "gb18030", hasBom: true },
    ]);

    expect(document).toMatchObject({
      id: "untitled-1",
      name: "Draft",
      content: "hello",
      savedContent: "",
      encoding: "gb18030",
      encodingLabel: "GB18030 / GBK",
      hasBom: true,
      isUntitled: true,
    });
  });
});
