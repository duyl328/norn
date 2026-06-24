import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { type Compartment, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";

import { foldHoverHighlight } from "./editor-fold-hover";
import { createSmartOverlayExtension } from "./editor-highlighting";
import { indentFoldService } from "./editor-indent-fold";
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
 * 编辑器快捷键的单一装配点。CodeMirror keymap 按数组顺序匹配,先命中先生效,
 * 因此这里的次序即优先级。
 *
 * 所有权边界(Phase 0 约定):
 * - 编辑器内操作(查找/替换、缩进、撤销/重做,以及后续的补全、折叠等)归 CodeMirror,
 *   在此装配 —— 这样在桌面(Tauri)与纯 Web 构建下行为一致。
 * - 应用级操作(新建/打开/保存文件、快速打开 Cmd+P、切换面板)归原生菜单,
 *   在 workbench-page 的菜单事件里处理,不在此处。
 *
 * 新增编辑器功能时,在下方预留的插槽追加对应 keymap,无需改动其余装配。
 */
const editorKeymap = keymap.of([
  indentWithTab,
  ...closeBracketsKeymap, // 自动闭合:闭合符前再敲会跳过、退格删成对括号/引号
  ...searchKeymap, // 查找/替换:Mod-f 打开查找,Mod-Alt-f / Mod-h 替换
  ...foldKeymap, // 折叠:Ctrl-Shift-[ 折叠 / Ctrl-Shift-] 展开 / Ctrl-Alt-[ 全部折叠
  // 预留插槽(随对应功能落地时启用):
  // ...completionKeymap, // 代码补全:明确不做
  ...defaultKeymap,
  ...historyKeymap,
]);

export const createCodeMirrorExtensions = (
  languageCompartment: Compartment,
  document: WorkbenchDocument,
  onChange: (content: string) => void,
): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  codeFolding(),
  indentFoldService,
  foldGutter(),
  foldHoverHighlight,
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  highlightActiveLine(),
  highlightSelectionMatches(),
  search({ top: true, createPanel: createEditorSearchPanel }),
  editorKeymap,
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
