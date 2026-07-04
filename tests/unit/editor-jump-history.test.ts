import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { jumpHistoryField } from "@/features/workbench/editor-commands";

const DOC = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");

const editor = () => EditorState.create({ doc: DOC, extensions: [jumpHistoryField] });

// 模拟一次鼠标点击跳转到某行行首。
const clickLine = (state: EditorState, line: number) =>
  state.update({ selection: { anchor: state.doc.line(line).from }, userEvent: "select.pointer" }).state;

describe("jumpHistoryField", () => {
  it("seeds the pre-jump position then records the click on the first cross-line jump", () => {
    const state = clickLine(editor(), 10); // 光标从 0 跳到第 10 行
    const { positions, index } = state.field(jumpHistoryField);
    expect(positions).toEqual([0, state.doc.line(10).from]);
    expect(index).toBe(1);
  });

  it("ignores same-line clicks", () => {
    const base = EditorState.create({ doc: DOC, extensions: [jumpHistoryField], selection: { anchor: 0 } });
    const line1 = base.doc.line(1).from;
    let state = base.update({ selection: { anchor: line1 + 1 }, userEvent: "select.pointer" }).state;
    state = state.update({ selection: { anchor: line1 + 3 }, userEvent: "select.pointer" }).state;
    expect(state.field(jumpHistoryField).positions).toHaveLength(0);
  });

  it("accumulates one entry per cross-line jump (plus the seeded start)", () => {
    const state = clickLine(clickLine(clickLine(editor(), 5), 10), 15);
    const { positions, index } = state.field(jumpHistoryField);
    expect(positions).toHaveLength(4); // [起点, l5, l10, l15]
    expect(index).toBe(3);
    expect(positions[3]).toBe(state.doc.line(15).from);
  });
});
