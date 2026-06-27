import { EditorView } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { getActiveEditorView } from "./actions/active-editor";
import { openGoToLineRequestEvent } from "./actions/editor-actions";
import { type ActionDeps, ActionsProvider, useActions } from "./actions/use-actions";
import { useKeybindings } from "./actions/use-keybindings";
import { CommandPalette } from "./components/command-palette";
import { SaveConflictDialog, UnsavedChangesDialog } from "./components/dialogs";
import { EditorSurface } from "./components/editor-surface";
import { FileTreeNameDialogView, FileTreeTrashDialog } from "./components/file-tree";
import { GitPanel } from "./components/git-panel";
import { ProjectPanel } from "./components/project-panel";
import { SettingsPage } from "./components/settings";
import { StatusBar } from "./components/status-bar";
import { MacTitlebar, PanelResizeHandle, WindowsTitleBar } from "./components/titlebar";
import {
  leftPanelMaxWidth,
  leftPanelMinWidth,
  nativeMenuCommands,
  nativeMenuEvent,
  nativeOpenFilesEvent,
  rightPanelMaxWidth,
  rightPanelMinWidth,
} from "./constants";
import { useDocumentSession } from "./hooks/use-document-session";
import { gitActions } from "./hooks/use-git";
import { usePanelLayout } from "./hooks/use-panel-layout";
import { useSettingsRuntime } from "./hooks/use-settings-runtime";
import { useWorkspaceTree } from "./hooks/use-workspace-tree";
import { isMac, isWindows } from "./platform";
import { loadSettings } from "./settings";
import { useWorkbenchStore } from "./store/workbench-store";
import { hasSeenWelcome } from "./welcome";
import { startWelcomeTour } from "./welcome-tour";
import {
  isDocumentDirty,
  isTauriRuntime,
  loadKeymapOverrides,
  requiresDocumentCloseConfirmation,
} from "./workbench-utils";

