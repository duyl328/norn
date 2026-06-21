import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { SaveConflictDialog, UnsavedChangesDialog } from "./components/dialogs";
import { EditorSurface } from "./components/editor-surface";
import { FileTreeNameDialogView, FileTreeTrashDialog } from "./components/file-tree";
import { GitPanel } from "./components/git-panel";
import { ProjectPanel } from "./components/project-panel";
import { SettingsPage } from "./components/settings";
import { StatusBar } from "./components/status-bar";
import { MacTitlebar, PanelResizeHandle, WindowsTitleBar } from "./components/titlebar";
import {
  LARGE_FILE_CHUNK_BYTES,
  LARGE_FILE_CONFIRM_BYTES,
  LARGE_FILE_READONLY_BYTES,
  leftPanelMaxWidth,
  leftPanelMinWidth,
  nativeMenuCommands,
  nativeMenuEvent,
  rightPanelMaxWidth,
  rightPanelMinWidth,
  SUPER_LARGE_FILE_BYTES,
} from "./constants";
import { usePanelLayout } from "./hooks/use-panel-layout";
import { useWorkspaceTree } from "./hooks/use-workspace-tree";
import { useWorkbenchStore } from "./store/workbench-store";
import type {
  NativeSavedTextFile,
  NativeTextFile,
  NativeTextFileInspection,
  NativeTextFileRange,
  PendingFileOpen,
  WorkbenchDocument,
} from "./types";
import {
  createUntitledDocument,
  formatFileSize,
  getFileOpenId,
  getNativeSaveError,
  isAbsolutePath,
  isDocumentDirty,
  isTauriRuntime,
  upsertOpenDocument,
} from "./workbench-utils";

