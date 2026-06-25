// @vitest-environment jsdom

import { getSearchQuery, selectNextOccurrence } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { buildEditorKeymapExtension } from "@/features/workbench/actions/editor-actions";
import { createCodeMirrorExtensions } from "@/features/workbench/codemirror-setup";
import { expandSelection, shrinkSelection, unselectLastOccurrence } from "@/features/workbench/editor-commands";
import { openFind, openReplace } from "@/features/workbench/editor-search-panel";
import type { WorkbenchDocument } from "@/features/workbench/types";

const doc = (overrides: Partial<WorkbenchDocument> = {}): WorkbenchDocument => ({
  id: "d1",
  name: "a.ts",
  path: "a.ts",
  content: "const x = 1\nconst y = 2\n",
  savedContent: "const x = 1\nconst y = 2\n",
  mode: "editable",
  ...overrides,
});

let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
});

const mount = (document: WorkbenchDocument) => {
  const parent = globalThis.document.createElement("div");
  globalThis.document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc: document.content,
      extensions: createCodeMirrorExtensions(
        new Compartment(),
        new Compartment(),
        document,
        () => {},
        buildEditorKeymapExtension({}),
        false,
      ),
    }),
  });
  return view;
};

const sel = (editor: EditorView) => [editor.state.selection.main.from, editor.state.selection.main.to];

describe("Ctrl+Shift+W 缩选:扩选的逆操作", () => {
  it("缩选逐级还原到每一次扩选前的选区", () => {
    const editor = mount(doc());
    editor.dispatch({ selection: { anchor: 2 } }); // 光标落在 const 内

    expandSelection(editor);
    expect(sel(editor)).toEqual([0, 5]); // 词
    expandSelection(editor);
    expect(sel(editor)).toEqual([0, 11]); // 整行

    shrinkSelection(editor);
    expect(sel(editor)).toEqual([0, 5]); // 退回词
    shrinkSelection(editor);
    expect(sel(editor)).toEqual([2, 2]); // 退回原始光标

    expect(shrinkSelection(editor)).toBe(false); // 栈空:无操作
  });

  it("中途手动改动选区会让扩选历史失效", () => {
    const editor = mount(doc());
    editor.dispatch({ selection: { anchor: 2 } });
    expandSelection(editor); // [0,5]

    editor.dispatch({ selection: { anchor: 8 } }); // 手动移动光标 → 清栈

    expect(shrinkSelection(editor)).toBe(false);
  });
});

describe("Alt+Shift+J 取消选中:Alt+J 的逆操作", () => {
  it("Alt+J 累积加选后,从最后加入的开始取消(而非第一个)", () => {
    const editor = mount(doc()); // 两个 "const":0..5 与 12..17
    editor.dispatch({ selection: { anchor: 2 } }); // 光标落在第一个 const 内

    selectNextOccurrence(editor); // 选中词 const(0..5)
    selectNextOccurrence(editor); // 加选第二个 const(12..17)
    expect(editor.state.selection.ranges).toHaveLength(2);

    unselectLastOccurrence(editor);

    // 去掉的是「最后加入」的第二个(12..17),保留第一个(0..5)。
    expect(editor.state.selection.ranges).toHaveLength(1);
    expect(sel(editor)).toEqual([0, 5]);
  });

  it("新增选区(如 Alt+点击多光标)后,取消还原到加入前的选区", () => {
    const editor = mount(doc()); // 初始光标在 0
    editor.dispatch({
      selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(12, 17)], 1),
    });
    expect(editor.state.selection.ranges).toHaveLength(2);

    unselectLastOccurrence(editor);

    // 弹栈还原到「新增前」的选区(初始光标 0)。
    expect(editor.state.selection.ranges).toHaveLength(1);
    expect(editor.state.selection.main.empty).toBe(true);
    expect(sel(editor)).toEqual([0, 0]);
  });

  it("只剩一个选区时收回成光标(取消选中)", () => {
    const editor = mount(doc());
    editor.dispatch({ selection: { anchor: 0, head: 5 } });

    unselectLastOccurrence(editor);

    expect(editor.state.selection.main.empty).toBe(true);
    expect(sel(editor)).toEqual([5, 5]);
  });

  it("已是光标则无操作", () => {
    const editor = mount(doc());
    editor.dispatch({ selection: { anchor: 3 } });
    expect(unselectLastOccurrence(editor)).toBe(false);
  });
});

describe("Ctrl+F / Ctrl+R 以选区文本为查找词", () => {
  it("有选中时 Ctrl+F 用选区文本作查找词并填入查找框", () => {
    const editor = mount(doc());
    editor.dispatch({ selection: { anchor: 0, head: 5 } }); // 选中 "const"

    openFind(editor);

    expect(getSearchQuery(editor.state).search).toBe("const");
    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    expect(input?.value).toBe("const");
  });

  it("再次按下时按新选区文本覆盖原查找词", () => {
    const editor = mount(doc());
    editor.dispatch({ selection: { anchor: 0, head: 5 } });
    openFind(editor);
    expect(getSearchQuery(editor.state).search).toBe("const");

    // 真实流程:要在编辑器里选新文本必先让编辑器获得焦点(否则按键都进查找框)。
    editor.focus();
    editor.dispatch({ selection: { anchor: 6, head: 7 } }); // 选中 "x"
    openFind(editor);

    expect(getSearchQuery(editor.state).search).toBe("x");
    const input = editor.dom.querySelector<HTMLInputElement>(".cm-norn-search-input");
    expect(input?.value).toBe("x");
  });

  it("无选中(仅光标)时保留原查找词", () => {
    const editor = mount(doc());
    editor.dispatch({ selection: { anchor: 0, head: 5 } });
    openFind(editor);
    expect(getSearchQuery(editor.state).search).toBe("const");

    editor.dispatch({ selection: { anchor: 3 } }); // 收成光标
    openFind(editor);

    expect(getSearchQuery(editor.state).search).toBe("const"); // 不被清空
  });

  it("Ctrl+R 同样以选区文本为查找词,并展开替换行", () => {
    const editor = mount(doc());
    editor.dispatch({ selection: { anchor: 0, head: 5 } });

    openReplace(editor);

    expect(getSearchQuery(editor.state).search).toBe("const");
    expect(editor.dom.querySelector(".cm-norn-search-row-replace-open")).not.toBeNull();
  });
});

describe("Ctrl+F / Ctrl+R 查找与替换模式", () => {
  const replaceOpen = (editor: EditorView) =>
    editor.dom.querySelector(".cm-norn-search-row-replace-open") !== null;

  it("Ctrl+F 打开面板且为纯查找(替换行收起)", () => {
    const editor = mount(doc());
    openFind(editor);
    expect(editor.dom.querySelector(".cm-norn-search")).not.toBeNull();
    expect(replaceOpen(editor)).toBe(false);
  });

  it("Ctrl+R 直接切到替换(展开替换行)", () => {
    const editor = mount(doc());
    openReplace(editor);
    expect(replaceOpen(editor)).toBe(true);
  });

  it("先 Ctrl+R 再 Ctrl+F 会收起替换行", () => {
    const editor = mount(doc());
    openReplace(editor);
    expect(replaceOpen(editor)).toBe(true);
    openFind(editor);
    expect(replaceOpen(editor)).toBe(false);
  });
});