export function WorkbenchPage() {
  const document = useWorkbenchStore((state) => state.document);
  const openDocuments = useWorkbenchStore((state) => state.openDocuments);
  const leftPanelOpen = useWorkbenchStore((state) => state.leftPanelOpen);
  const leftPanelWidth = useWorkbenchStore((state) => state.leftPanelWidth);
  const rightPanelOpen = useWorkbenchStore((state) => state.rightPanelOpen);
  const setRightPanelOpen = useWorkbenchStore((state) => state.setRightPanelOpen);
  const rightPanelWidth = useWorkbenchStore((state) => state.rightPanelWidth);
  const resizingPanel = useWorkbenchStore((state) => state.resizingPanel);
  const resizeHandleHintsVisible = useWorkbenchStore((state) => state.resizeHandleHintsVisible);
  const settingsOpen = useWorkbenchStore((state) => state.settingsOpen);
  const setSettingsOpen = useWorkbenchStore((state) => state.setSettingsOpen);
  const fileError = useWorkbenchStore((state) => state.fileError);
  const folderView = useWorkbenchStore((state) => state.folderView);
  const gitWorkspace = useWorkbenchStore((state) => state.gitWorkspace);
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
  const searchOpen = useWorkbenchStore((state) => state.searchOpen);
  const showStatusBar = useWorkbenchStore((state) => state.showStatusBar);
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const showWindowsTitlebar = useMemo(() => isWindows(), []);
  const showMacTitlebar = useMemo(() => isMac(), []);
  const isDirty = isDocumentDirty(document);
  const gitBadgeCount = gitStatus?.changes.length ?? 0;
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [goToLineRequestId, setGoToLineRequestId] = useState(0);

  const {
    toggleFilesTool,
    openSearchTool,
    closeSearchTool,
    openSettingsTool,
    resizePanelWithKeyboard,
    startPanelResize,
  } = usePanelLayout();

  const {
    activateDocument,
    openDiff,
    openCommitDiff,
    closeDocument,
    requestCloseDocument,
    saveAndClosePendingDocument,
    saveAsAndClosePendingDocument,
    createFile,
    saveDocument,
    saveDocumentAs,
    reloadConflictedDocument,
    openFilePicker,
    requestFileOpen,
    updateDocumentContent,
    changeDocumentEncoding,
  } = useDocumentSession();

  const goToLine = (line: number, column = 1) => {
    const view = getActiveEditorView();
    if (!view) return;

    const targetLine = Math.min(Math.max(Math.trunc(line), 1), view.state.doc.lines);
    const lineInfo = view.state.doc.line(targetLine);
    const targetColumn = Math.max(Math.trunc(column), 1);
    const pos = Math.min(lineInfo.from + targetColumn - 1, lineInfo.to);
    view.dispatch({
      selection: { anchor: pos, head: pos },
      effects: EditorView.scrollIntoView(pos, { x: "nearest", y: "center" }),
      scrollIntoView: true,
    });
    view.focus();
  };

  const cancelGoToLine = () => {
    getActiveEditorView()?.focus();
  };

  useEffect(() => {
    const openGoToLine = () => setGoToLineRequestId((value) => value + 1);
    window.addEventListener(openGoToLineRequestEvent, openGoToLine);
    return () => window.removeEventListener(openGoToLineRequestEvent, openGoToLine);
  }, []);

  const changeDocumentLineEnding = (lineEnding: "crlf" | "lf") => {
    if (document.mode === "large-readonly" || document.mode === "diff") return;

    const normalized = document.content.replace(/\r\n|\r|\n/g, lineEnding === "crlf" ? "\r\n" : "\n");
    updateDocumentContent(normalized);
  };

  const requestFileOpenRef = useRef(requestFileOpen);
  const requestCloseDocumentRef = useRef(requestCloseDocument);

  useEffect(() => {
    requestFileOpenRef.current = requestFileOpen;
  }, [requestFileOpen]);

  useEffect(() => {
    requestCloseDocumentRef.current = requestCloseDocument;
  }, [requestCloseDocument]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    const appWindow = getCurrentWindow();

    appWindow
      .onCloseRequested((event) => {
        const state = useWorkbenchStore.getState();
        const closeDiagnostics = state.openDocuments.map((openDocument) => ({
          id: openDocument.id,
          name: openDocument.name,
          isUntitled: Boolean(openDocument.isUntitled),
          contentLength: (openDocument.content ?? "").length,
          savedContentLength: (openDocument.savedContent ?? "").length,
          dirty: isDocumentDirty(openDocument),
          needsConfirmation: requiresDocumentCloseConfirmation(openDocument),
        }));
        const targetDocument = state.openDocuments.find(requiresDocumentCloseConfirmation);

        const diagnosticPayload = {
          documents: closeDiagnostics,
          pendingCloseDocumentId: state.pendingCloseDocument?.id ?? null,
          targetDocumentId: targetDocument?.id ?? null,
        };

        console.info("[norn] window close requested", diagnosticPayload);
        void invoke("debug_log", { message: "window close requested", payload: diagnosticPayload }).catch(() => undefined);

        event.preventDefault();

        if (!targetDocument) {
          void invoke("debug_log", { message: "destroy current window requested", payload: {} }).catch(() => undefined);
          void invoke("destroy_current_window").catch((error) =>
            invoke("debug_log", { message: "destroy current window failed", payload: { error: String(error) } }).catch(
              () => undefined,
            ),
          );
          return;
        }

        requestCloseDocumentRef.current(targetDocument);
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
  }, []);

  // 顶部搜索结果点击 → 打开文件。注册到 store,避免穿过 titlebar 透传回调。
  const setOpenFileFromSearch = useWorkbenchStore((state) => state.setOpenFileFromSearch);
  useEffect(() => {
    setOpenFileFromSearch((path) => requestFileOpenRef.current({ kind: "path", path }));
    return () => setOpenFileFromSearch(null);
  }, [setOpenFileFromSearch]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    invoke<string[]>("take_initial_open_files")
      .then((paths) => {
        paths.forEach((path) => {
          requestFileOpenRef.current({ kind: "path", path, clearFolderView: true });
        });
      })
      .catch(() => undefined);

    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<string[]>(nativeOpenFilesEvent, (event) => {
      event.payload.forEach((path) => {
        requestFileOpenRef.current({ kind: "path", path, clearFolderView: true });
      });
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
  }, []);

  const {
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
  } = useWorkspaceTree({ requestFileOpen });

  // 启动恢复上次工作区:若开启且当前无打开的文件夹,打开最近文件夹。只跑一次。
  const restoredWorkspaceRef = useRef(false);
  useEffect(() => {
    if (restoredWorkspaceRef.current) return;
    restoredWorkspaceRef.current = true;
    void loadSettings().then((stored) => {
      if (!stored?.ui.restoreLastWorkspace) return;
      const state = useWorkbenchStore.getState();
      if (state.folderView) return;
      const recent = state.recentFolders[0];
      if (recent) void openFolderView(recent.path, "open-folder");
    });
  }, [openFolderView]);

  // action 系统的回调来源:全部复用上面的 hook 输出,不重写业务逻辑。
  const actionDeps: ActionDeps = {
    createFile,
    activateDocument: (documentId) => {
      const targetDocument = useWorkbenchStore.getState().openDocuments.find((item) => item.id === documentId);
      if (targetDocument) {
        activateDocument(targetDocument);
      }
    },
    openFilePicker,
    openFolderPicker,
    saveDocument: () => saveDocument(),
    saveDocumentAs: () => saveDocumentAs(),
    toggleFilesTool,
    openSearchTool,
    openSettingsTool,
  };

  const settingsPageNode = <SettingsPage onBack={() => setSettingsOpen(false)} showMacTitlebar={showMacTitlebar} />;

  return (
    <ActionsProvider deps={actionDeps}>
      <TooltipProvider delayDuration={250}>
        <WorkbenchActionsRuntime />
        <div
          className={cn(
            "h-full bg-transparent text-ui text-foreground",
            showMacTitlebar && "mac-titlebar-overlay-layout",
          )}
        >
          {settingsOpen ? (
            showWindowsTitlebar ? (
              // Windows 无边框窗口:设置页也要有自绘标题栏(窗口控制 + 汉堡菜单),否则无法关闭窗口 / 访问菜单。
              <div className="flex h-full min-w-0 flex-col">
                <WindowsTitleBar
                  gitBadgeCount={gitBadgeCount}
                  variant="settings"
                  leftPanelOpen={leftPanelOpen}
                  onToggleLeftPanel={toggleFilesTool}
                  onOpenSearch={openSearchTool}
                  onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
                  rightPanelOpen={rightPanelOpen}
                  searchOpen={searchOpen}
                  onCloseSearch={closeSearchTool}
                />
                <div className="min-h-0 flex-1">{settingsPageNode}</div>
              </div>
            ) : (
              settingsPageNode
            )
          ) : (
            <div className="workspace-view flex h-full min-w-0 flex-col">
              {showWindowsTitlebar ? (
                <WindowsTitleBar
                  gitBadgeCount={gitBadgeCount}
                  leftPanelOpen={leftPanelOpen}
                  onToggleLeftPanel={toggleFilesTool}
                  onOpenSearch={openSearchTool}
                  onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
                  rightPanelOpen={rightPanelOpen}
                  searchOpen={searchOpen}
                  onCloseSearch={closeSearchTool}
                />
              ) : null}
              {showMacTitlebar ? (
                <MacTitlebar
                  gitBadgeCount={gitBadgeCount}
                  leftPanelOpen={leftPanelOpen}
                  leftPanelWidth={leftPanelWidth}
                  onCloseSearch={closeSearchTool}
                  onOpenSearch={openSearchTool}
                  onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
                  rightPanelOpen={rightPanelOpen}
                  rightPanelWidth={rightPanelWidth}
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
                      rightPanelOpen ? (showWindowsTitlebar ? "7px" : "0px") : "0px"
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
                  data-focus-zone="fileTree"
                  tabIndex={-1}
                >
                  <ProjectPanel
                    activePath={document.path}
                    selection={treeSelection}
                    search={treeSearch}
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
                    onOpenRecentFolder={(path) => void openFolderView(path, "open-folder")}
                    onOpenSettings={openSettingsTool}
                    onOpenTreeFile={openTreeFile}
                    onSelectTreeNode={selectTreeNode}
                    onTreeKeyDown={handleTreeKeyDown}
                    onTreeBlur={clearTreeSearch}
                    onCopyPath={copyTreeNodePaths}
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
                    onRevealNode={revealTreeNodeInFileManager}
                    onOpenTerminal={openTerminalAtNode}
                    recentFolders={recentFolders}
                    scratchFolder={scratchFolder}
                    scratchFolderView={scratchFolderView}
                    onToggleScratchDirectory={(node) => void toggleScratchDirectory(node)}
                    onToggleScratchRootDirectory={toggleScratchRootDirectory}
                    onToggleDirectory={toggleDirectory}
                    onToggleRootDirectory={toggleRootDirectory}
                    onExpandAll={expandAllDirectories}
                    onCollapseAll={collapseAllDirectories}
                    onRevealActiveFile={() => void revealActiveFile()}
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
                  openDocuments={openDocuments}
                  onChange={updateDocumentContent}
                  onCloseDocument={requestCloseDocument}
                  onCreateFile={createFile}
                  onCursorChange={setCursorPosition}
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
                  data-focus-zone="git"
                  tabIndex={-1}
                >
                  <GitPanel
                    folderView={folderView}
                    gitWorkspace={gitWorkspace}
                    onOpenDiff={(file) =>
                      void gitActions.loadFileVersions(file).then((versions) => openDiff(file, versions))
                    }
                    onOpenCommitDiff={(hash, file) =>
                      void gitActions
                        .loadCommitFileVersions(hash, file)
                        .then((versions) => openCommitDiff(hash, file, versions))
                    }
                    onOpenFile={(path, size) => requestFileOpen({ kind: "path", path, size })}
                  />
                </div>
              </main>
              {showStatusBar ? (
                <StatusBar
                  document={document}
                  cursorPosition={cursorPosition}
                  goToLineRequestId={goToLineRequestId}
                  isDirty={isDirty}
                  onCancelGoToLine={cancelGoToLine}
                  onChangeEncoding={(option) => void changeDocumentEncoding(option)}
                  onChangeLineEnding={changeDocumentLineEnding}
                  onGoToLine={goToLine}
                  onOpenDiff={(file) =>
                    void gitActions.loadFileVersions(file).then((versions) => openDiff(file, versions))
                  }
                  gitWorkspace={gitWorkspace}
                />
              ) : null}
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
                diskContent={saveConflict?.diskContent}
                diskMissing={saveConflict?.diskMissing}
                editorContent={saveConflict?.content ?? document.content}
                message={saveConflict?.message}
                onCancel={() => setSaveConflict(null)}
                onOverwrite={() => {
                  if (saveConflict?.diskMissing) {
                    const content = saveConflict.content;
                    setSaveConflict(null);
                    void saveDocumentAs(content);
                    return;
                  }

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
    </ActionsProvider>
  );
}

const NATIVE_MENU_TO_ACTION: Record<string, string> = {
  [nativeMenuCommands.newFile]: "file.new",
  [nativeMenuCommands.openFile]: "file.open",
  [nativeMenuCommands.openFolder]: "file.openFolder",
  [nativeMenuCommands.saveFile]: "file.save",
  [nativeMenuCommands.saveFileAs]: "file.saveAs",
  [nativeMenuCommands.showExplorer]: "view.toggleExplorer",
  [nativeMenuCommands.find]: "navigate.goToFile",
  [nativeMenuCommands.toggleGitPanel]: "view.toggleGit",
};

/**
 * action 运行时:挂全局快捷键、把原生菜单事件转成 action 分发、渲染命令面板。
 * 必须在 ActionsProvider 内,才能拿到 dispatch。
 */
function WorkbenchActionsRuntime() {
  useKeybindings();
  useSettingsRuntime();
  const { dispatch } = useActions();
  const setKeymapOverrides = useWorkbenchStore((state) => state.setKeymapOverrides);
  const language = useWorkbenchStore((state) => state.language);

  // 首次启动:没看过引导就自动开启漫游(只跑一次)。延迟一拍等标题栏挂载,高亮才能锚到目标。
  useEffect(() => {
    if (hasSeenWelcome()) return;
    const timer = window.setTimeout(() => startWelcomeTour(language), 500);
    return () => window.clearTimeout(timer);
    // 仅首启跑一次,不随 language 重启;开 tour 时读当时的语言即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 启动时从 keybindings.json(Tauri)/ localStorage(Web)载入自定义快捷键。
  useEffect(() => {
    let cancelled = false;
    void loadKeymapOverrides().then((overrides) => {
      if (!cancelled) setKeymapOverrides(overrides);
    });
    return () => {
      cancelled = true;
    };
  }, [setKeymapOverrides]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<string>(nativeMenuEvent, (event) => {
      const actionId = NATIVE_MENU_TO_ACTION[event.payload];
      if (actionId) dispatch(actionId);
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
  }, [dispatch]);

  return <CommandPalette />;
}
