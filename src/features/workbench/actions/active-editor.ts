import type { EditorView } from "@codemirror/view";

/**
 * 当前活动的 CodeMirror 视图。编辑器命令(scope:"editor")从命令面板执行时,
 * 需要落到这个 view 上。由 editor-surface 在创建/销毁时登记。
 */
let activeView: EditorView | null = null;

export const setActiveEditorView = (view: EditorView | null) => {
  activeView = view;
};

export const getActiveEditorView = (): EditorView | null => activeView;
