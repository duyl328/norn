import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type MouseEvent, useEffect, useRef } from "react";

import { maxRecentFolders } from "../constants";
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
} from "../types";
import {
  collapseTreeNodesDeep,
  getFileOpenId,
  getNativeFileOperationError,
  getParentPath,
  getPathName,
  getTreeDropTargetFromPoint,
  initialDocument,
  isDocumentDirty,
  isPathInsideOrEqual,
  isTauriRuntime,
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
  expandLoadedScratchNode,
  markFolderLoading,
  markFolderNodeExpanding,
  markScratchLoading,
  toggleFolderNode,
  toggleFolderRoot,
  toggleScratchRoot,
} from "../workspace-tree-reducers";

interface UseWorkspaceTreeParams {
  requestFileOpen: (pendingOpen: PendingFileOpen) => void;
}

export function useWorkspaceTree({ requestFileOpen }: UseWorkspaceTreeParams) {
  const document = useWorkbenchStore((state) => state.document);
  const setDocument = useWorkbenchStore((state) => state.setDocument);
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

      if (node.path === document.path) {
        setDocument((currentDocument) => ({
          ...currentDocument,
          id: getFileOpenId(renamedEntry.path, renamedEntry.lastModified),
          name: renamedEntry.name,
          path: renamedEntry.path,
          lastModified: renamedEntry.lastModified ?? currentDocument.lastModified,
        }));
      }

      closeFileTreeNameDialog();
    } catch (error) {
      setFileTreeError(error, "Unable to update the file tree.");
    }
  };

  const copyTreeNode = (node: FileTreeNode) => {
    setFileTreeClipboard({ action: "copy", node });
    setFileTreeContextMenu(null);
  };

  const cutTreeNode = (node: FileTreeNode) => {
    setFileTreeClipboard({ action: "cut", node });
    setFileTreeContextMenu(null);
  };

  const pasteTreeNode = async (targetDirectoryPath: string, scope: "main" | "scratch" = "main") => {
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot || !fileTreeClipboard) {
      return;
    }

    setFileTreeContextMenu(null);
    setFileError(null);

    try {
      if (fileTreeClipboard.action === "cut") {
        const movedEntry = await invoke<NativeDirectoryEntry>("move_path", {
          workspaceRoot,
          sourcePath: fileTreeClipboard.node.path,
          targetDirectory: targetDirectoryPath,
        });
        await refreshNodeParent(fileTreeClipboard.node, scope);
        await refreshTreePath(scope, targetDirectoryPath);
        setFileTreeClipboard(null);

        if (fileTreeClipboard.node.path === document.path) {
          setDocument((currentDocument) => ({
            ...currentDocument,
            id: getFileOpenId(movedEntry.path, movedEntry.lastModified),
            name: movedEntry.name,
            path: movedEntry.path,
            lastModified: movedEntry.lastModified ?? currentDocument.lastModified,
          }));
        }

        return;
      }

      await invoke<NativeDirectoryEntry>("copy_path", {
        workspaceRoot,
        sourcePath: fileTreeClipboard.node.path,
        targetDirectory: targetDirectoryPath,
      });
      await refreshTreePath(scope, targetDirectoryPath);
    } catch (error) {
      setFileTreeError(error, "Unable to paste into this folder.");
    }
  };

  const requestTrashTreeNode = (node: FileTreeNode, scope: "main" | "scratch" = "main") => {
    setFileTreeContextMenu(null);
    setFileTreeTrashTarget({ node, scope });
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
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (
      !workspaceRoot ||
      source.path === targetDirectoryPath ||
      isPathInsideOrEqual(targetDirectoryPath, source.path)
    ) {
      setDropTarget(null);
      return;
    }

    setFileError(null);

    try {
      const movedEntry = await invoke<NativeDirectoryEntry>("move_path", {
        workspaceRoot,
        sourcePath: source.path,
        targetDirectory: targetDirectoryPath,
      });
      await refreshNodeParent(source, scope);
      await refreshTreePath(scope, targetDirectoryPath);

      if (source.path === document.path) {
        setDocument((currentDocument) => ({
          ...currentDocument,
          id: getFileOpenId(movedEntry.path, movedEntry.lastModified),
          name: movedEntry.name,
          path: movedEntry.path,
          lastModified: movedEntry.lastModified ?? currentDocument.lastModified,
        }));
      }
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

    refreshRootSilently();
    const intervalId = window.setInterval(refreshRootSilently, 12_000);

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

      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [folderView?.rootPath, leftPanelOpen]);

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
          cleanup();
          return;
        }

        unlisten = cleanup;
      })
      .catch(() => {
        unlisten = undefined;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [folderView?.rootPath, scratchFolder?.path]);

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
    toggleScratchDirectory,
    toggleScratchRootDirectory,
    refreshTreePath,
    openTreeFile,
    openFileTreeNameDialog,
    closeFileTreeNameDialog,
    submitFileTreeNameDialog,
    copyTreeNode,
    cutTreeNode,
    pasteTreeNode,
    requestTrashTreeNode,
    confirmTrashTreeNode,
    moveTreeNodeToDirectory,
    openFileTreeContextMenu,
  };
}
