import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type CSSProperties, useEffect, useMemo } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  rightPanelMaxWidth,
  rightPanelMinWidth,
} from "./constants";
import { useDocumentSession } from "./hooks/use-document-session";
import { usePanelLayout } from "./hooks/use-panel-layout";
import { useWorkspaceTree } from "./hooks/use-workspace-tree";
import { isMac, isWindows } from "./platform";
import { useWorkbenchStore } from "./store/workbench-store";
import { isDocumentDirty, isTauriRuntime, loadKeymapOverrides } from "./workbench-utils";

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
  const saveState = useWorkbenchStore((state) => state.saveState);
  const searchOpen = useWorkbenchStore((state) => state.searchOpen);
  const showWindowsTitlebar = useMemo(() => isWindows(), []);
  const showMacTitlebar = useMemo(() => isMac(), []);
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

  const {
    activateDocument,
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
  } = useDocumentSession();

  const {
    dropTargetRef,
    openFolderView,
    openFolderPicker,
    toggleDirectory,
    toggleRootDirectory,
    collapseAllDirectories,
    expandAllDirectories,
    revealActiveFile,
    selectedTreePath,
    selectTreeNode,
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

  // action 系统的回调来源:全部复用上面的 hook 输出,不重写业务逻辑。
  const actionDeps: ActionDeps = {
    createFile,
    openFilePicker,
    openFolderPicker,
    saveDocument: () => saveDocument(),
    saveDocumentAs: () => saveDocumentAs(),
    toggleFilesTool,
    openSearchTool,
    openSettingsTool,
  };

  const settingsPageNode = (
    <SettingsPage
      gitWorkspace={gitWorkspace}
      onBack={() => setSettingsOpen(false)}
      onToggleResizeHandleHints={() => updateResizeHandleHintsVisible(!resizeHandleHintsVisible)}
      resizeHandleHintsVisible={resizeHandleHintsVisible}
      showMacTitlebar={showMacTitlebar}
    />
  );

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
                  selectedPath={selectedTreePath}
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
                  onSelectTreeNode={selectTreeNode}
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
                data-focus-zone="git"
                tabIndex={-1}
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
  const { dispatch } = useActions();
  const setKeymapOverrides = useWorkbenchStore((state) => state.setKeymapOverrides);

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
