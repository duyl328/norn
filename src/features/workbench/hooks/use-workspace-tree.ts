import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, useEffect, useRef } from "react";

import { maxRecentFolders, workspaceFsChangeEvent, workspaceGitChangeEvent } from "../constants";
import { useWorkbenchStore } from "../store/workbench-store";
import type {
  FileTreeNameDialog,
  FileTreeNode,
  FolderView,
  GitWorkspaceInspection,
  NativeDirectoryEntry,
  NativeDragDropPayload,
  PendingFileOpen,
  ScratchFolder,
  TreeDropTarget,
  TreeSelectionModifiers,
} from "../types";
import {
  applyTreeClick,
  collapseTreeNodesDeep,
  findTreeNode,
  flattenVisibleTreeRows,
  getNativeFileOperationError,
  getParentPath,
  getPathName,
  getTreeAncestorDirectoryPaths,
  getTreeDropTargetFromPoint,
  initialDocument,
  isDocumentDirty,
  isEditorDropTargetFromPoint,
  isPathInsideOrEqual,
  isTauriRuntime,
  moveTreeLead,
  orderedRange,
  remapDocumentAfterMove,
  saveRecentFolders,
  toFileTreeNode,
} from "../workbench-utils";
import {
  applyFolderEntries,
  applyFolderError,
  applyFolderNodeChildren,
  applyScratchEntries,
  applyScratchError,
  collapseAllFolderNodes,
  collapseScratchNode,
  expandAllFolderNodes,
  expandFolderNode,
  expandLoadedScratchNode,
  markFolderLoading,
  markFolderNodeExpanding,
  markScratchLoading,
  toggleFolderNode,
  toggleFolderRoot,
  toggleScratchRoot,
} from "../workspace-tree-reducers";
import { refreshGit } from "./use-git";

interface UseWorkspaceTreeParams {
  requestFileOpen: (pendingOpen: PendingFileOpen) => void;
}

// 卸载事件监听:Tauri 侧若已不认得这个 eventId(dev 下 HMR 重载后就会这样),unlisten 会抛
// unhandled rejection。清理阶段没什么可挽救的,吞掉即可。
const safeUnlisten = (unlisten?: () => void) => {
  try {
    void Promise.resolve(unlisten?.()).catch(() => undefined);
  } catch {
    // 同上:清理失败无需上报。
  }
};

