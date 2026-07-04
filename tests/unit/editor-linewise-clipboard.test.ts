import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { lineWiseSelection } from "@/features/workbench/editor-commands";

const stateWith = (doc: string, selection: EditorSelection) => EditorState.create({ doc, selection });

describe("lineWiseSelection", () => {
  it("selects the whole line incl. trailing newline when nothing is selected", () => {
    const state = stateWith("foo\nbar\nbaz", EditorSelection.single(5)); // 光标在第二行 "bar"
    const sel = lineWiseSelection(state)!;
    expect([sel.main.from, sel.main.to]).toEqual([4, 8]); // "bar\n"
  });

  it("stops at doc end on the last line (no trailing newline to include)", () => {
    const state = stateWith("foo\nbar", EditorSelection.single(6));
    const sel = lineWiseSelection(state)!;
    expect([sel.main.from, sel.main.to]).toEqual([4, 7]); // "bar"
  });

  it("returns null when there is a real selection (leave copy/cut untouched)", () => {
    const state = stateWith("foo\nbar", EditorSelection.single(0, 3));
    expect(lineWiseSelection(state)).toBeNull();
  });

  it("dedupes when multiple cursors sit on the same line", () => {
    const state = stateWith("foo\nbar", EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(6)]));
    const sel = lineWiseSelection(state)!;
    expect(sel.ranges).toHaveLength(1);
  });
});
