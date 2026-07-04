import { closeBrackets } from "@codemirror/autocomplete";
import { history } from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  defaultHighlightStyle,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches, search } from "@codemirror/search";
import { type Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";

import { cjkWordSelect } from "./editor-cjk-word-select";
import {
  altClickToggleCaret,
  copyCutWholeLineWhenEmpty,
  occurrenceHistory,
  selectionHistory,
} from "./editor-commands";
import { foldHoverHighlight } from "./editor-fold-hover";
import { createSmartOverlayExtension } from "./editor-highlighting";
import { indentFoldService } from "./editor-indent-fold";
import { pinnedLineExtension, pinnedLineNumberHandlers } from "./editor-pinned-line";
import { createEditorSearchPanel } from "./editor-search-panel";
import type { WorkbenchDocument } from "./types";

export const codeMirrorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "hsl(var(--editor-background))",
    color: "hsl(var(--foreground))",
    // 字号走 CSS 变量,设置里改字号时由 use-settings-runtime 更新,无需重建编辑器。
    fontSize: "var(--editor-font-size, 13px)",
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

// 流解析器(config/log/text-cue)的 token 颜色原本走内置 defaultHighlightStyle——
// 它是固定的「亮色」配色,暗色模式下偏暗、看不清。这里复用其 tag→样式映射,把颜色
// 改成语义 CSS 变量(见 styles.css 的 --cm-*),由应用的 .dark 类切换亮/暗。
// 不引入 @lezer/highlight:直接复用 defaultHighlightStyle.specs 里的 Tag 实例。
const ORIGINAL_COLOR_TO_VAR: Record<string, string> = {
  "#404740": "var(--cm-meta)", // meta
  "#708": "var(--cm-keyword)", // keyword
  "#219": "var(--cm-property)", // atom/bool/url/labelName
  "#164": "var(--cm-string)", // literal/inserted
  "#a11": "var(--cm-string)", // string/deleted
  "#e40": "var(--cm-special)", // regexp/escape/special(string)
  "#00f": "var(--cm-function)", // definition(variableName)
  "#30a": "var(--cm-property)", // local(variableName)
  "#085": "var(--cm-special)", // typeName/namespace
  "#167": "var(--cm-function)", // className
  "#256": "var(--cm-function)", // special(variableName)/macroName
  "#00c": "var(--cm-property)", // definition(propertyName)
  "#940": "var(--cm-comment)", // comment
  "#f00": "var(--cm-invalid)", // invalid
};

const themedHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) => {
    const mapped = spec.color ? ORIGINAL_COLOR_TO_VAR[spec.color] : undefined;
    // 升级 CodeMirror 后若出现未映射的新配色,它会保留亮色、暗色下看不清——开发期告警提醒补映射。
    if (import.meta.env.DEV && spec.color && !mapped) {
      console.warn(`[codemirror] 未映射的高亮颜色 ${spec.color},请在 ORIGINAL_COLOR_TO_VAR 补充`);
    }
    return mapped ? { ...spec, color: mapped } : spec;
  }),
);

/**
 * 编辑器快捷键不再在此写死。统一 keymap 的单一真相源是 action 注册表:
 * - 编辑器命令(查找/注释/行操作…)= scope:"editor" 的 action,由
 *   `actions/editor-actions.buildEditorKeymapExtension` 按「生效键位」生成,
 *   经 keymapCompartment 传入(见 editor-surface),改键/禁用即时生效。
 * - 纯编辑原语(光标/退格/撤销)也在该扩展里(standardKeymap/historyKeymap)。
 * 因此这里只接收一个已装配好的 keymap 扩展。
 */
/** Tab 宽度 + 缩进单位:走 compartment,可在不重建编辑器的前提下随设置改。 */
export const tabSizeExtension = (tabSize: number): Extension => [
  EditorState.tabSize.of(tabSize),
  indentUnit.of(" ".repeat(tabSize)),
];

export const createCodeMirrorExtensions = (
  languageCompartment: Compartment,
  lineWrappingCompartment: Compartment,
  tabSizeCompartment: Compartment,
  document: WorkbenchDocument,
  onChange: (content: string) => void,
  keymapExtension: Extension,
  lineWrapping: boolean,
  tabSize: number,
): Extension[] => [
  tabSizeCompartment.of(tabSizeExtension(tabSize)),
  lineNumbers({ domEventHandlers: pinnedLineNumberHandlers }),
  pinnedLineExtension,
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  // 多光标 / 多选:Alt+点击 加/取消一个光标(点空白处加,点已有光标取消);
  // drawSelection 负责渲染多个光标。列编辑:Alt+拖拽 拉矩形选区。
  // 不用 crosshairCursor —— 按住 Alt 时保留正常的文字 I 形光标。
  EditorState.allowMultipleSelections.of(true),
  EditorView.clickAddsSelectionRange.of((event) => event.altKey),
  altClickToggleCaret,
  cjkWordSelect, // 双击中文按词典分词选「词语」,而非整串连续汉字
  copyCutWholeLineWhenEmpty, // 无选中时 Ctrl/Cmd+C、Ctrl/Cmd+X 先选中整行再复制/剪切
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
  syntaxHighlighting(themedHighlightStyle, { fallback: true }),
  highlightActiveLine(),
  highlightSelectionMatches(),
  search({ top: true, createPanel: createEditorSearchPanel }),
  selectionHistory, // Ctrl+Shift+W 缩选所需的扩选历史栈
  occurrenceHistory, // Alt+Shift+J 取消选中所需的加选历史栈
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
