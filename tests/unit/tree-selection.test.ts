import { describe, expect, it } from "vitest";

import type { TreeSelection } from "@/features/workbench/types";
import { applyTreeClick, moveTreeLead, orderedRange } from "@/features/workbench/workbench-utils";

const order = ["/a", "/a/b", "/a/c", "/d", "/e"];
const plain = { toggle: false, range: false };

describe("orderedRange", () => {
  it("returns inclusive slice regardless of direction", () => {
    expect(orderedRange(order, "/a/b", "/d")).toEqual(["/a/b", "/a/c", "/d"]);
    expect(orderedRange(order, "/d", "/a/b")).toEqual(["/a/b", "/a/c", "/d"]);
  });

  it("falls back to lead-only when an endpoint is not visible", () => {
    expect(orderedRange(order, "/gone", "/d")).toEqual(["/d"]);
    expect(orderedRange(order, "/a", "/gone")).toEqual([]);
  });
});

describe("applyTreeClick", () => {
  it("plain click selects a single node", () => {
    expect(applyTreeClick(null, "main", "/d", plain, order)).toEqual({
      scope: "main",
      anchorPath: "/d",
      leadPath: "/d",
      paths: ["/d"],
    });
  });

  it("shift click extends the range from the existing anchor", () => {
    const current: TreeSelection = { scope: "main", anchorPath: "/a/b", leadPath: "/a/b", paths: ["/a/b"] };
    expect(applyTreeClick(current, "main", "/d", { toggle: false, range: true }, order)).toEqual({
      scope: "main",
      anchorPath: "/a/b",
      leadPath: "/d",
      paths: ["/a/b", "/a/c", "/d"],
    });
  });

  it("ctrl click toggles a node in and out of the set", () => {
    const current: TreeSelection = { scope: "main", anchorPath: "/a", leadPath: "/a", paths: ["/a"] };
    const added = applyTreeClick(current, "main", "/d", { toggle: true, range: false }, order);
    expect(added.paths).toEqual(["/a", "/d"]);
    const removed = applyTreeClick(added, "main", "/d", { toggle: true, range: false }, order);
    expect(removed.paths).toEqual(["/a"]);
  });

  it("treats a click in a different scope as a fresh single selection", () => {
    const current: TreeSelection = { scope: "main", anchorPath: "/a", leadPath: "/a", paths: ["/a"] };
    expect(applyTreeClick(current, "scratch", "/d", { toggle: true, range: true }, order).paths).toEqual(["/d"]);
  });
});

describe("moveTreeLead", () => {
  it("moves the cursor by one and single-selects without shift", () => {
    const current: TreeSelection = { scope: "main", anchorPath: "/a/b", leadPath: "/a/b", paths: ["/a/b"] };
    expect(moveTreeLead(current, "main", order, 1, false)).toEqual({
      scope: "main",
      anchorPath: "/a/c",
      leadPath: "/a/c",
      paths: ["/a/c"],
    });
  });

  it("extends the range from the anchor when shift is held", () => {
    const current: TreeSelection = { scope: "main", anchorPath: "/a/b", leadPath: "/a/b", paths: ["/a/b"] };
    expect(moveTreeLead(current, "main", order, 2, true)).toEqual({
      scope: "main",
      anchorPath: "/a/b",
      leadPath: "/d",
      paths: ["/a/b", "/a/c", "/d"],
    });
  });

  it("clamps at the edges and enters from top/bottom when there is no lead", () => {
    const atEnd: TreeSelection = { scope: "main", anchorPath: "/e", leadPath: "/e", paths: ["/e"] };
    expect(moveTreeLead(atEnd, "main", order, 1, false)?.leadPath).toBe("/e");
    expect(moveTreeLead(null, "main", order, 1, false)?.leadPath).toBe("/a");
    expect(moveTreeLead(null, "main", order, -1, false)?.leadPath).toBe("/e");
  });
});
