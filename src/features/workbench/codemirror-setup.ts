import { history } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { type Compartment, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";

import { createSmartOverlayExtension } from "./editor-highlighting";
import { createEditorSearchPanel } from "./editor-search-panel";
import type { WorkbenchDocument } from "./types";

export const codeMirrorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "hsl(var(--editor-background))",
    color: "hsl(var(--foreground))",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "12px calc(var(--editor-scrollbar-size) + 8px) calc(var(--editor-scrollbar-size) + 18px) 0",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--editor-gutter))",
    borderRight: "1px solid hsl(var(--border))",
    color: "hsl(var(--muted-foreground))",
    paddingBottom: "calc(var(--editor-scrollbar-size) + 12px)",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.32)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent) / 0.48)",
    color: "hsl(var(--foreground))",
  },
  ".cm-cursor": {
    borderLeftColor: "hsl(var(--primary))",
  },
  ".cm-selectionMatch": {
    backgroundColor: "hsl(var(--primary) / 0.18)",
  },
  // 查找/替换面板为自绘的悬浮卡片(见 editor-search-panel.ts + styles.css)。
  // 把 CodeMirror 顶部面板层绝对定位、脱离布局,使卡片悬浮覆盖在代码之上、不下挤内容;
  // 容器本身穿透点击(pointer-events:none),仅卡片可交互。
  ".cm-panels": {
    backgroundColor: "transparent",
    color: "hsl(var(--foreground))",
  },
  ".cm-panels.cm-panels-top": {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    zIndex: "20",
    borderBottom: "none",
    pointerEvents: "none",
  },
});

/**
 * 编辑器快捷键不再在此写死。统一 keymap 的单一真相源是 action 注册表:
 * - 编辑器命令(查找/注释/行操作…)= scope:"editor" 的 action,由
 *   `actions/editor-actions.buildEditorKeymapExtension` 按「生效键位」生成,
 *   经 keymapCompartment 传入(见 editor-surface),改键/禁用即时生效。
 * - 纯编辑原语(光标/退格/撤销)也在该扩展里(standardKeymap/historyKeymap)。
 * 因此这里只接收一个已装配好的 keymap 扩展。
 */
export const createCodeMirrorExtensions = (
  languageCompartment: Compartment,
  document: WorkbenchDocument,
  onChange: (content: string) => void,
  keymapExtension: Extension,
): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  highlightActiveLine(),
  highlightSelectionMatches(),
  search({ top: true, createPanel: createEditorSearchPanel }),
  keymapExtension,
  languageCompartment.of([]),
  ...createSmartOverlayExtension(document.content.length),
  EditorView.editable.of(document.mode !== "large-readonly"),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  }),
  codeMirrorTheme,
];