export function useWorkspaceTree({ requestFileOpen }: UseWorkspaceTreeParams) {
  const document = useWorkbenchStore((state) => state.document);
  const setDocument = useWorkbenchStore((state) => state.setDocument);
  const setOpenDocuments = useWorkbenchStore((state) => state.setOpenDocuments);
  const setSaveState = useWorkbenchStore((state) => state.setSaveState);
  const leftPanelOpen = useWorkbenchStore((state) => state.leftPanelOpen);
  const setLeftPanelOpen = useWorkbenchStore((state) => state.setLeftPanelOpen);
  const setFileError = useWorkbenchStore((state) => state.setFileError);
  const folderView = useWorkbenchStore((state) => state.folderView);
  const setFolderView = useWorkbenchStore((state) => state.setFolderView);
  const setGitWorkspace = useWorkbenchStore((state) => state.setGitWorkspace);
  const setRecentFolders = useWorkbenchStore((state) => state.setRecentFolders);
  const scratchFolder = useWorkbenchStore((state) => state.scratchFolder);
  const setScratchFolder = useWorkbenchStore((state) => state.setScratchFolder);
  const setScratchFolderView = useWorkbenchStore((state) => state.setScratchFolderView);
  const fileTreeClipboard = useWorkbenchStore((state) => state.fileTreeClipboard);
  const setFileTreeClipboard = useWorkbenchStore((state) => state.setFileTreeClipboard);
  const fileTreeContextMenu = useWorkbenchStore((state) => state.fileTreeContextMenu);
  const setFileTreeContextMenu = useWorkbenchStore((state) => state.setFileTreeContextMenu);
  const fileTreeNameDialog = useWorkbenchStore((state) => state.fileTreeNameDialog);
  const setFileTreeNameDialog = useWorkbenchStore((state) => state.setFileTreeNameDialog);
  const fileTreeNameValue = useWorkbenchStore((state) => state.fileTreeNameValue);
  const setFileTreeNameValue = useWorkbenchStore((state) => state.setFileTreeNameValue);
  const fileTreeTrashTarget = useWorkbenchStore((state) => state.fileTreeTrashTarget);
  const setFileTreeTrashTarget = useWorkbenchStore((state) => state.setFileTreeTrashTarget);
  const setDraggedTreeNode = useWorkbenchStore((state) => state.setDraggedTreeNode);
  const setDropTarget = useWorkbenchStore((state) => state.setDropTarget);
  const treeSelection = useWorkbenchStore((state) => state.treeSelection);
  const setTreeSelection = useWorkbenchStore((state) => state.setTreeSelection);
  const treeSearch = useWorkbenchStore((state) => state.treeSearch);
  const setTreeSearch = useWorkbenchStore((state) => state.setTreeSearch);

  const dropTargetRef = useRef<TreeDropTarget | null>(null);
  const isDirty = isDocumentDirty(document);

  const readFolderEntries = async (path: string) => {
    const entries = await invoke<NativeDirectoryEntry[]>("list_directory", { path });

    return entries.map(toFileTreeNode);
  };

  const inspectGitWorkspace = async (path: string) => {
    setGitWorkspace({ kind: "loading", workspacePath: path });

    if (!isTauriRuntime()) {
      setGitWorkspace({
        kind: "error",
        workspacePath: path,
        message: "Git 检测仅在 Tauri 桌面应用中可用。",
      });
      return;
    }

    try {
      const inspection = await invoke<GitWorkspaceInspection>("inspect_git_workspace", { path });
      setGitWorkspace({ kind: "ready", inspection });
      if (inspection.isRepository) {
        void refreshGit({ fetch: true });
      }
    } catch (error) {
      setGitWorkspace({
        kind: "error",
        workspacePath: path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const setFileTreeError = (error: unknown, fallback: string) => {
    const operationError = getNativeFileOperationError(error);
    setFileError(operationError.message ?? fallback);
  };

  const refreshFolderPath = async (
    path: string,
    options: { collapseChildren?: boolean; preserveExpansion?: boolean; silent?: boolean } = {},
  ) => {
    if (!folderView) {
      return;
    }

    const collapseChildren = options.collapseChildren ?? true;
    const preserveExpansion = options.preserveExpansion ?? false;

    if (!options.silent) {
      setFolderView((currentView) => (currentView ? markFolderLoading(currentView, path) : currentView));
    }

    try {
      const children = await readFolderEntries(path);
      const nextChildren = collapseChildren ? collapseTreeNodesDeep(children) : children;

      setFolderView((currentView) =>
        currentView ? applyFolderEntries(currentView, path, nextChildren, preserveExpansion) : currentView,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFolderView((currentView) => (currentView ? applyFolderError(currentView, path, message) : currentView));
    }
  };

  const refreshNodeParent = async (node: FileTreeNode, scope: "main" | "scratch" = "main") => {
    if (scope === "scratch") {
      await refreshScratchFolder();
      return;
    }

    if (folderView) {
      await refreshFolderPath(getParentPath(node.path) ?? folderView.rootPath);
    }
  };

  const loadScratchFolderEntries = async (
    folder: ScratchFolder,
    options: { collapseChildren?: boolean; expand?: boolean; path?: string } = {},
  ) => {
    const path = options.path ?? folder.path;
    const expand = options.expand ?? true;
    const collapseChildren = options.collapseChildren ?? true;

    setScratchFolderView((currentView) => markScratchLoading(currentView, folder, path, expand));

    try {
      const children = await readFolderEntries(path);
      const nextChildren = collapseChildren ? collapseTreeNodesDeep(children) : children;
      setScratchFolderView((currentView) => applyScratchEntries(currentView, folder, path, nextChildren, expand));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setScratchFolderView((currentView) => applyScratchError(currentView, folder, path, message));
    }
  };

  const ensureScratchFolder = async () => {
    if (!isTauriRuntime()) {
      setFileError("Scratch folders are only available in the Tauri desktop app.");
      return null;
    }

    try {
      const folder = scratchFolder ?? (await invoke<ScratchFolder>("scratch_folder"));
      setScratchFolder(folder);
      return folder;
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const refreshScratchFolder = async () => {
    const folder = await ensureScratchFolder();

    if (folder) {
      await loadScratchFolderEntries(folder);
    }
  };

  const refreshTreePath = async (scope: "main" | "scratch", path: string) => {
    if (scope === "scratch") {
      const folder = await ensureScratchFolder();

      if (folder) {
        await loadScratchFolderEntries(folder, { path });
      }
      return;
    }

    await refreshFolderPath(path);
  };

  const toggleScratchRootDirectory = () => {
    setScratchFolderView(toggleScratchRoot);
  };

  const toggleScratchDirectory = async (node: FileTreeNode) => {
    if (node.kind !== "directory") {
      return;
    }

    if (node.expanded) {
      setScratchFolderView((currentView) => collapseScratchNode(currentView, node.path));
      return;
    }

    if (node.childrenLoaded) {
      setScratchFolderView((currentView) => expandLoadedScratchNode(currentView, node.path));
      return;
    }

    const folder = await ensureScratchFolder();

    if (folder) {
      await loadScratchFolderEntries(folder, { path: node.path });
    }
  };

  const rememberRecentFolder = (path: string) => {
    const folder = { name: getPathName(path), path };

    setRecentFolders((currentFolders) => {
      const nextFolders = [folder, ...currentFolders.filter((item) => item.path !== path)].slice(0, maxRecentFolders);
      saveRecentFolders(nextFolders);
      return nextFolders;
    });
  };

  const openFolderView = async (rootPath: string, origin: FolderView["origin"]) => {
    setLeftPanelOpen(true);
    setFolderView({
      rootPath,
      rootName: getPathName(rootPath),
      origin,
      nodes: [],
      rootExpanded: true,
      loadingPath: rootPath,
      error: null,
    });

    try {
      const nodes = await readFolderEntries(rootPath);

      setFolderView({
        rootPath,
        rootName: getPathName(rootPath),
        origin,
        nodes,
        rootExpanded: true,
        loadingPath: null,
        error: null,
      });
      rememberRecentFolder(rootPath);
      void inspectGitWorkspace(rootPath);
    } catch (error) {
      setFolderView({
        rootPath,
        rootName: getPathName(rootPath),
        origin,
        nodes: [],
        rootExpanded: true,
        loadingPath: null,
        error: error instanceof Error ? error.message : String(error),
      });
      setGitWorkspace({ kind: "idle" });
    }
  };

  const openFolderPicker = async () => {
    if (!isTauriRuntime()) {
      setFileError("Native folder opening is only available in the Tauri desktop app.");
      return;
    }

    try {
      const path = await invoke<string | null>("open_folder_dialog");

      if (path) {
        await openFolderView(path, "open-folder");
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleDirectory = async (node: FileTreeNode) => {
    if (!folderView || node.kind !== "directory") {
      return;
    }

    if (node.childrenLoaded) {
      setFolderView((currentView) => (currentView ? toggleFolderNode(currentView, node.path) : currentView));
      return;
    }

    setFolderView((currentView) => (currentView ? markFolderNodeExpanding(currentView, node.path) : currentView));

    try {
      const children = await readFolderEntries(node.path);

      setFolderView((currentView) =>
        currentView ? applyFolderNodeChildren(currentView, node.path, children) : currentView,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFolderView((currentView) => (currentView ? applyFolderError(currentView, node.path, message) : currentView));
    }
  };

  const toggleRootDirectory = () => {
    setFolderView((currentView) => (currentView ? toggleFolderRoot(currentView) : currentView));
  };

  const collapseAllDirectories = () => {
    setFolderView((currentView) => (currentView ? collapseAllFolderNodes(currentView) : currentView));
  };

  const expandAllDirectories = () => {
    setFolderView((currentView) => (currentView ? expandAllFolderNodes(currentView) : currentView));
  };

  // 某作用域当前「可见行」(路径 + 名字),方向键导航 / Shift 区间 / 即输即搜都以此顺序为准。
  const getVisibleTreeRows = (scope: "main" | "scratch"): { path: string; name: string }[] => {
    const state = useWorkbenchStore.getState();
    const view = scope === "scratch" ? state.scratchFolderView : state.folderView;
    const expanded = scope === "scratch" ? state.scratchFolderView.expanded : Boolean(state.folderView?.rootExpanded);

    if (!view || !expanded) {
      return [];
    }

    return flattenVisibleTreeRows(view.nodes, 1).map((row) => ({ path: row.node.path, name: row.node.name }));
  };

  const getVisibleTreePaths = (scope: "main" | "scratch"): string[] => getVisibleTreeRows(scope).map((row) => row.path);

  // 即输即搜:在可见行里按名字(不区分大小写、子串)匹配,返回命中行的路径(保持可见顺序)。
  const treeSearchMatches = (scope: "main" | "scratch", query: string): string[] => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [];
    }
    return getVisibleTreeRows(scope)
      .filter((row) => row.name.toLowerCase().includes(needle))
      .map((row) => row.path);
  };

  // 运行/刷新搜索:更新查询;有命中则把选区(光标)落到第一个命中,供滚动定位。
  const runTreeSearch = (scope: "main" | "scratch", query: string) => {
    setTreeSearch(query ? { scope, query } : null);
    const matches = treeSearchMatches(scope, query);
    if (matches.length > 0) {
      setTreeSelection({ scope, anchorPath: matches[0], leadPath: matches[0], paths: [matches[0]] });
    }
  };

  const clearTreeSearch = () => setTreeSearch(null);

  const getTreeNodeByPath = (scope: "main" | "scratch", path: string): FileTreeNode | null => {
    const state = useWorkbenchStore.getState();
    const nodes = scope === "scratch" ? state.scratchFolderView.nodes : (state.folderView?.nodes ?? []);
    return findTreeNode(nodes, path) ?? null;
  };

  const toggleTreeDirectory = (scope: "main" | "scratch", node: FileTreeNode) =>
    scope === "scratch" ? toggleScratchDirectory(node) : toggleDirectory(node);

  // 当前选区中、属于该作用域的节点(用于多选复制/剪切/复制路径)。右键单个节点若不在选区内,只作用于它本身。
  const selectedNodesForScope = (scope: "main" | "scratch"): FileTreeNode[] => {
    const current = useWorkbenchStore.getState().treeSelection;
    if (!current || current.scope !== scope) {
      return [];
    }
    return current.paths
      .map((path) => getTreeNodeByPath(scope, path))
      .filter((node): node is FileTreeNode => Boolean(node));
  };

  const contextActionNodes = (node: FileTreeNode, scope: "main" | "scratch"): FileTreeNode[] => {
    const current = useWorkbenchStore.getState().treeSelection;
    if (current && current.scope === scope && current.paths.length > 1 && current.paths.includes(node.path)) {
      return selectedNodesForScope(scope);
    }
    return [node];
  };

  // 单击文件树某一行:更新多选(高亮),不打开文件、不展开目录。Ctrl/Cmd 切换单项,Shift 选区间。
  // 选中与编辑区打开的文件解耦——展开/折叠树时高亮始终停在上一次点击处。
  const selectTreeNode = (
    node: FileTreeNode,
    modifiers: TreeSelectionModifiers = { toggle: false, range: false },
    scope: "main" | "scratch" = "main",
  ) => {
    clearTreeSearch();
    setTreeSelection((current) => applyTreeClick(current, scope, node.path, modifiers, getVisibleTreePaths(scope)));
  };

  const selectSingleTreePath = (scope: "main" | "scratch", path: string) => {
    setTreeSelection({ scope, anchorPath: path, leadPath: path, paths: [path] });
  };

  const confirmTreeNode = async (scope: "main" | "scratch", node: FileTreeNode) => {
    if (node.kind === "file") {
      await openTreeFile(node);
      return;
    }
    await toggleTreeDirectory(scope, node);
  };

  const writeTextToOsClipboard = (text: string) => {
    void globalThis.navigator?.clipboard?.writeText(text).catch((error) => {
      setFileError(error instanceof Error ? error.message : String(error));
    });
  };

  const joinNodeNames = (nodes: FileTreeNode[]) => nodes.map((node) => node.name).join("\n");
  const joinNodePaths = (nodes: FileTreeNode[], mode: "absolute" | "relative") =>
    nodes.map((node) => (mode === "relative" ? node.relativePath : node.path)).join("\n");

  // Copy/Cut 的统一入口:
  // 1) 放入树内剪贴板 → 树内粘贴 = 复制/移动文件;
  // 2) 原生写入系统剪贴板的「文件引用 + 文件名文本」→ 外部应用粘贴 = 真实文件,文本框粘贴 = 文件名。
  // 原生不支持(Linux)或非 Tauri 时,退回只写文件名文本。
  const putNodesOnClipboard = (nodes: FileTreeNode[], action: "copy" | "cut") => {
    if (nodes.length === 0) {
      return;
    }

    setFileTreeClipboard({ action, nodes });

    const names = joinNodeNames(nodes);

    if (!isTauriRuntime()) {
      writeTextToOsClipboard(names);
      return;
    }

    void invoke<boolean>("copy_files_to_clipboard", { paths: nodes.map((node) => node.path), text: names })
      .then((handledNatively) => {
        if (!handledNatively) {
          writeTextToOsClipboard(names);
        }
      })
      .catch(() => writeTextToOsClipboard(names));
  };

  // Ctrl/Cmd+C / X(键盘)。Ctrl/Cmd+Shift+C 走 copySelectionPaths(系统剪贴板 = 完整路径)。
  const copySelectionToClipboard = (scope: "main" | "scratch", action: "copy" | "cut") => {
    putNodesOnClipboard(selectedNodesForScope(scope), action);
  };

  const copySelectionPaths = (scope: "main" | "scratch", mode: "absolute" | "relative") => {
    const nodes = selectedNodesForScope(scope);
    if (nodes.length > 0) {
      writeTextToOsClipboard(joinNodePaths(nodes, mode));
    }
  };

  // Home/End/PageUp/PageDown:把光标跳到指定行索引(夹紧到范围内),Shift 则以锚点扩选。
  const jumpTreeLead = (
    scope: "main" | "scratch",
    order: string[],
    current: ReturnType<typeof useWorkbenchStore.getState>["treeSelection"],
    targetIndex: number,
    extend: boolean,
  ) => {
    if (order.length === 0) {
      return;
    }
    const clamped = Math.min(order.length - 1, Math.max(0, targetIndex));
    const leadPath = order[clamped];
    if (extend && current?.scope === scope) {
      setTreeSelection({
        scope,
        anchorPath: current.anchorPath,
        leadPath,
        paths: orderedRange(order, current.anchorPath, leadPath),
      });
    } else {
      selectSingleTreePath(scope, leadPath);
    }
  };

  // 搜索态下 ↑↓ 在「命中项」之间循环切换(回绕)。
  const cycleTreeSearchMatch = (scope: "main" | "scratch", query: string, delta: number) => {
    const matches = treeSearchMatches(scope, query);
    if (matches.length === 0) {
      return;
    }
    const selection = useWorkbenchStore.getState().treeSelection;
    const leadPath = selection?.scope === scope ? selection.leadPath : null;
    const index = leadPath ? matches.indexOf(leadPath) : -1;
    const next = index < 0 ? (delta > 0 ? 0 : matches.length - 1) : (index + delta + matches.length) % matches.length;
    selectSingleTreePath(scope, matches[next]);
  };

  // 文件树键盘:类 IDEA。可打印字符直接「即输即搜」;↑↓ 移动光标(搜索态下在命中项间切换,Shift 扩选);
  // ←/→ 折叠/展开;Home/End/PageUp/PageDown 跳转;Enter 打开;Esc 清除搜索;Delete 回收站;
  // Ctrl/Cmd+A 全选、C/X/V 复制/剪切/粘贴、Shift+C 复制路径。
  const handleTreeKeyDown = (scope: "main" | "scratch", event: ReactKeyboardEvent) => {
    const order = getVisibleTreePaths(scope);
    const current = useWorkbenchStore.getState().treeSelection;
    const search = useWorkbenchStore.getState().treeSearch;
    const searching = Boolean(search && search.scope === scope && search.query);
    const leadPath = current && current.scope === scope ? current.leadPath : null;
    const leadNode = leadPath ? getTreeNodeByPath(scope, leadPath) : null;
    const leadIndex = leadPath ? order.indexOf(leadPath) : -1;
    const pageRows = 10;

    // Ctrl/Cmd 组合优先处理(否则字母会被「即输即搜」吃掉)。任何此类操作都视作「操作后」→ 退出搜索。
    if (event.ctrlKey || event.metaKey) {
      clearTreeSearch();
      const letter = event.key.toLowerCase();
      if (letter === "a") {
        if (order.length > 0) {
          event.preventDefault();
          setTreeSelection({ scope, anchorPath: order[0], leadPath: order[order.length - 1], paths: order });
        }
      } else if (letter === "c") {
        event.preventDefault();
        // Shift+C → 复制完整路径;C → 复制文件(+文件名)。
        if (event.shiftKey) {
          copySelectionPaths(scope, "absolute");
        } else {
          copySelectionToClipboard(scope, "copy");
        }
      } else if (letter === "x") {
        event.preventDefault();
        copySelectionToClipboard(scope, "cut");
      } else if (letter === "v") {
        event.preventDefault();
        const root = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;
        const destination =
          (leadNode?.kind === "directory" ? leadNode.path : leadPath ? getParentPath(leadPath) : null) ?? root;
        if (destination) {
          void pasteTreeNode(destination, scope);
        }
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (searching) {
          cycleTreeSearchMatch(scope, search!.query, 1);
        } else {
          setTreeSelection(moveTreeLead(current, scope, order, 1, event.shiftKey));
        }
        return;
      case "ArrowUp":
        event.preventDefault();
        if (searching) {
          cycleTreeSearchMatch(scope, search!.query, -1);
        } else {
          setTreeSelection(moveTreeLead(current, scope, order, -1, event.shiftKey));
        }
        return;
      case "ArrowRight":
        event.preventDefault();
        if (leadNode?.kind === "directory" && !leadNode.expanded) {
          void toggleTreeDirectory(scope, leadNode);
        } else {
          setTreeSelection(moveTreeLead(current, scope, order, 1, false));
        }
        return;
      case "ArrowLeft": {
        event.preventDefault();
        if (leadNode?.kind === "directory" && leadNode.expanded) {
          void toggleTreeDirectory(scope, leadNode);
          return;
        }
        const parentPath = leadPath ? getParentPath(leadPath) : null;
        if (parentPath && order.includes(parentPath)) {
          selectSingleTreePath(scope, parentPath);
        }
        return;
      }
      case "Home":
        event.preventDefault();
        jumpTreeLead(scope, order, current, 0, event.shiftKey);
        return;
      case "End":
        event.preventDefault();
        jumpTreeLead(scope, order, current, order.length - 1, event.shiftKey);
        return;
      case "PageDown":
        event.preventDefault();
        jumpTreeLead(scope, order, current, (leadIndex < 0 ? 0 : leadIndex) + pageRows, event.shiftKey);
        return;
      case "PageUp":
        event.preventDefault();
        jumpTreeLead(scope, order, current, (leadIndex < 0 ? 0 : leadIndex) - pageRows, event.shiftKey);
        return;
      case "Enter":
        event.preventDefault();
        clearTreeSearch();
        if (leadNode) {
          void confirmTreeNode(scope, leadNode);
        }
        return;
      case "Escape":
        if (searching) {
          event.preventDefault();
          clearTreeSearch();
        }
        return;
      case "Delete":
        event.preventDefault();
        clearTreeSearch();
        if (leadNode) {
          requestTrashTreeNode(leadNode, scope);
        }
        return;
      case "Backspace":
        // 搜索态下退格删字符;非搜索态不做破坏性操作(删除走 Delete)。
        if (searching) {
          event.preventDefault();
          runTreeSearch(scope, search!.query.slice(0, -1));
        }
        return;
      default:
        // 即输即搜:可打印单字符 → 追加到查询(保留原始大小写,匹配本身不分大小写)。
        if (event.key.length === 1) {
          event.preventDefault();
          runTreeSearch(scope, (searching ? search!.query : "") + event.key);
        }
        return;
    }
  };

  // 「在文件树中定位当前文件」(类似 IDEA 的 Select Opened File):
  // 把选中行切到编辑区当前文件,并沿其祖先目录链自浅到深逐级「按需加载 + 展开」直到该文件可见。
  // 滚动定位由 FileTreePanel 自身完成(对照高亮的 selectedPath 行)。
  const revealActiveFile = async () => {
    const view = useWorkbenchStore.getState().folderView;
    const targetPath = useWorkbenchStore.getState().document.path;

    if (!view || !targetPath || !isPathInsideOrEqual(targetPath, view.rootPath)) {
      return;
    }

    // 这是唯一一处「自动选中编辑区打开的文件」的入口。
    setTreeSelection({ scope: "main", anchorPath: targetPath, leadPath: targetPath, paths: [targetPath] });

    // 根必须保持展开,否则整棵树不渲染、无从定位。
    if (!view.rootExpanded) {
      setFolderView((currentView) => (currentView ? { ...currentView, rootExpanded: true } : currentView));
    }

    for (const directoryPath of getTreeAncestorDirectoryPaths(targetPath, view.rootPath)) {
      const node = findTreeNode(useWorkbenchStore.getState().folderView?.nodes ?? [], directoryPath);

      if (!node || node.kind !== "directory") {
        // 上层目录尚未加载导致该节点缺失,或路径并非目录:无法继续深入。
        break;
      }

      if (node.childrenLoaded) {
        setFolderView((currentView) => (currentView ? expandFolderNode(currentView, directoryPath) : currentView));
        continue;
      }

      try {
        const children = await readFolderEntries(directoryPath);
        setFolderView((currentView) =>
          currentView ? applyFolderNodeChildren(currentView, directoryPath, children) : currentView,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setFolderView((currentView) =>
          currentView ? applyFolderError(currentView, directoryPath, message) : currentView,
        );
        break;
      }
    }
  };

  const openTreeFile = async (node: FileTreeNode) => {
    if (node.kind !== "file") {
      return;
    }

    requestFileOpen({ kind: "path", path: node.path, size: node.size });
  };

  const openFileTreeNameDialog = (dialog: FileTreeNameDialog) => {
    setFileTreeContextMenu(null);
    setFileTreeNameDialog(dialog);
    setFileTreeNameValue(dialog.kind === "rename" ? dialog.node.name : "");
  };

  const closeFileTreeNameDialog = () => {
    setFileTreeNameDialog(null);
    setFileTreeNameValue("");
  };

  const submitFileTreeNameDialog = async () => {
    if (!fileTreeNameDialog) {
      return;
    }

    const dialogScope = fileTreeNameDialog.scope ?? "main";
    const workspaceRoot = dialogScope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot) {
      setFileError("Unable to determine the active folder.");
      return;
    }

    const name = fileTreeNameValue.trim();

    if (!name) {
      setFileError("Enter a name.");
      return;
    }

    setFileError(null);

    try {
      if (fileTreeNameDialog.kind === "create-file") {
        const entry = await invoke<NativeDirectoryEntry>("create_file", {
          workspaceRoot,
          parentPath: fileTreeNameDialog.parentPath,
          name,
        });

        if (dialogScope === "scratch") {
          await refreshScratchFolder();
        } else {
          await refreshFolderPath(fileTreeNameDialog.parentPath);
        }
        closeFileTreeNameDialog();
        requestFileOpen({ kind: "path", path: entry.path, size: entry.size ?? undefined });
        return;
      }

      if (fileTreeNameDialog.kind === "create-directory") {
        await invoke<NativeDirectoryEntry>("create_directory", {
          workspaceRoot,
          parentPath: fileTreeNameDialog.parentPath,
          name,
        });

        if (dialogScope === "scratch") {
          await refreshScratchFolder();
        } else {
          await refreshFolderPath(fileTreeNameDialog.parentPath);
        }
        closeFileTreeNameDialog();
        return;
      }

      const node = fileTreeNameDialog.node;
      const renamedEntry = await invoke<NativeDirectoryEntry>("rename_path", {
        workspaceRoot,
        path: node.path,
        newName: name,
      });

      await refreshNodeParent(node, dialogScope);

      // 重命名节点可能是已打开文档本身或其祖先目录；document 与 openDocuments(标签列表) 都要同步，
      // 否则切回旧标签会把路径退回旧值、后续保存写向已不存在的旧路径。
      setDocument((currentDocument) => remapDocumentAfterMove(currentDocument, node.path, renamedEntry));
      setOpenDocuments((docs) => docs.map((doc) => remapDocumentAfterMove(doc, node.path, renamedEntry)));

      closeFileTreeNameDialog();
    } catch (error) {
      setFileTreeError(error, "Unable to update the file tree.");
    }
  };

  // 右键菜单的 Copy/Cut:取作用域自菜单状态;选区内的多个节点一起放入剪贴板,否则只放该节点。
  const clipboardScope = () => useWorkbenchStore.getState().fileTreeContextMenu?.scope ?? "main";

  const copyTreeNode = (node: FileTreeNode) => {
    putNodesOnClipboard(contextActionNodes(node, clipboardScope()), "copy");
    setFileTreeContextMenu(null);
  };

  const cutTreeNode = (node: FileTreeNode) => {
    putNodesOnClipboard(contextActionNodes(node, clipboardScope()), "cut");
    setFileTreeContextMenu(null);
  };

  // 右键「复制路径 / 复制相对路径」:把选中节点(或右键单个节点)的路径写入系统剪贴板。多选时换行拼接。
  const copyTreeNodePaths = (node: FileTreeNode, mode: "absolute" | "relative") => {
    const scope = clipboardScope();
    setFileTreeContextMenu(null);
    writeTextToOsClipboard(joinNodePaths(contextActionNodes(node, scope), mode));
  };

  const pasteTreeNode = async (targetDirectoryPath: string, scope: "main" | "scratch" = "main") => {
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot || !fileTreeClipboard || fileTreeClipboard.nodes.length === 0) {
      return;
    }

    const { action, nodes } = fileTreeClipboard;
    setFileTreeContextMenu(null);
    setFileError(null);

    try {
      for (const node of nodes) {
        if (action === "cut") {
          const movedEntry = await invoke<NativeDirectoryEntry>("move_path", {
            workspaceRoot,
            sourcePath: node.path,
            targetDirectory: targetDirectoryPath,
          });
          await refreshNodeParent(node, scope);

          // 移动节点本身或其祖先目录；document 与 openDocuments 标签列表都要同步。
          setDocument((currentDocument) => remapDocumentAfterMove(currentDocument, node.path, movedEntry));
          setOpenDocuments((docs) => docs.map((doc) => remapDocumentAfterMove(doc, node.path, movedEntry)));
        } else {
          await invoke<NativeDirectoryEntry>("copy_path", {
            workspaceRoot,
            sourcePath: node.path,
            targetDirectory: targetDirectoryPath,
          });
        }
      }

      await refreshTreePath(scope, targetDirectoryPath);

      if (action === "cut") {
        setFileTreeClipboard(null);
      }
    } catch (error) {
      setFileTreeError(error, "Unable to paste into this folder.");
    }
  };

  const requestTrashTreeNode = (node: FileTreeNode, scope: "main" | "scratch" = "main") => {
    setFileTreeContextMenu(null);
    setFileTreeTrashTarget({ node, scope });
  };

  const revealTreeNodeInFileManager = (node: FileTreeNode) => {
    setFileTreeContextMenu(null);

    if (!isTauriRuntime()) {
      setFileError("Revealing in the file manager is only available in the Tauri desktop app.");
      return;
    }

    void invoke("reveal_in_file_manager", { path: node.path }).catch((error) => {
      setFileError(error instanceof Error ? error.message : String(error));
    });
  };

  const openTerminalAtNode = (node: FileTreeNode) => {
    setFileTreeContextMenu(null);

    if (!isTauriRuntime()) {
      setFileError("Opening a terminal is only available in the Tauri desktop app.");
      return;
    }

    void invoke("open_terminal_at", { path: node.path }).catch((error) => {
      setFileError(error instanceof Error ? error.message : String(error));
    });
  };

  const confirmTrashTreeNode = async () => {
    if (!fileTreeTrashTarget) {
      return;
    }

    const { node: target, scope } = fileTreeTrashTarget;
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot) {
      return;
    }

    setFileTreeTrashTarget(null);
    setFileError(null);

    try {
      await invoke("trash_path", {
        workspaceRoot,
        path: target.path,
      });
      await refreshNodeParent(target, scope);

      if (isPathInsideOrEqual(document.path, target.path) && !isDirty) {
        setDocument(initialDocument);
        setSaveState("saved");
      }
    } catch (error) {
      setFileTreeError(error, "Unable to move this item to Trash.");
    }
  };

  const moveTreeNodeToDirectory = async (
    source: FileTreeNode,
    targetDirectoryPath: string,
    scope: "main" | "scratch" = "main",
  ) => {
    const targetRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!targetRoot) {
      setDropTarget(null);
      return;
    }

    // 多选拖动:拖的是多选选区内的节点(且选区 > 1)→ 搬整组;否则只搬被拖的这一个。
    const selection = useWorkbenchStore.getState().treeSelection;
    const draggingSelection = Boolean(selection && selection.paths.length > 1 && selection.paths.includes(source.path));
    // 拖拽源所属的树:多选用选区的 scope;否则按路径是否在 scratch 根之内判断。
    const sourceScope: "main" | "scratch" = draggingSelection
      ? selection!.scope
      : scratchFolder && isPathInsideOrEqual(source.path, scratchFolder.path)
        ? "scratch"
        : "main";
    const sources = draggingSelection
      ? selection!.paths
          .map((path) => getTreeNodeByPath(selection!.scope, path))
          .filter((node): node is FileTreeNode => Boolean(node))
      : [source];

    setFileError(null);

    try {
      for (const node of sources) {
        // 跳过无效目标:拖到自身、或拖进自己的子目录。
        if (node.path === targetDirectoryPath || isPathInsideOrEqual(targetDirectoryPath, node.path)) {
          continue;
        }

        if (sourceScope === scope) {
          // 同一棵树内 → 移动。
          const movedEntry = await invoke<NativeDirectoryEntry>("move_path", {
            workspaceRoot: targetRoot,
            sourcePath: node.path,
            targetDirectory: targetDirectoryPath,
          });
          await refreshNodeParent(node, sourceScope);

          // 移动节点本身或其祖先目录；document 与 openDocuments 标签列表都要同步。
          setDocument((currentDocument) => remapDocumentAfterMove(currentDocument, node.path, movedEntry));
          setOpenDocuments((docs) => docs.map((doc) => remapDocumentAfterMove(doc, node.path, movedEntry)));
        } else {
          // 跨树(主 ↔ 临时,根目录不同)→ 复制到目标树。move_path 要求同根,故用只校验目标的 copy_external_paths;源保持不变。
          await invoke<NativeDirectoryEntry[]>("copy_external_paths", {
            workspaceRoot: targetRoot,
            sourcePaths: [node.path],
            targetDirectory: targetDirectoryPath,
          });
        }
      }

      await refreshTreePath(scope, targetDirectoryPath);
    } catch (error) {
      setFileTreeError(error, "Unable to move this item.");
    } finally {
      setDraggedTreeNode(null);
      setDropTarget(null);
      dropTargetRef.current = null;
    }
  };

  const copyExternalPathsIntoTree = async (
    sourcePaths: string[],
    targetDirectoryPath: string,
    scope: "main" | "scratch" = "main",
  ) => {
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot || sourcePaths.length === 0) {
      return;
    }

    setFileError(null);

    try {
      await invoke<NativeDirectoryEntry[]>("copy_external_paths", {
        workspaceRoot,
        sourcePaths,
        targetDirectory: targetDirectoryPath,
      });
      await refreshTreePath(scope, targetDirectoryPath);
    } catch (error) {
      setFileTreeError(error, "Unable to copy dropped files.");
    } finally {
      setDropTarget(null);
      dropTargetRef.current = null;
    }
  };

  const openFileTreeContextMenu = (
    node: FileTreeNode | null,
    event: MouseEvent,
    scope: "main" | "scratch" = "main",
  ) => {
    event.preventDefault();
    clearTreeSearch(); // 右键即进入操作流程 → 退出搜索(菜单里的动作都经此入口)。

    // 右键先选中再弹菜单:右键已在多选内的节点保留整组选区(可对多项一起操作),否则单选该节点。
    if (node) {
      const current = useWorkbenchStore.getState().treeSelection;
      const alreadySelected = current?.scope === scope && current.paths.includes(node.path);
      if (!alreadySelected) {
        setTreeSelection({ scope, anchorPath: node.path, leadPath: node.path, paths: [node.path] });
      }
    }

    setFileTreeContextMenu({ node, scope, x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    if (!folderView || !leftPanelOpen) {
      return;
    }

    let disposed = false;

    const refreshRootSilently = () => {
      if (disposed || globalThis.document.hidden) {
        return;
      }

      void refreshFolderPath(folderView.rootPath, {
        collapseChildren: false,
        preserveExpansion: true,
        silent: true,
      });
    };

    // 实时刷新由 Rust 文件监听器驱动(见下方 effect)。这里只保留聚焦/可见性时的
    // 一次性根目录同步,作为监听器偶尔漏事件(网络盘、inotify 超限退化)时的兜底。
    refreshRootSilently();

    const handleFocus = () => refreshRootSilently();
    const handleVisibilityChange = () => {
      if (!globalThis.document.hidden) {
        refreshRootSilently();
      }
    };

    window.addEventListener("focus", handleFocus);
    globalThis.document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener("focus", handleFocus);
      globalThis.document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [folderView?.rootPath, leftPanelOpen]);

  // git 状态刷新。两条来源:
  // 1. 监听器:.git 里 HEAD/refs/index 变了 = 外部动了 git(终端里 commit、切/删分支、rebase)。
  // 2. 窗口聚焦:兜底。linked worktree 里 .git 是个文件,真正的 gitdir 在监听范围之外,
  //    监听器根本看不到 ref 变化;watcher 启动失败时同理。
  useEffect(() => {
    if (!isTauriRuntime() || !folderView) {
      return;
    }

    const refresh = () => {
      if (!globalThis.document.hidden) {
        void refreshGit();
      }
    };

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen(workspaceGitChangeEvent, () => void refreshGit())
      .then((cleanup) => {
        if (disposed) {
          safeUnlisten(cleanup);
          return;
        }

        unlisten = cleanup;
      })
      .catch(() => undefined);

    window.addEventListener("focus", refresh);
    globalThis.document.addEventListener("visibilitychange", refresh);

    return () => {
      disposed = true;
      safeUnlisten(unlisten);
      window.removeEventListener("focus", refresh);
      globalThis.document.removeEventListener("visibilitychange", refresh);
    };
  }, [folderView?.rootPath]);

  // 文件系统监听(替代轮询):Rust 侧 notify 去抖后上报「受影响目录」,
  // 这里只重新 list 那些「当前已加载」的层级,任意深度的增删改都能近实时反映到树上。
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    // 关闭文件夹(folderView 置空):此时没有并发的 watch_directory,可安全停止监听。
    // 切换文件夹(A→B)不在这里 unwatch——交给 watch_directory 原子替换,
    // 否则 cleanup 的 unwatch 与新 effect 的 watch 是两次并发 IPC,顺序不保证,可能反把新 watcher 清掉。
    if (!folderView) {
      void invoke("unwatch_directory").catch(() => undefined);
      return;
    }

    const rootPath = folderView.rootPath;

    // inotify 句柄超限等启动失败:不报错打断用户,退回靠上面的聚焦刷新兜底。
    void invoke("watch_directory", { path: rootPath }).catch(() => undefined);

    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<string[]>(workspaceFsChangeEvent, (event) => {
      const view = useWorkbenchStore.getState().folderView;

      if (!view) {
        return;
      }

      for (const changedDir of event.payload) {
        if (changedDir === view.rootPath) {
          void refreshFolderPath(changedDir, { collapseChildren: false, preserveExpansion: true, silent: true });
          continue;
        }

        // 未展开/未加载的子树不必刷新——下次展开时自然是最新的。
        const node = findTreeNode(view.nodes, changedDir);

        if (node?.kind === "directory" && node.childrenLoaded) {
          void refreshFolderPath(changedDir, { collapseChildren: false, preserveExpansion: true, silent: true });
        }
      }

      void refreshGit();
    })
      .then((cleanup) => {
        if (disposed) {
          safeUnlisten(cleanup);
          return;
        }

        unlisten = cleanup;
      })
      .catch(() => {
        unlisten = undefined;
      });

    return () => {
      disposed = true;
      safeUnlisten(unlisten);
    };
  }, [folderView?.rootPath]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload as NativeDragDropPayload;
        const target = getTreeDropTargetFromPoint(payload.position);

        if (payload.type === "drop") {
          if (!target && isEditorDropTargetFromPoint(payload.position) && payload.paths?.length) {
            payload.paths.forEach((path) => requestFileOpen({ kind: "path", path }));
            setDropTarget(null);
            dropTargetRef.current = null;
            return;
          }

          const fallbackTarget = scratchFolder
            ? ({ path: scratchFolder.path, scope: "scratch" } satisfies TreeDropTarget)
            : folderView
              ? ({ path: folderView.rootPath, scope: "main" } satisfies TreeDropTarget)
              : null;
          const destination = target ?? dropTargetRef.current ?? fallbackTarget;

          if (destination && payload.paths?.length) {
            void copyExternalPathsIntoTree(payload.paths, destination.path, destination.scope);
          }
          return;
        }

        if (payload.type === "leave" || payload.type === "cancel") {
          setDropTarget(null);
          dropTargetRef.current = null;
          return;
        }

        setDropTarget(target);
        dropTargetRef.current = target;
      })
      .then((cleanup) => {
        if (disposed) {
          safeUnlisten(cleanup);
          return;
        }

        unlisten = cleanup;
      })
      .catch(() => {
        unlisten = undefined;
      });

    return () => {
      disposed = true;
      safeUnlisten(unlisten);
    };
  }, [folderView?.rootPath, requestFileOpen, scratchFolder?.path]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    invoke<ScratchFolder>("scratch_folder")
      .then((folder) => {
        setScratchFolder(folder);
        void loadScratchFolderEntries(folder);
      })
      .catch(() => setScratchFolder(null));
  }, []);

  useEffect(() => {
    if (!fileTreeContextMenu) {
      return;
    }

    const closeContextMenu = () => setFileTreeContextMenu(null);
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", closeWithEscape);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [fileTreeContextMenu]);

  return {
    dropTargetRef,
    openFolderView,
    openFolderPicker,
    toggleDirectory,
    toggleRootDirectory,
    collapseAllDirectories,
    expandAllDirectories,
    revealActiveFile,
    treeSelection,
    treeSearch,
    selectTreeNode,
    handleTreeKeyDown,
    clearTreeSearch,
    toggleScratchDirectory,
    toggleScratchRootDirectory,
    refreshTreePath,
    openTreeFile,
    openFileTreeNameDialog,
    closeFileTreeNameDialog,
    submitFileTreeNameDialog,
    copyTreeNode,
    cutTreeNode,
    copyTreeNodePaths,
    pasteTreeNode,
    requestTrashTreeNode,
    revealTreeNodeInFileManager,
    openTerminalAtNode,
    confirmTrashTreeNode,
    moveTreeNodeToDirectory,
    openFileTreeContextMenu,
  };
}
