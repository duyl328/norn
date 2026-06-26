import { describe, expect, it } from "vitest";

import { parseDiffToRows } from "@/features/workbench/diff-parse";

describe("parseDiffToRows", () => {
  it("returns nothing for empty diff", () => {
    expect(parseDiffToRows("")).toEqual([]);
  });

  it("pairs deletions with additions as change rows and tracks line numbers", () => {
    const diff = [
      "diff --git a/foo.ts b/foo.ts",
      "index 111..222 100644",
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-old line",
      "+new line",
      " tail",
    ].join("\n");

    const rows = parseDiffToRows(diff);
    expect(rows[0]).toMatchObject({ kind: "hunk" });
    expect(rows[1]).toMatchObject({ kind: "context", left: "keep", right: "keep", leftNo: 1, rightNo: 1 });
    expect(rows[2]).toMatchObject({ kind: "change", left: "old line", right: "new line", leftNo: 2, rightNo: 2 });
    expect(rows[3]).toMatchObject({ kind: "context", left: "tail", leftNo: 3, rightNo: 3 });
  });

  it("emits single-sided rows for uneven add/del runs", () => {
    const diff = ["@@ -1,2 +1,3 @@", "-gone", "+a", "+b", "+c"].join("\n");
    const rows = parseDiffToRows(diff);
    // 1 change (gone↔a) + 2 adds (b, c)
    expect(rows.filter((r) => r.kind === "change")).toHaveLength(1);
    expect(rows.filter((r) => r.kind === "add")).toHaveLength(2);
    expect(rows.filter((r) => r.kind === "del")).toHaveLength(0);
  });

  it("handles pure additions (untracked file vs /dev/null)", () => {
    const diff = ["--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+one", "+two"].join("\n");
    const rows = parseDiffToRows(diff);
    expect(rows.filter((r) => r.kind === "add")).toHaveLength(2);
    expect(rows.find((r) => r.kind === "add" && r.right === "one")).toMatchObject({ rightNo: 1 });
  });
});
