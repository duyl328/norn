// @vitest-environment jsdom
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { type GitChunkLabels, gitChangeGutter, revertChunk } from "@/features/workbench/editor-git-gutter";
import { chunkWordOps, lineChunks } from "@/features/workbench/line-diff";

const labels: GitChunkLabels = () => ({
  close: "关闭",
  copy: "复制",
  meta: () => "1 行修改",
  next: "下一处",
  openDiff: "完整差异",
  previous: "上一处",
  revert: "撤回",
});

/** 撤回一块改动后，那块内容应回到 HEAD 的样子（其余行不动）。 */
const revertOnce = (original: string, current: string, index = 0) => {
  const chunks = lineChunks(original, current);
  const doc = Text.of(current.split("\n"));
  const change = revertChunk(doc, chunks[index]);
  return doc.replace(change.from, change.to, Text.of(change.insert.split("\n"))).toString();
};

describe("editor git gutter", () => {
  it("识别增 / 删 / 改三种块", () => {
    const chunks = lineChunks("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(chunks.map((chunk) => chunk.kind)).toEqual(["mod", "add"]);
    expect(lineChunks("a\nb\nc\n", "a\nc\n")[0]).toMatchObject({ kind: "del", original: ["b"] });
  });

  // 「连续差异」内部要再切:新增的尾巴单独成绿块,否则整段判成「修改」全涂蓝。
  it("一段连续差异里,多出来的新增行单独切成 add 块", () => {
    expect(lineChunks("x\nb\nc\n", "x\nB\nC\nD\n")).toMatchObject([
      { kind: "mod", fromLine: 2, toLine: 3, original: ["b", "c"], origFrom: 2, origTo: 3 },
      { kind: "add", fromLine: 4, toLine: 4, original: [], origFrom: 4, origTo: 3 }, // HEAD 侧空区间
    ]);
  });

  it("旧行多于新行时不切:多出的旧行留在 mod 块里,撤回能一起还原", () => {
    const chunks = lineChunks("x\na\nb\nc\n", "x\nA\n");
    expect(chunks).toMatchObject([{ kind: "mod", fromLine: 2, toLine: 2, original: ["a", "b", "c"] }]);
    expect(revertOnce("x\na\nb\nc\n", "x\nA\n")).toBe("x\na\nb\nc\n");
  });

  it("撤回改动块 → 写回原始行", () => {
    expect(revertOnce("a\nb\nc\n", "a\nB\nc\n")).toBe("a\nb\nc\n");
  });

  it("撤回新增块 → 连同换行删掉，不留空行", () => {
    expect(revertOnce("a\nb\n", "a\nX\nY\nb\n")).toBe("a\nb\n");
    expect(revertOnce("a\nb\n", "a\nb\nX")).toBe("a\nb\n"); // 文末新增
  });

  it("撤回删除块 → 原始行插回原位（含文首）", () => {
    expect(revertOnce("a\nb\nc\n", "a\nc\n")).toBe("a\nb\nc\n");
    expect(revertOnce("a\nb\n", "b\n")).toBe("a\nb\n"); // 删的是第一行
  });

  // 曾经的 bug:基线只靠异步 effect dispatch 进去,视图一重建(切文档 setState / HMR)StateField 就复位,
  // 改动条整片消失。基线必须在建 state 时就灌进扩展。
  it("建 state 时就带上基线 → 立刻有改动装饰,不依赖后续 dispatch", () => {
    const state = EditorState.create({
      doc: "a\nB\nc\n",
      extensions: [gitChangeGutter("a\nb\nc\n", labels)],
    });
    const sets = state.facet(EditorView.decorations).filter((value) => typeof value !== "function");
    expect(sets.some((set) => set.size > 0)).toBe(true);
  });

  // 同一处替换在编辑区和浮层里必须同色(pair 号相同),否则「谁对应谁」全靠猜。
  it("词级切片:替换两侧同 pair 号,纯删除在新行侧留零宽锚点", () => {
    const [row] = chunkWordOps(['  theme: "system",'], ['  theme: "dark",']);
    const pairs = row.oldOps.filter((op) => op.kind === "pair");
    expect(pairs).toHaveLength(1);
    expect(row.newOps.filter((op) => op.kind === "pair").map((op) => op.pair)).toEqual(pairs.map((op) => op.pair));

    const [deleted] = chunkWordOps(["  fontSize: 16, compactMode: true,"], ["  fontSize: 16,"]);
    expect(deleted.newOps.some((op) => op.kind === "del")).toBe(true); // 锚点位置由它给出
    expect(deleted.oldOps.some((op) => op.kind === "del")).toBe(true);
  });
});