export function WorkbenchPage() {
  const document = useWorkbenchStore((state) => state.document);
  const setDocument = useWorkbenchStore((state) => state.setDocument);
  const openDocuments = useWorkbenchStore((state) => state.openDocuments);
  const setOpenDocuments = useWorkbenchStore((state) => state.setOpenDocuments);
  const leftPanelOpen = useWorkbenchStore((state) => state.leftPanelOpen);
  const setLeftPanelOpen = useWorkbenchStore((state) => state.setLeftPanelOpen);
  const leftPanelWidth = useWorkbenchStore((state) => state.leftPanelWidth);
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen);
  const setRightPanelOpen = useWorkbenchStore((state) => state.setRightPanelOpen);
  const rightPanelWidth = useWorkbenchStore((state) => state.rightPanelWidth);
  const resizingPanel = useWorkbenchStore((state) => state.resizingPanel);
  const resizeHandleHintsVisible = useWorkbenchStore((state) => state.resizeHandleHintsVisible);
  const settingsOpen = useWorkbenchStore((state) => state.settingsOpen);
  const setSettingsOpen = useWorkbenchStore((state) => state.setSettingsOpen);
  const fileError = useWorkbenchStore((state) => state.fileError);
  const setFileError = useWorkbenchStore((state) => state.setFileError);
  const folderView = useWorkbenchStore((state) => state.folderView);
  const setFolderView = useWorkbenchStore((state) => state.setFolderView);
  const gitWorkspace = useWorkbenchStore((state) => state.gitWorkspace);
  const setGitWorkspace = useWorkbenchStore((state) => state.setGitWorkspace);
  const recentFolders = useWorkbenchStore((state) => state.recentFolders);
  const scratchFolder = useWorkbenchStore((state) => state.scratchFolder);
  const scratchFolderView = useWorkbenchStore((state) => state.scratchFolderView);
  const pendingCloseDocument = useWorkbenchStore((state) => state.pendingCloseDocument);
  const setPendingCloseDocument = useWorkbenchStore((state) => state.setPendingCloseDocument);
  const saveConflict = useWorkbenchStore((state) => state.saveConflict);
  const setSaveConflict = useWorkbenchStore((state) => state.setSaveConflict);
  const fileTreeClipboard = useWorkbenchStore((state) => state.fileTreeClipboard);
  const fileTreeContextMenu = useWorkbenchStore((state) => state.fileTreeContextMenu);
  const fileTreeNameDialog = useWorkbenchStore((state) => state.fileTreeNameDialog);
  const fileTreeNameValue = useWorkbenchStore((state) => state.fileTreeNameValue);
  const setFileTreeNameValue = useWorkbenchStore((state) => state.setFileTreeNameValue);
  const fileTreeTrashTarget = useWorkbenchStore((state) => state.fileTreeTrashTarget);
  const setFileTreeTrashTarget = useWorkbenchStore((state) => state.setFileTreeTrashTarget);
  const draggedTreeNode = useWorkbenchStore((state) => state.draggedTreeNode);
  const setDraggedTreeNode = useWorkbenchStore((state) => state.setDraggedTreeNode);
  const dropTarget = useWorkbenchStore((state) => state.dropTarget);
  const setDropTarget = useWorkbenchStore((state) => state.setDropTarget);
  const saveState = useWorkbenchStore((state) => state.saveState);
  const setSaveState = useWorkbenchStore((state) => state.setSaveState);
  const searchOpen = useWorkbenchStore((state) => state.searchOpen);
  const diskChangePromptRef = useRef<string | null>(null);
  const showWindowsTitlebar = useMemo(() => navigator.userAgent.includes("Windows") && isTauriRuntime(), []);
  const showMacTitlebar = useMemo(() => navigator.userAgent.includes("Mac") && isTauriRuntime(), []);
  const isDirty = isDocumentDirty(document);

  const {
    toggleFilesTool,
    openSearchTool,
    closeSearchTool,
    openSettingsTool,
    updateResizeHandleHintsVisible,
    resizePanelWithKeyboard,
    startPanelResize,
  } = usePanelLayout();

  const activateDocument = (nextDocument: WorkbenchDocument) => {
    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));
    setSaveConflict(null);
    setSaveState("saved");
  };

  const closeDocument = (targetDocument: WorkbenchDocument) => {
    const nextDocuments = openDocuments.filter((openDocument) => openDocument.id !== targetDocument.id);

    if (nextDocuments.length === 0) {
      const nextDocument = createUntitledDocument();
      setOpenDocuments([nextDocument]);
      setDocument(nextDocument);
      setSaveConflict(null);
      setSaveState("idle");
      return;
    }

    setOpenDocuments(nextDocuments);

    if (targetDocument.id === document.id) {
      const closedIndex = openDocuments.findIndex((openDocument) => openDocument.id === targetDocument.id);
      const nextDocument = nextDocuments[Math.max(0, Math.min(closedIndex, nextDocuments.length - 1))];
      setDocument(nextDocument);
      setSaveConflict(null);
      setSaveState("saved");
    }
  };

  const requestCloseDocument = (targetDocument: WorkbenchDocument) => {
    if (isDocumentDirty(targetDocument) || targetDocument.isUntitled) {
      setPendingCloseDocument(targetDocument);
      return;
    }

    closeDocument(targetDocument);
  };

  const saveAndClosePendingDocument = async () => {
    const targetDocument = pendingCloseDocument;

    if (!targetDocument) {
      return;
    }

    activateDocument(targetDocument);
    const savedDocument = await saveDocument();

    if (!savedDocument) {
      return;
    }

    setPendingCloseDocument(null);
    closeDocument(savedDocument);
  };

  const saveAsAndClosePendingDocument = async () => {
    const targetDocument = pendingCloseDocument;

    if (!targetDocument) {
      return;
    }

    activateDocument(targetDocument);
    const savedDocument = await saveDocumentAs(targetDocument.content);

    if (!savedDocument) {
      return;
    }

    setPendingCloseDocument(null);
    closeDocument(savedDocument);
  };

  const createFile = () => {
    setFileError(null);
    setLeftPanelOpen(false);
    setFolderView(null);
    setGitWorkspace({ kind: "idle" });
    setSaveConflict(null);
    setSaveState("idle");
    activateDocument(createUntitledDocument());
  };

  const applySavedDocument = (savedFile: NativeSavedTextFile, content: string): WorkbenchDocument => {
    const nextDocument = {
      ...document,
      id: getFileOpenId(savedFile.path, savedFile.lastModified),
      name: savedFile.name,
      path: savedFile.path,
      content,
      savedContent: content,
      size: savedFile.size,
      lastModified: savedFile.lastModified ?? undefined,
      isUntitled: false,
      mode: "editable",
      range: undefined,
    } satisfies WorkbenchDocument;

    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => {
      const withoutPreviousDocument = currentDocuments.filter((openDocument) => openDocument.id !== document.id);

      return upsertOpenDocument(withoutPreviousDocument, nextDocument);
    });
    setSaveConflict(null);
    setSaveState("saved");
    setFileError(null);

    return nextDocument;
  };

  const saveDocumentAs = async (contentOverride?: string): Promise<WorkbenchDocument | null> => {
    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError("Large files are opened in read-only browsing mode and cannot be saved yet.");
      return null;
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError("Native saving is only available in the Tauri desktop app.");
      return null;
    }

    try {
      const path = await invoke<string | null>("open_save_dialog", { defaultName: document.name });

      if (!path) {
        setSaveState(document.content !== document.savedContent ? "idle" : "saved");
        return null;
      }

      const content = contentOverride ?? document.content;
      setSaveState("saving");
      setFileError(null);

      const savedFile = await invoke<NativeSavedTextFile>("save_text_file_as", {
        path,
        content,
      });

      return applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);
      setSaveState("error");
      setFileError(saveError.message ?? "Unable to save this file.");
      return null;
    }
  };

  const saveDocument = async (options: { force?: boolean } = {}): Promise<WorkbenchDocument | null> => {
    if (saveState === "saving") {
      return null;
    }

    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError("Large files are opened in read-only browsing mode and cannot be saved yet.");
      return null;
    }

    if (document.isUntitled || !isAbsolutePath(document.path)) {
      return await saveDocumentAs();
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError("Native saving is only available in the Tauri desktop app.");
      return null;
    }

    const content = document.content;
    setSaveState("saving");
    setFileError(null);

    try {
      const savedFile = await invoke<NativeSavedTextFile>("save_text_file", {
        path: document.path,
        content,
        expectedLastModified: options.force ? null : (document.lastModified ?? null),
        force: options.force ?? false,
      });

      return applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);

      if (saveError.kind === "deleted") {
        setSaveState("idle");
        setFileError(saveError.message ?? "The original file was deleted. Choose a new location to save it.");
        return await saveDocumentAs(content);
      }

      if (saveError.kind === "modified") {
        setSaveState("idle");
        setSaveConflict({
          content,
          lastModified: document.lastModified,
          message: saveError.message ?? "This file was changed outside Norn.",
          path: document.path,
        });
        return null;
      }

      setSaveState("error");
      setFileError(saveError.message ?? "Unable to save this file.");
      return null;
    }
  };

  const reloadConflictedDocument = async () => {
    const conflict = saveConflict;

    if (!conflict) {
      return;
    }

    setSaveConflict(null);
    await openNativeFile(conflict.path);
  };

  const checkCurrentDocumentOnDisk = async () => {
    if (
      !isTauriRuntime() ||
      saveConflict ||
      saveState === "saving" ||
      document.isUntitled ||
      document.mode !== "editable" ||
      !isAbsolutePath(document.path)
    ) {
      return;
    }

    try {
      const inspection = await invoke<NativeTextFileInspection>("inspect_text_file", { path: document.path });
      const diskLastModified = inspection.lastModified ?? undefined;

      if (!diskLastModified || !document.lastModified || diskLastModified === document.lastModified) {
        diskChangePromptRef.current = null;
        return;
      }

      const promptKey = `${document.path}-${diskLastModified}-${document.lastModified}`;

      if (diskChangePromptRef.current === promptKey) {
        return;
      }

      diskChangePromptRef.current = promptKey;
      setSaveState("idle");
      setSaveConflict({
        content: document.content,
        lastModified: document.lastModified,
        message: isDirty
          ? "This file changed on disk while you also have local edits. Choose which version to keep."
          : "This file changed on disk. Reload to use the latest disk version, or keep the current editor version.",
        path: document.path,
      });
    } catch {
      // The next explicit save/open action will surface deleted or unreadable files with a targeted error.
    }
  };

  const openNativeFile = async (path: string, options: { clearFolderView?: boolean; size?: number } = {}) => {
    const { clearFolderView = false, size } = options;

    setFileError(null);
    setSaveConflict(null);

    try {
      const openDocument = openDocuments.find((currentDocument) => currentDocument.path === path);

      if (openDocument) {
        activateDocument(openDocument);

        if (clearFolderView) {
          setFolderView(null);
          setLeftPanelOpen(false);
        }

        return;
      }

      const inspection = await invoke<NativeTextFileInspection>("inspect_text_file", { path });

      if (inspection.isBinary || !inspection.isUtf8) {
        setFileError(`${inspection.name} cannot be opened as UTF-8 text.`);
        return;
      }

      if (inspection.size > LARGE_FILE_READONLY_BYTES) {
        const rangeOffset =
          inspection.size > SUPER_LARGE_FILE_BYTES ? Math.max(0, inspection.size - LARGE_FILE_CHUNK_BYTES) : 0;
        const range = await invoke<NativeTextFileRange>("read_text_file_range", {
          path,
          offset: rangeOffset,
          length: LARGE_FILE_CHUNK_BYTES,
        });
        const contentPrefix = range.hasMoreBefore ? "[Earlier content omitted in large file browsing mode]\n\n" : "";
        const contentSuffix = range.hasMoreAfter ? "\n\n[More content omitted in large file browsing mode]" : "";
        const rangeContent = `${contentPrefix}${range.content}${contentSuffix}`;

        activateDocument({
          id: getFileOpenId(inspection.path, inspection.lastModified),
          name: inspection.name,
          path: inspection.path,
          content: rangeContent,
          savedContent: rangeContent,
          size: inspection.size,
          lastModified: inspection.lastModified ?? undefined,
          mode: "large-readonly",
          range: {
            endOffset: range.endOffset,
            hasMoreAfter: range.hasMoreAfter,
            hasMoreBefore: range.hasMoreBefore,
            startOffset: range.startOffset,
          },
        });
        setSaveState("saved");

        if (clearFolderView) {
          setFolderView(null);
          setLeftPanelOpen(false);
        }

        return;
      }

      if ((typeof size === "number" ? size : inspection.size) > LARGE_FILE_CONFIRM_BYTES) {
        const shouldOpen = window.confirm(`This file is ${formatFileSize(inspection.size)}. Open it as text?`);

        if (!shouldOpen) {
          return;
        }
      }

      const file = await invoke<NativeTextFile>("read_text_file", { path });

      activateDocument({
        id: getFileOpenId(file.path, file.lastModified),
        name: file.name,
        path: file.path,
        content: file.content,
        savedContent: file.content,
        size: file.size,
        lastModified: file.lastModified ?? undefined,
        mode: "editable",
      });
      setSaveState("saved");

      if (clearFolderView) {
        setFolderView(null);
        setLeftPanelOpen(false);
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const continueFileOpen = async (pendingOpen: PendingFileOpen) => {
    if (pendingOpen.kind === "path") {
      await openNativeFile(pendingOpen.path, {
        clearFolderView: pendingOpen.clearFolderView,
        size: pendingOpen.size,
      });
      return;
    }

    if (!isTauriRuntime()) {
      setFileError("Native file opening is only available in the Tauri desktop app.");
      return;
    }

    try {
      const path = await invoke<string | null>("open_file_dialog");

      if (path) {
        await openNativeFile(path, { clearFolderView: true });
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const requestFileOpen = (pendingOpen: PendingFileOpen) => {
    void continueFileOpen(pendingOpen);
  };

  const openFilePicker = () => {
    requestFileOpen({ kind: "file-dialog" });
  };

  const {
    dropTargetRef,
    openFolderView,
    openFolderPicker,
    toggleDirectory,
    toggleRootDirectory,
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
  } = useWorkspaceTree({ requestFileOpen });

  const updateDocumentContent = (content: string) => {
    const currentDocument = useWorkbenchStore.getState().document;

    if (currentDocument.content !== content) {
      const nextDocument = { ...currentDocument, content };
      setDocument(nextDocument);
      setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));
    }

    setSaveState((currentState) => (currentState === "saving" ? currentState : "idle"));
  };

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<string>(nativeMenuEvent, (event) => {
      if (event.payload === nativeMenuCommands.newFile) {
        createFile();
      }

      if (event.payload === nativeMenuCommands.openFile) {
        openFilePicker();
      }

      if (event.payload === nativeMenuCommands.openFolder) {
        openFolderPicker();
      }

      if (event.payload === nativeMenuCommands.saveFile) {
        void saveDocument();
      }

      if (event.payload === nativeMenuCommands.saveFileAs) {
        void saveDocumentAs();
      }

      if (event.payload === nativeMenuCommands.showExplorer) {
        toggleFilesTool();
      }

      if (event.payload === nativeMenuCommands.find) {
        openSearchTool();
      }

      if (event.payload === nativeMenuCommands.toggleGitPanel) {
        setRightPanelOpen((value) => !value);
      }
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
  }, [
    document.content,
    document.savedContent,
    document.path,
    document.lastModified,
    document.mode,
    document.isUntitled,
    saveState,
  ]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const handleFocus = () => {
      void checkCurrentDocumentOnDisk();
    };
    const handleVisibilityChange = () => {
      if (!globalThis.document.hidden) {
        void checkCurrentDocumentOnDisk();
      }
    };

    window.addEventListener("focus", handleFocus);
    globalThis.document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      globalThis.document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    document.path,
    document.lastModified,
    document.content,
    document.mode,
    document.isUntitled,
    isDirty,
    saveConflict,
    saveState,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";

      if (!isSaveShortcut) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        void saveDocumentAs();
        return;
      }

      void saveDocument();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    document.content,
    document.savedContent,
    document.path,
    document.lastModified,
    document.mode,
    document.isUntitled,
    saveState,
  ]);

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          "h-full bg-transparent text-ui text-foreground",
          showMacTitlebar && "mac-titlebar-overlay-layout",
        )}
      >
        {settingsOpen ? (
          <SettingsPage
            gitWorkspace={gitWorkspace}
            onBack={() => setSettingsOpen(false)}
            onToggleResizeHandleHints={() => updateResizeHandleHintsVisible(!resizeHandleHintsVisible)}
            resizeHandleHintsVisible={resizeHandleHintsVisible}
            showMacTitlebar={showMacTitlebar}
          />
        ) : (
          <div className="workspace-view flex h-full min-w-0 flex-col">
            {showWindowsTitlebar ? (
              <WindowsTitleBar
                leftPanelOpen={leftPanelOpen}
                onCreateFile={createFile}
                onToggleLeftPanel={toggleFilesTool}
                onOpenFile={openFilePicker}
                onOpenFolder={openFolderPicker}
                onSaveFile={() => void saveDocument()}
                onSaveFileAs={() => void saveDocumentAs()}
                onOpenSearch={openSearchTool}
                onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
                rightPanelOpen={rightPanelOpen}
                searchOpen={searchOpen}
                onCloseSearch={closeSearchTool}
              />
            ) : null}
            {showMacTitlebar ? (
              <MacTitlebar
                leftPanelOpen={leftPanelOpen}
                onCloseSearch={closeSearchTool}
                onOpenSearch={openSearchTool}
                onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
                rightPanelOpen={rightPanelOpen}
                onToggleLeftPanel={toggleFilesTool}
                searchOpen={searchOpen}
              />
            ) : null}
            <main
              className={cn(
                "workbench-layout grid h-full min-h-0 flex-1 bg-transparent",
                leftPanelOpen && "workbench-layout-left-open",
                rightPanelOpen && "workbench-layout-right-open",
                resizeHandleHintsVisible && "workbench-layout-resize-hints-visible",
                resizingPanel && "workbench-layout-resizing",
              )}
              style={
                {
                  "--workbench-left-panel-width": leftPanelOpen ? `${leftPanelWidth}px` : "0px",
                  "--workbench-right-panel-width": rightPanelOpen ? `${rightPanelWidth}px` : "0px",
                  gridTemplateColumns: `${leftPanelOpen ? `${leftPanelWidth}px` : "0px"} 0px minmax(0,1fr) ${
                    rightPanelOpen ? "12px" : "0px"
                  } ${rightPanelOpen ? `${rightPanelWidth}px` : "0px"}`,
                } as CSSProperties
              }
            >
              <div
                className={cn(
                  "workbench-side-panel workbench-left-panel",
                  !leftPanelOpen && "workbench-side-panel-closed",
                )}
                aria-hidden={!leftPanelOpen}
              >
                <ProjectPanel
                  activePath={document.path}
                  clipboard={fileTreeClipboard}
                  contextMenu={fileTreeContextMenu}
                  draggedNode={draggedTreeNode}
                  dropTarget={dropTarget}
                  folderView={folderView}
                  leftPanelWidth={leftPanelWidth}
                  onContextMenu={openFileTreeContextMenu}
                  onCopyNode={copyTreeNode}
                  onCutNode={cutTreeNode}
                  onDragEnd={() => {
                    setDraggedTreeNode(null);
                    setDropTarget(null);
                    dropTargetRef.current = null;
                  }}
                  onDragNode={setDraggedTreeNode}
                  onDropNode={moveTreeNodeToDirectory}
                  onDropTargetChange={(target) => {
                    setDropTarget(target);
                    dropTargetRef.current = target;
                  }}
                  onOpenFolder={openFolderPicker}
                  onOpenSettings={openSettingsTool}
                  onOpenRecentFolder={(path) => void openFolderView(path, "open-folder")}
                  onOpenTreeFile={openTreeFile}
                  onPasteNode={pasteTreeNode}
                  onRefreshFolder={(path, scope = "main") => void refreshTreePath(scope, path)}
                  onRequestCreateDirectory={(parentPath, scope = "main") =>
                    openFileTreeNameDialog({ kind: "create-directory", parentPath, scope })
                  }
                  onRequestCreateFile={(parentPath, scope = "main") =>
                    openFileTreeNameDialog({ kind: "create-file", parentPath, scope })
                  }
                  onRequestRenameNode={(node, scope = "main") =>
                    openFileTreeNameDialog({ kind: "rename", node, scope })
                  }
                  onRequestTrashNode={requestTrashTreeNode}
                  recentFolders={recentFolders}
                  scratchFolder={scratchFolder}
                  scratchFolderView={scratchFolderView}
                  onToggleScratchDirectory={(node) => void toggleScratchDirectory(node)}
                  onToggleScratchRootDirectory={toggleScratchRootDirectory}
                  onToggleDirectory={toggleDirectory}
                  onToggleRootDirectory={toggleRootDirectory}
                />
              </div>
              <PanelResizeHandle
                max={leftPanelMaxWidth}
                min={leftPanelMinWidth}
                onKeyDown={(event) => resizePanelWithKeyboard("left", event)}
                onPointerDown={(event) => startPanelResize("left", event)}
                open={leftPanelOpen}
                side="left"
                value={leftPanelWidth}
              />
              <EditorSurface
                document={document}
                error={fileError}
                isDirty={isDirty}
                openDocuments={openDocuments}
                onChange={updateDocumentContent}
                onCloseDocument={requestCloseDocument}
                onCreateFile={createFile}
                onSelectDocument={activateDocument}
              />
              <PanelResizeHandle
                max={rightPanelMaxWidth}
                min={rightPanelMinWidth}
                onKeyDown={(event) => resizePanelWithKeyboard("right", event)}
                onPointerDown={(event) => startPanelResize("right", event)}
                open={rightPanelOpen}
                side="right"
                value={rightPanelWidth}
              />
              <div
                className={cn(
                  "workbench-side-panel workbench-right-panel",
                  !rightPanelOpen && "workbench-side-panel-closed",
                )}
                aria-hidden={!rightPanelOpen}
              >
                <GitPanel folderView={folderView} gitWorkspace={gitWorkspace} />
              </div>
            </main>
            <StatusBar
              document={document}
              isDirty={isDirty}
              onOpenSettings={openSettingsTool}
              saveState={saveState}
              gitWorkspace={gitWorkspace}
            />
            <UnsavedChangesDialog
              open={Boolean(pendingCloseDocument)}
              onCancel={() => setPendingCloseDocument(null)}
              onDiscard={() => {
                const targetDocument = pendingCloseDocument;
                setPendingCloseDocument(null);

                if (targetDocument) {
                  closeDocument(targetDocument);
                }
              }}
              onSave={() => void saveAndClosePendingDocument()}
              onSaveAs={() => void saveAsAndClosePendingDocument()}
            />
            <SaveConflictDialog
              open={Boolean(saveConflict)}
              message={saveConflict?.message}
              onCancel={() => setSaveConflict(null)}
              onOverwrite={() => {
                setSaveConflict(null);
                void saveDocument({ force: true });
              }}
              onReload={() => {
                void reloadConflictedDocument();
              }}
              onSaveAs={() => {
                const content = saveConflict?.content;
                setSaveConflict(null);
                void saveDocumentAs(content);
              }}
            />
            <FileTreeNameDialogView
              dialog={fileTreeNameDialog}
              name={fileTreeNameValue}
              onCancel={closeFileTreeNameDialog}
              onNameChange={setFileTreeNameValue}
              onSubmit={() => void submitFileTreeNameDialog()}
            />
            <FileTreeTrashDialog
              node={fileTreeTrashTarget?.node ?? null}
              onCancel={() => setFileTreeTrashTarget(null)}
              onConfirm={() => void confirmTrashTreeNode()}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
