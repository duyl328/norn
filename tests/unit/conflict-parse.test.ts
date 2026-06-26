import { describe, expect, it } from "vitest";

import { assembleResolved, hasConflictMarkers, parseConflicts } from "@/features/workbench/conflict-parse";

const sample = ["a", "<<<<<<< HEAD", "ours1", "ours2", "=======", "theirs1", ">>>>>>> branch", "b"].join("\n");

const diff3 = [
  "<<<<<<< HEAD",
  "ours",
  "||||||| base",
  "orig",
  "=======",
  "theirs",
  ">>>>>>> branch",
].join("\n");

describe("conflict-parse", () => {
  it("detects markers", () => {
    expect(hasConflictMarkers(sample)).toBe(true);
    expect(hasConflictMarkers("no conflict here")).toBe(false);
  });

  it("splits context and conflict blocks", () => {
    const blocks = parseConflicts(sample);
    expect(blocks.map((b) => b.kind)).toEqual(["context", "conflict", "context"]);
    const conflict = blocks[1];
    if (conflict.kind === "conflict") {
      expect(conflict.ours).toEqual(["ours1", "ours2"]);
      expect(conflict.theirs).toEqual(["theirs1"]);
    }
  });

  it("ignores diff3 base section", () => {
    const blocks = parseConflicts(diff3);
    const conflict = blocks.find((b) => b.kind === "conflict");
    if (conflict?.kind === "conflict") {
      expect(conflict.ours).toEqual(["ours"]);
      expect(conflict.theirs).toEqual(["theirs"]);
    }
  });

  it("assembles by choice", () => {
    const blocks = parseConflicts(sample);
    expect(assembleResolved(blocks, ["ours"])).toBe(["a", "ours1", "ours2", "b"].join("\n"));
    expect(assembleResolved(blocks, ["theirs"])).toBe(["a", "theirs1", "b"].join("\n"));
    expect(assembleResolved(blocks, ["both"])).toBe(["a", "ours1", "ours2", "theirs1", "b"].join("\n"));
  });

  it("keeps markers when unresolved", () => {
    const blocks = parseConflicts(sample);
    expect(assembleResolved(blocks, ["unresolved"])).toContain("<<<<<<<");
  });
});
