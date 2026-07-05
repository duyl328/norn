import { describe, expect, it } from "vitest";

import { buildSessionSnapshot, isRestorableDoc, parseSession } from "@/features/workbench/session";
import type { WorkbenchDocument } from "@/features/workbench/types";

const doc = (over: Partial<WorkbenchDocument>): WorkbenchDocument => ({
  id: "id",
  name: "n",
  path: "",
  content: "",
  savedContent: "",
  ...over,
});

describe("isRestorableDoc", () => {
  it("skips brand-new empty untitled files", () => {
    expect(isRestorableDoc(doc({ isUntitled: true, content: "", savedContent: "" }))).toBe(false);
  });
  it("keeps untitled drafts that have content", () => {
    expect(isRestorableDoc(doc({ isUntitled: true, content: "hi", savedContent: "" }))).toBe(true);
  });
  it("keeps saved editable files", () => {
    expect(isRestorableDoc(doc({ path: "/a.txt", content: "x", savedContent: "x" }))).toBe(true);
  });
  it("skips diff / large-readonly views", () => {
    expect(isRestorableDoc(doc({ path: "/a", mode: "diff", content: "x", savedContent: "x" }))).toBe(false);
    expect(isRestorableDoc(doc({ path: "/a", mode: "large-readonly", content: "x", savedContent: "x" }))).toBe(false);
  });
});

describe("buildSessionSnapshot", () => {
  it("keeps tab order, records path only for saved files, filters blanks", () => {
    const snap = buildSessionSnapshot({
      openDocuments: [
        doc({ id: "draft1", isUntitled: true, content: "hi" }),
        doc({ id: "blank", isUntitled: true, content: "", savedContent: "" }),
        doc({ id: "saved1", path: "/a.txt", content: "x", savedContent: "x" }),
      ],
      activeId: "saved1",
      folderPath: "/root",
    });
    expect(snap.tabs.map((t) => t.id)).toEqual(["draft1", "saved1"]);
    expect(snap.tabs[0].path).toBeUndefined();
    expect(snap.tabs[1].path).toBe("/a.txt");
    expect(snap.activeId).toBe("saved1");
    expect(snap.folderPath).toBe("/root");
  });
});

describe("parseSession", () => {
  it("returns null for missing / corrupt / wrong-shape data", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("{not json")).toBeNull();
    expect(parseSession(JSON.stringify({ tabs: "nope" }))).toBeNull();
  });
  it("drops tabs without a string id", () => {
    const parsed = parseSession(JSON.stringify({ tabs: [{ id: "ok" }, { path: "/x" }], activeId: 1 }));
    expect(parsed?.tabs.map((t) => t.id)).toEqual(["ok"]);
    expect(parsed?.activeId).toBeNull();
  });
});
