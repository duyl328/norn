import { useEffect } from "react";

import { useWorkbenchStore } from "../store/workbench-store";
import { matchKey } from "./registry";
import type { ActionContext } from "./types";
import { useActions } from "./use-actions";

/**
 * 应用级快捷键的唯一全局监听器。
 *
 * 与 CodeMirror 的边界:编辑器命中的按键(光标/缩进/撤销/查找…)会 preventDefault,
 * 因此首行的 defaultPrevented 早退,就能天然让出编辑器内部按键,无需判断焦点。
 */
export function useKeybindings() {
  const { actions, dispatch } = useActions();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      // 在输入框/编辑器里,无修饰键的「裸键」(用户可能自定义绑定)不应触发应用命令;
      // Escape 例外(回到编辑器)。带 Ctrl/Cmd/Alt 的组合不受影响。
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      if (!hasModifier && event.key !== "Escape") {
        const target = event.target as HTMLElement | null;
        const editable = target?.isContentEditable || /^(input|textarea|select)$/i.test(target?.tagName ?? "");
        if (editable) return;
      }

      for (const action of actions) {
        // 编辑器命令归 CodeMirror keymap(聚焦时它先吃并 preventDefault),全局分发器不处理。
        if (action.scope === "editor") continue;
        if (!action.keys?.some((spec) => matchKey(event, spec))) continue;

        const ctx: ActionContext = { store: useWorkbenchStore.getState() };
        if (action.when && !action.when(ctx)) continue;

        event.preventDefault();
        dispatch(action.id);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [actions, dispatch]);
}
