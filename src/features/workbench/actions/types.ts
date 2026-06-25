import type { WorkbenchState } from "../store/workbench-store";

/** 焦点区域:键盘在这些区域间跳转(IDEA 风格)。 */
export type FocusZone = "editor" | "fileTree" | "git";

export type ActionCategory = "File" | "Edit" | "View" | "Git" | "Navigate";

/** action 执行时的上下文:用于 when 判断与跨区域操作。 */
export interface ActionContext {
  store: WorkbenchState;
}

/**
 * 作用域:
 * - "global" 任何地方都可触发(由全局键盘分发器处理)。
 * - "editor" 仅编辑器聚焦时(键位交给 CodeMirror keymap;全局分发器不处理它,
 *   命令面板里仍可执行——落到当前活动 EditorView 上)。
 */
export type ActionScope = "global" | "editor";

export interface Action {
  /** 全局唯一,点分命名,如 "file.save"。也作为原生菜单 payload。 */
  id: string;
  /** 命令面板/菜单展示文案,如 "Save File"。 */
  title: string;
  category: ActionCategory;
  /** 缺省视为 "global"。 */
  scope?: ActionScope;
  /**
   * 默认键位,平台无关写法。"Mod" 在 mac→Cmd / 其它→Ctrl。
   * 可多个;为空则只能从命令面板/菜单触发。例: ["Mod+Shift+S"]。
   */
  keys?: string[];
  /** 不满足时:命令面板置灰、键位不触发。缺省视为始终可用。 */
  when?: (ctx: ActionContext) => boolean;
  run: (ctx: ActionContext) => void | Promise<void>;
}
