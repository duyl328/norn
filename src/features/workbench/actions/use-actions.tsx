import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useWorkbenchStore } from "../store/workbench-store";
import { saveKeymapOverrides } from "../workbench-utils";
import { buildEditorActions } from "./editor-actions";
import { focusZone, isZoneFocused } from "./focus-zones";
import type { Action, ActionContext } from "./types";

/** useActions 需要的回调:全部复用 workbench-page 已有的 hook 输出,这里不重写业务逻辑。 */
export interface ActionDeps {
  createFile: () => void;
  openFilePicker: () => void;
  openFolderPicker: () => void;
  saveDocument: () => void | Promise<unknown>;
  saveDocumentAs: () => void | Promise<unknown>;
  toggleFilesTool: () => void;
  openSearchTool: () => void;
  openSettingsTool: () => void;
}

/** action 列表的唯一真相源。键位为 IDEA 风格;"Mod"=Cmd(mac)/Ctrl(其它)。 */
export const buildActions = (deps: ActionDeps): Action[] => {
  const store = () => useWorkbenchStore.getState();
  const closeSettings = () => store().setSettingsOpen(false);

  return [
    {
      id: "file.new",
      title: "New File",
      category: "File",
      keys: ["Mod+N"],
      run: () => {
        closeSettings();
        deps.createFile();
      },
    },
    {
      id: "file.open",
      title: "Open File…",
      category: "File",
      keys: ["Mod+O"],
      run: () => {
        closeSettings();
        deps.openFilePicker();
      },
    },
    {
      id: "file.openFolder",
      title: "Open Folder…",
      category: "File",
      keys: ["Mod+Shift+O"],
      run: () => {
        closeSettings();
        deps.openFolderPicker();
      },
    },
    {
      id: "file.save",
      title: "Save File",
      category: "File",
      keys: ["Mod+S"],
      run: () => void deps.saveDocument(),
    },
    {
      id: "file.saveAs",
      title: "Save File As…",
      category: "File",
      keys: ["Mod+Shift+S"],
      run: () => void deps.saveDocumentAs(),
    },
    {
      id: "navigate.commandPalette",
      title: "Find Action…",
      category: "Navigate",
      keys: ["Mod+Shift+A"],
      run: () => store().setCommandPaletteOpen(true),
    },
    {
      id: "navigate.goToFile",
      title: "Go to File…",
      category: "Navigate",
      keys: ["Mod+P"],
      run: () => deps.openSearchTool(),
    },
    {
      id: "navigate.focusFileTree",
      title: "Focus File Tree",
      category: "Navigate",
      keys: ["Alt+1"],
      // IDEA 语义:未开→开并聚焦;已开且焦点已在内→收起(焦点回编辑器);已开但焦点在别处→聚焦。
      run: () => {
        const s = store();
        if (!s.leftPanelOpen) {
          s.setLeftPanelOpen(true);
          focusZone("fileTree");
        } else if (isZoneFocused("fileTree")) {
          s.setLeftPanelOpen(false);
          focusZone("editor");
        } else {
          focusZone("fileTree");
        }
      },
    },
    {
      id: "navigate.focusGit",
      title: "Focus Git Panel",
      category: "Navigate",
      keys: ["Alt+9"],
      run: () => {
        const s = store();
        if (!s.rightPanelOpen) {
          s.setRightPanelOpen(true);
          focusZone("git");
        } else if (isZoneFocused("git")) {
          s.setRightPanelOpen(false);
          focusZone("editor");
        } else {
          focusZone("git");
        }
      },
    },
    {
      id: "navigate.backToEditor",
      title: "Back to Editor",
      category: "Navigate",
      keys: ["Escape"],
      // 有弹窗/面板打开时 Esc 归它们处理,这里只在「无模态」时把焦点拉回编辑器。
      when: (ctx) => !ctx.store.commandPaletteOpen && !ctx.store.searchOpen && !ctx.store.settingsOpen,
      run: () => focusZone("editor"),
    },
    {
      id: "view.toggleExplorer",
      title: "Toggle File Tree",
      category: "View",
      run: () => deps.toggleFilesTool(),
    },
    {
      id: "view.toggleGit",
      title: "Toggle Git Panel",
      category: "View",
      run: () => store().setRightPanelOpen((value) => !value),
    },
    {
      id: "view.settings",
      title: "Open Settings",
      category: "View",
      run: () => deps.openSettingsTool(),
    },
  ];
};

