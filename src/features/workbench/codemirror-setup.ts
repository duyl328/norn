import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { copyLineDown, defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap, selectNextOccurrence } from "@codemirror/search";
import { type Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";

import {
  altClickToggleCaret,
  expandSelection,
  occurrenceHistory,
  selectionHistory,
  shrinkSelection,
  unselectLastOccurrence,
} from "./editor-commands";
import { foldHoverHighlight } from "./editor-fold-hover";
import { createSmartOverlayExtension } from "./editor-highlighting";
import { indentFoldService } from "./editor-indent-fold";
import { createEditorSearchPanel, openFind, openReplace } from "./editor-search-panel";
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
  // IDEA 习惯键位(放在 searchKeymap 前以覆盖其 Mod-d):
  { key: "Mod-d", run: copyLineDown, preventDefault: true }, // 复制行/选区
  { key: "Mod-w", run: expandSelection, preventDefault: true }, // 扩选:词→行→全文
  { key: "Mod-Shift-w", run: shrinkSelection, preventDefault: true }, // 缩选:扩选的逆操作,逐级还原
  { key: "Alt-j", run: selectNextOccurrence, preventDefault: true }, // 多光标:加选下一个相同词
  { key: "Alt-Shift-j", run: unselectLastOccurrence, preventDefault: true }, // 逆操作:取消最近加选/取消选中
  // 查找/替换走自绘面板:Ctrl+F 纯查找,Ctrl+R 直接切到替换(放在 searchKeymap 前以覆盖其 Mod-f)。
  { key: "Mod-f", run: openFind, preventDefault: true },
  { key: "Mod-r", run: openReplace, preventDefault: true },
  ...searchKeymap, // 其余查找命令:F3/Mod-g 下一个、Shift-F3 上一个等
  ...foldKeymap, // 折叠:Ctrl-Shift-[ 折叠 / Ctrl-Shift-] 展开 / Ctrl-Alt-[ 全部折叠
  // 预留插槽(随对应功能落地时启用):
  // ...completionKeymap, // 代码补全:明确不做
  ...defaultKeymap,
  ...historyKeymap,
]);

export const createCodeMirrorExtensions = (
  languageCompartment: Compartment,
  lineWrappingCompartment: Compartment,
  document: WorkbenchDocument,
  onChange: (content: string) => void,
  lineWrapping: boolean,
): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  // 多光标 / 多选:Alt+点击 加/取消一个光标(点空白处加,点已有光标取消);
  // drawSelection 负责渲染多个光标。列编辑:Alt+拖拽 拉矩形选区。
  // 不用 crosshairCursor —— 按住 Alt 时保留正常的文字 I 形光标。
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of((event) => event.altKey),
  altClickToggleCaret,
  rectangularSelection(),
  // 长行换行:走 compartment,可在不重建编辑器的前提下随设置开关(见 editor-surface)。
  lineWrappingCompartment.of(lineWrapping ? EditorView.lineWrapping : []),
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
  selectionHistory, // Ctrl+Shift+W 缩选所需的扩选历史栈
  occurrenceHistory, // Alt+Shift+J 取消选中所需的加选历史栈
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
