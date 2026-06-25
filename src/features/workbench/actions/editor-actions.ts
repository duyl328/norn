import { closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  copyLineDown,
  copyLineUp,
  deleteLine,
  defaultKeymap,
  historyKeymap,
  indentLess,
  indentMore,
  indentWithTab,
  moveLineDown,
  moveLineUp,
  selectLine,
  standardKeymap,
  toggleBlockComment,
  toggleComment,
} from "@codemirror/commands";
import { foldAll, foldKeymap, unfoldAll } from "@codemirror/language";
import {
  findNext,
  findPrevious,
  gotoLine,
  searchKeymap,
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { type Command, keymap, type KeyBinding } from "@codemirror/view";

import { getActiveEditorView } from "./active-editor";
import { expandSelection, shrinkSelection, unselectLastOccurrence } from "../editor-commands";
import { openFind, openReplace } from "../editor-search-panel";
import type { Action, ActionCategory } from "./types";

interface EditorActionDef {
  id: string;
  title: string;
  category: ActionCategory;
  keys: string[];
  command: Command;
}

/**
 * B1:住在编辑器里、但属于「应用级命令」的那批(查找/注释/行操作/多选…)。
 * 它们纳入统一注册表 → 可在设置里改键/禁用,键位也存进 keybindings.json。
 * 纯编辑原语(方向键、退格、撤销、全选)不在此处,仍由 CodeMirror standardKeymap/historyKeymap 负责。
 */
export const EDITOR_ACTIONS: readonly EditorActionDef[] = [
  { id: "editor.find", title: "Find in File", category: "Navigate", keys: ["Mod+F"], command: openFind },
  { id: "editor.replace", title: "Replace in File", category: "Edit", keys: ["Mod+R"], command: openReplace },
  { id: "editor.findNext", title: "Find Next", category: "Navigate", keys: ["Mod+G"], command: findNext },
  {
    id: "editor.findPrevious",
    title: "Find Previous",
    category: "Navigate",
    keys: ["Mod+Shift+G"],
    command: findPrevious,
  },
  { id: "editor.gotoLine", title: "Go to Line…", category: "Navigate", keys: ["Mod+Alt+G"], command: gotoLine },
  {
    id: "editor.selectNextOccurrence",
    title: "Select Next Occurrence",
    category: "Edit",
    keys: ["Alt+J"],
    command: selectNextOccurrence,
  },
  {
    id: "editor.unselectLastOccurrence",
    title: "Unselect Last Occurrence",
    category: "Edit",
    keys: ["Alt+Shift+J"],
    command: unselectLastOccurrence,
  },
  {
    id: "editor.selectAllOccurrences",
    title: "Select All Occurrences",
    category: "Edit",
    keys: ["Mod+Shift+L"],
    command: selectSelectionMatches,
  },
  {
    id: "editor.expandSelection",
    title: "Extend Selection",
    category: "Edit",
    keys: ["Mod+W"],
    command: expandSelection,
  },
  {
    id: "editor.shrinkSelection",
    title: "Shrink Selection",
    category: "Edit",
    keys: ["Mod+Shift+W"],
    command: shrinkSelection,
  },
  {
    id: "editor.toggleComment",
    title: "Toggle Line Comment",
    category: "Edit",
    keys: ["Mod+/"],
    command: toggleComment,
  },
  {
    id: "editor.toggleBlockComment",
    title: "Toggle Block Comment",
    category: "Edit",
    keys: ["Shift+Alt+A"],
    command: toggleBlockComment,
  },
  { id: "editor.moveLineUp", title: "Move Line Up", category: "Edit", keys: ["Alt+ArrowUp"], command: moveLineUp },
  {
    id: "editor.moveLineDown",
    title: "Move Line Down",
    category: "Edit",
    keys: ["Alt+ArrowDown"],
    command: moveLineDown,
  },
  {
    id: "editor.copyLineUp",
    title: "Copy Line Up",
    category: "Edit",
    keys: ["Shift+Alt+ArrowUp"],
    command: copyLineUp,
  },
  {
    id: "editor.copyLineDown",
    title: "Copy Line Down",
    category: "Edit",
    keys: ["Mod+D", "Shift+Alt+ArrowDown"],
    command: copyLineDown,
  },
  { id: "editor.deleteLine", title: "Delete Line", category: "Edit", keys: ["Shift+Mod+K"], command: deleteLine },
  { id: "editor.indentMore", title: "Indent", category: "Edit", keys: ["Mod+]"], command: indentMore },
  { id: "editor.indentLess", title: "Outdent", category: "Edit", keys: ["Mod+["], command: indentLess },
  { id: "editor.selectLine", title: "Select Line", category: "Edit", keys: ["Alt+L"], command: selectLine },
  { id: "editor.foldAll", title: "Fold All", category: "Edit", keys: ["Ctrl+Alt+["], command: foldAll },
  { id: "editor.unfoldAll", title: "Unfold All", category: "Edit", keys: ["Ctrl+Alt+]"], command: unfoldAll },
];

/**
 * B2:纯编辑原语,只读展示(不进可改键体系)。用于设置页让用户知道这些键位被占用。
 * 实际绑定来自 CodeMirror 的 standardKeymap / historyKeymap / indentWithTab。
 */
export const EDITOR_PRIMITIVES: ReadonlyArray<{ title: string; keys: string }> = [
  { title: "光标移动 / 选择", keys: "↑ ↓ ← → / Home / End / Mod+←→" },
  { title: "全选", keys: "Mod+A" },
  { title: "换行(自动缩进)", keys: "Enter" },
  { title: "删除字符 / 词", keys: "Backspace / Delete / Mod+Backspace" },
  { title: "撤销 / 重做", keys: "Mod+Z / Mod+Shift+Z" },
  { title: "缩进(Tab)", keys: "Tab / Shift+Tab" },
  { title: "自动闭合括号 / 引号", keys: "() [] {} \" ' `" },
  { title: "折叠当前代码块", keys: "Ctrl+Shift+[ / Ctrl+Shift+]" },
];

/** 我的键位串("Mod+Shift+K")→ CodeMirror 键位串("Mod-Shift-k")。 */
export const specToCmKey = (spec: string): string =>
  spec
    .split("+")
    .map((part) => (/^[a-zA-Z]$/.test(part) ? part.toLowerCase() : part))
    .join("-");

/** 把某编辑器命令包装成统一注册表里的 Action(scope:"editor")。命令面板执行时落到活动 view。 */
export const buildEditorActions = (): Action[] =>
  EDITOR_ACTIONS.map((def) => ({
    id: def.id,
    title: def.title,
    category: def.category,
    scope: "editor",
    keys: def.keys,
    run: () => {
      const view = getActiveEditorView();
      if (!view) return;
      def.command(view);
      view.focus();
    },
  }));

/**
 * 生成编辑器的 CodeMirror keymap:B1(按生效键位,覆盖优先)+ 编辑原语。
 * overrides 变化时由 editor-surface reconfigure。B1 放最前 → 优先级最高。
 */
export const buildEditorKeymapExtension = (overrides: Record<string, string[]>): Extension => {
  const bindings: KeyBinding[] = [];
  const registeredKeys = new Set<string>();

  for (const def of EDITOR_ACTIONS) {
    const keys = overrides[def.id] ?? def.keys;
    for (const spec of keys) {
      const key = specToCmKey(spec);
      registeredKeys.add(key);
      bindings.push({ key, run: def.command, preventDefault: true });
    }
  }

  const unmanagedKeymaps = [...closeBracketsKeymap, ...searchKeymap, ...foldKeymap, ...defaultKeymap].filter(
    (binding) => !binding.key || !registeredKeys.has(binding.key),
  );

  return keymap.of([...bindings, indentWithTab, ...unmanagedKeymaps, ...standardKeymap, ...historyKeymap]);
};