interface ActionsApi {
  /** 应用了用户自定义后的有效键位(keys 即生效键位)。 */
  actions: Action[];
  /** 按 id 执行(when 不通过则忽略)。供菜单、命令面板、原生菜单事件复用。 */
  dispatch: (id: string) => void;
  /** 某 action 的出厂默认键位(用于「是否已改」「重置」判断)。 */
  defaultKeysOf: (id: string) => string[];
  /** 把某 action 绑定到键位(自动解绑占用同一键位的其它 action),持久化。 */
  setBinding: (id: string, spec: string) => void;
  /** 清除某 action 的自定义键位,恢复默认。 */
  resetBinding: (id: string) => void;
}

// 默认值是无害空实现:Provider 缺席时(如隔离的组件单测)useActions 返回空列表 + 空分发,
// 而非抛错。真实应用树里始终有 ActionsProvider 提供真实值。
const ActionsContext = createContext<ActionsApi>({
  actions: [],
  dispatch: () => {},
  defaultKeysOf: () => [],
  setBinding: () => {},
  resetBinding: () => {},
});

export function ActionsProvider({ deps, children }: { deps: ActionDeps; children: ReactNode }) {
  const overrides = useWorkbenchStore((state) => state.keymapOverrides);
  const setKeymapOverrides = useWorkbenchStore((state) => state.setKeymapOverrides);

  const api = useMemo<ActionsApi>(() => {
    // 统一注册表 = 应用级 action(global) + 编辑器命令(editor, B1)。键位都受 overrides 影响。
    const base = [...buildActions(deps), ...buildEditorActions()];
    const defaultsById = new Map(base.map((action) => [action.id, action.keys ?? []]));

    // 有效 action:键位取「自定义优先,否则默认」。所有消费方(分发器/面板/菜单/设置)都读这份。
    const actions = base.map((action) => ({ ...action, keys: overrides[action.id] ?? action.keys }));
    const byId = new Map(actions.map((action) => [action.id, action]));

    const dispatch = (id: string) => {
      const action = byId.get(id);
      if (!action) return;
      const ctx: ActionContext = { store: useWorkbenchStore.getState() };
      if (action.when && !action.when(ctx)) return;
      void action.run(ctx);
    };

    const defaultKeysOf = (id: string) => defaultsById.get(id) ?? [];

    const persist = (next: Record<string, string[]>) => {
      setKeymapOverrides(next);
      void saveKeymapOverrides(next);
    };

    const setBinding = (id: string, spec: string) => {
      const next: Record<string, string[]> = {};
      // 先把 spec 从其它 action 的有效键位中摘除(保持全局无冲突),再绑给目标。
      for (const action of actions) {
        if (action.id === id) continue;
        const remaining = (action.keys ?? []).filter((key) => key !== spec);
        if (remaining.length !== (action.keys ?? []).length) {
          next[action.id] = remaining;
        } else if (overrides[action.id]) {
          next[action.id] = overrides[action.id];
        }
      }
      next[id] = [spec];
      persist(next);
    };

    const resetBinding = (id: string) => {
      const next = { ...overrides };
      delete next[id];
      persist(next);
    };

    return { actions, dispatch, defaultKeysOf, setBinding, resetBinding };
    // deps 的回调每次渲染都是新引用但语义稳定;真正影响 keys 的是 overrides。
  }, [deps, overrides, setKeymapOverrides]);

  return <ActionsContext.Provider value={api}>{children}</ActionsContext.Provider>;
}

export const useActions = (): ActionsApi => useContext(ActionsContext);
