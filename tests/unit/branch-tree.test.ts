import { describe, expect, it } from "vitest";

import { buildBranchTree } from "@/features/workbench/branch-tree";
import type { GitBranch } from "@/features/workbench/types";

const branch = (name: string, kind: GitBranch["kind"] = "local"): GitBranch => ({
  name,
  ahead: 0,
  behind: 0,
  current: false,
  kind,
});

describe("buildBranchTree", () => {
  it("groups nested branches by '/' into folders", () => {
    const tree = buildBranchTree([branch("main"), branch("feature/login"), branch("feature/signup")]);
    expect(tree.map((node) => node.kind)).toEqual(["branch", "folder"]);

    const folder = tree.find((node) => node.kind === "folder");
    expect(folder).toMatchObject({ kind: "folder", name: "feature", path: "feature" });
    if (folder?.kind === "folder") {
      expect(folder.children.map((child) => child.name)).toEqual(["login", "signup"]);
    }
  });

  it("strips a prefix before grouping (remote branches)", () => {
    const tree = buildBranchTree([branch("origin/main", "remote"), branch("origin/feature/x", "remote")], "origin/");
    expect(tree.map((node) => node.name)).toEqual(["main", "feature"]);
    const folder = tree.find((node) => node.kind === "folder");
    expect(folder?.kind === "folder" && folder.children[0]?.name).toBe("x");
  });

  it("nests deeper paths", () => {
    const tree = buildBranchTree([branch("a/b/c")]);
    const a = tree[0];
    expect(a.kind === "folder" && a.name).toBe("a");
    if (a.kind === "folder") {
      const b = a.children[0];
      expect(b.kind === "folder" && b.name).toBe("b");
      if (b.kind === "folder") {
        expect(b.children[0]?.name).toBe("c");
      }
    }
  });
});
