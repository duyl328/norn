import { describe, expect, it } from "vitest";

import { diffRowsFromVersions, diffSegments, inlineParts } from "@/features/workbench/line-diff";

describe("diffRowsFromVersions", () => {
  it("returns nothing for identical content", () => {
    const rows = diffRowsFromVersions("a\nb\n", "a\nb\n");
    expect(rows.every((r) => r.kind === "context")).toBe(true);
  });

  it("marks a replaced line as a change and keeps surrounding context", () => {
    const rows = diffRowsFromVersions("a\nb\nc", "a\nB\nc");
    expect(rows.map((r) => r.kind)).toEqual(["context", "change", "context"]);
    const change = rows[1];
    if (change.kind !== "change") throw new Error("expected change row");
    expect(change.left).toBe("b");
    expect(change.right).toBe("B");
    expect(change.leftNo).toBe(2);
    expect(change.rightNo).toBe(2);
  });

  it("emits single-sided rows for pure add and pure delete blocks", () => {
    expect(diffRowsFromVersions("a", "a\nb\nc").map((r) => r.kind)).toEqual(["context", "add", "add"]);
    expect(diffRowsFromVersions("a\nb\nc", "a").map((r) => r.kind)).toEqual(["context", "del", "del"]);
  });
});

describe("diffSegments", () => {
  it("splits into context and change segments with line numbers", () => {
    const segs = diffSegments("a\nb\nc", "a\nB\nc");
    expect(segs.map((s) => s.kind)).toEqual(["ctx", "chg", "ctx"]);
    expect(segs[1]).toMatchObject({ left: ["b"], right: ["B"], leftStart: 2, rightStart: 2 });
  });

  it("represents a multi-line pure insertion as one empty side", () => {
    const segs = diffSegments("a\nb", "a\nx\ny\nz\nb");
    const chg = segs.find((s) => s.kind === "chg");
    expect(chg).toMatchObject({ left: [], right: ["x", "y", "z"], rightStart: 2 });
  });

  it("represents a multi-line pure deletion as one empty side", () => {
    const segs = diffSegments("a\nx\ny\nz\nb", "a\nb");
    const chg = segs.find((s) => s.kind === "chg");
    expect(chg).toMatchObject({ left: ["x", "y", "z"], right: [], leftStart: 2 });
  });
});

describe("inlineParts", () => {
  it("isolates the changed middle by common prefix and suffix", () => {
    expect(inlineParts("const x = 1;", "const x = 2;")).toEqual({
      pre: "const x = ",
      aMid: "1",
      bMid: "2",
      post: ";",
    });
  });

  it("handles pure insertion inside a line (empty old middle)", () => {
    expect(inlineParts("foo()", "foo(bar)")).toEqual({ pre: "foo(", aMid: "", bMid: "bar", post: ")" });
  });

  it("leaves no highlight when lines are identical", () => {
    const { aMid, bMid } = inlineParts("same", "same");
    expect(aMid).toBe("");
    expect(bMid).toBe("");
  });
});
