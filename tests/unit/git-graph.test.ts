import { describe, expect, it } from "vitest";

import { assignGraphColumns } from "@/features/workbench/git-graph";
import type { GitLogCommit } from "@/features/workbench/types";

const commit = (hash: string, parents: string[]): GitLogCommit => ({
  hash,
  parents,
  subject: hash,
  body: "",
  author: "t",
  date: "",
  relativeTime: "",
  refs: [],
  isMerge: parents.length > 1,
});

describe("assignGraphColumns", () => {
  it("linear history stays in column 0", () => {
    const result = assignGraphColumns([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
    expect(result.map((c) => c.column)).toEqual([0, 0, 0]);
  });

  it("merge opens a side lane that collapses back at the fork point", () => {
    // m(merge of a,b) -> a -> b -> root；b 是 a 的父，也是 merge 的第二父。
    const result = assignGraphColumns([
      commit("m", ["a", "b"]),
      commit("a", ["b"]),
      commit("b", ["root"]),
      commit("root", []),
    ]);
    const column = (hash: string) => result.find((c) => c.hash === hash)!.column;
    expect(column("m")).toBe(0);
    expect(column("a")).toBe(0);
    // a 与 merge 的第二父都指向 b，b 行应合并回单一泳道。
    expect(column("b")).toBe(0);
    expect(column("root")).toBe(0);
  });

  it("diverged branches occupy distinct columns", () => {
    // 两条独立分支头 x、y，各自有父，互不相关。
    const result = assignGraphColumns([
      commit("x", ["x0"]),
      commit("y", ["y0"]),
      commit("x0", []),
      commit("y0", []),
    ]);
    const column = (hash: string) => result.find((c) => c.hash === hash)!.column;
    expect(column("x")).toBe(0);
    expect(column("y")).toBe(1);
    expect(column("x0")).toBe(0);
    expect(column("y0")).toBe(1);
  });
});
