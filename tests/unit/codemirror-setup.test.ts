// @vitest-environment jsdom

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { buildEditorKeymapExtension } from "@/features/workbench/actions/editor-actions";
import { codeMirrorTheme, createCodeMirrorExtensions } from "@/features/workbench/codemirror-setup";
import { pinnedLineNumberHandlers } from "@/features/workbench/editor-pinned-line";
import type { WorkbenchDocument } from "@/features/workbench/types";

const doc = (overrides: Partial<WorkbenchDocument> = {}): WorkbenchDocument => ({
  id: "d1",
  name: "a.ts",
  path: "a.ts",
  content: "const x = 1\nconst y = 2\nconst z = 3\n",
  savedContent: "const x = 1\nconst y = 2\nconst z = 3\n",
  mode: "editable",
  ...overrides,
});

const mountEditor = () => {
  const parent = document.createElement("div");
  document.body.append(parent);

  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: doc().content,
      extensions: createCodeMirrorExtensions(
        new Compartment(),
        new Compartment(),
        new Compartment(),
        doc(),
        () => {},
        buildEditorKeymapExtension({}),
        false,
        2,
      ),
    }),
  });

  return { editor, parent };
};

describe("createCodeMirrorExtensions", () => {
  it("可编辑文档构建出一组扩展", () => {
    const extensions = createCodeMirrorExtensions(
      new Compartment(),
      new Compartment(),
      new Compartment(),
      doc(),
      () => {},
      buildEditorKeymapExtension({}),
      false,
      2,
    );
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);
  });

  it("large-readonly 文档同样能构建扩展(只读分支)", () => {
    const extensions = createCodeMirrorExtensions(
      new Compartment(),
      new Compartment(),
      new Compartment(),
      doc({ mode: "large-readonly" }),
      () => {},
      buildEditorKeymapExtension({}),
      false,
      2,
    );
    expect(extensions.length).toBeGreaterThan(0);
  });

  it("导出的主题是一个扩展", () => {
    expect(codeMirrorTheme).toBeDefined();
  });

  it("点击行号可固定高亮当前行并再次点击取消", () => {
    const { editor, parent } = mountEditor();

    try {
      const event = new MouseEvent("click");
      const line = editor.lineBlockAt(0);

      pinnedLineNumberHandlers.click(editor, line, event);
      expect(editor.dom.querySelector(".cm-pinnedLine")).not.toBeNull();
      expect(editor.dom.querySelector(".cm-pinnedLineGutter")).not.toBeNull();

      pinnedLineNumberHandlers.click(editor, line, event);
      expect(editor.dom.querySelector(".cm-pinnedLine")).toBeNull();
      expect(editor.dom.querySelector(".cm-pinnedLineGutter")).toBeNull();
    } finally {
      editor.destroy();
      parent.remove();
    }
  });

  it("点击多个行号会累积固定高亮多行", () => {
    const { editor, parent } = mountEditor();

    try {
      const event = new MouseEvent("click");

      pinnedLineNumberHandlers.click(editor, editor.lineBlockAt(0), event);
      pinnedLineNumberHandlers.click(editor, editor.lineBlockAt(12), event);

      expect(editor.dom.querySelectorAll(".cm-pinnedLine")).toHaveLength(2);
      expect(editor.dom.querySelectorAll(".cm-lineNumbers .cm-pinnedLineGutter")).toHaveLength(2);
    } finally {
      editor.destroy();
      parent.remove();
    }
  });

  it("按住行号纵向拖动会批量固定经过的行", () => {
    const { editor, parent } = mountEditor();

    try {
      pinnedLineNumberHandlers.mousedown(editor, editor.lineBlockAt(0), new MouseEvent("mousedown", { button: 0 }));
      pinnedLineNumberHandlers.mousemove(editor, editor.lineBlockAt(24), new MouseEvent("mousemove", { buttons: 1 }));
      pinnedLineNumberHandlers.mouseup(editor, editor.lineBlockAt(24), new MouseEvent("mouseup", { button: 0 }));
      pinnedLineNumberHandlers.click(editor, editor.lineBlockAt(24), new MouseEvent("click"));

      expect(editor.dom.querySelectorAll(".cm-pinnedLine")).toHaveLength(3);
      expect(editor.dom.querySelectorAll(".cm-lineNumbers .cm-pinnedLineGutter")).toHaveLength(3);
    } finally {
      editor.destroy();
      parent.remove();
    }
  });

  it("从已高亮行开始拖动会批量取消经过的行", () => {
    const { editor, parent } = mountEditor();

    try {
      pinnedLineNumberHandlers.mousedown(editor, editor.lineBlockAt(0), new MouseEvent("mousedown", { button: 0 }));
      pinnedLineNumberHandlers.mousemove(editor, editor.lineBlockAt(24), new MouseEvent("mousemove", { buttons: 1 }));
      pinnedLineNumberHandlers.mouseup(editor, editor.lineBlockAt(24), new MouseEvent("mouseup", { button: 0 }));
      pinnedLineNumberHandlers.click(editor, editor.lineBlockAt(24), new MouseEvent("click"));
      expect(editor.dom.querySelectorAll(".cm-pinnedLine")).toHaveLength(3);

      pinnedLineNumberHandlers.mousedown(editor, editor.lineBlockAt(12), new MouseEvent("mousedown", { button: 0 }));
      pinnedLineNumberHandlers.mousemove(editor, editor.lineBlockAt(24), new MouseEvent("mousemove", { buttons: 1 }));
      pinnedLineNumberHandlers.mouseup(editor, editor.lineBlockAt(24), new MouseEvent("mouseup", { button: 0 }));
      pinnedLineNumberHandlers.click(editor, editor.lineBlockAt(24), new MouseEvent("click"));

      expect(editor.dom.querySelectorAll(".cm-pinnedLine")).toHaveLength(1);
      expect(editor.dom.querySelectorAll(".cm-lineNumbers .cm-pinnedLineGutter")).toHaveLength(1);
    } finally {
      editor.destroy();
      parent.remove();
    }
  });
});
