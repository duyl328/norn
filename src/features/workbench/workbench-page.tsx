import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { type CSSProperties, useEffect, useMemo } from "react";

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
import { gitChangeSections } from "./mock-data";
import { isMac, isWindows } from "./platform";
import { useWorkbenchStore } from "./store/workbench-store";
import { isDocumentDirty, isTauriRuntime } from "./workbench-utils";

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
  const gitBadgeCount = gitChangeSections.reduce((total, section) => total + section.count, 0);

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
    treeSelection,
    selectTreeNode,
    handleTreeKeyDown,
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
    confirmTrashTreeNode,
    moveTreeNodeToDirectory,
    openFileTreeContextMenu,
  } = useWorkspaceTree({ requestFileOpen });

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
    <TooltipProvider delayDuration={250}>
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
                onCreateFile={() => {
                  setSettingsOpen(false);
                  createFile();
                }}
                onToggleLeftPanel={toggleFilesTool}
                onOpenFile={() => {
                  setSettingsOpen(false);
                  openFilePicker();
                }}
                onOpenFolder={() => {
                  setSettingsOpen(false);
                  openFolderPicker();
                }}
                onSaveFile={() => void saveDocument()}
                onSaveFileAs={() => void saveDocumentAs()}
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
              >
                <ProjectPanel
                  activePath={document.path}
                  selection={treeSelection}
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
                  onTreeKeyDown={handleTreeKeyDown}
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
