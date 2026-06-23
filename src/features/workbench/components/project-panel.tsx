import { ChevronDown, FolderOpen, Settings } from "lucide-react";
import { type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type {
  FileTreeClipboard,
  FileTreeContextMenuState,
  FileTreeNode,
  FolderView,
  RecentFolder,
  ScratchFolder,
  ScratchFolderView,
  TreeDropTarget,
  TreePanelView,
} from "../types";
import {
  getCompactPath,
  getPathName,
  getProjectAccentStyle,
  getProjectInitials,
  getTailPath,
} from "../workbench-utils";
import { FileTreePanel } from "./file-tree";

export function ProjectPanel({
  activePath,
  selectedPath,
  clipboard,
  contextMenu,
  draggedNode,
  dropTarget,
  folderView,
  leftPanelWidth,
  onContextMenu,
  onCopyNode,
  onCutNode,
  onDragEnd,
  onDragNode,
  onDropNode,
  onDropTargetChange,
  onOpenFolder,
  onOpenRecentFolder,
  onOpenSettings,
  onOpenTreeFile,
  onSelectTreeNode,
  onPasteNode,
  onRefreshFolder,
  onRequestCreateDirectory,
  onRequestCreateFile,
  onRequestRenameNode,
  onRequestTrashNode,
  recentFolders,
  scratchFolder,
  scratchFolderView,
  onToggleScratchDirectory,
  onToggleScratchRootDirectory,
  onToggleDirectory,
  onToggleRootDirectory,
  onExpandAll,
  onCollapseAll,
  onRevealActiveFile,
}: {
  activePath: string;
  selectedPath: string | null;
  clipboard: FileTreeClipboard | null;
  contextMenu: FileTreeContextMenuState | null;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  folderView: FolderView | null;
  leftPanelWidth: number;
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onCopyNode: (node: FileTreeNode) => void;
  onCutNode: (node: FileTreeNode) => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFolder: () => void;
  onOpenRecentFolder: (path: string) => void;
  onOpenSettings: () => void;
  onOpenTreeFile: (node: FileTreeNode) => void;
  onSelectTreeNode: (node: FileTreeNode) => void;
  onPasteNode: (targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onRefreshFolder: (path: string, scope?: "main" | "scratch") => void;
  onRequestCreateDirectory: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestCreateFile: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestRenameNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onRequestTrashNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  recentFolders: RecentFolder[];
  scratchFolder: ScratchFolder | null;
  scratchFolderView: ScratchFolderView;
  onToggleScratchDirectory: (node: FileTreeNode) => void;
  onToggleScratchRootDirectory: () => void;
  onToggleDirectory: (node: FileTreeNode) => void;
  onToggleRootDirectory: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRevealActiveFile: () => void;
}) {
  const scratchPanelMinRatio = 0.1;
  const scratchPanelMaxRatio = 0.6;
  const [scratchPanelRatio, setScratchPanelRatio] = useState(0.3);
  const panelStackRef = useRef<HTMLDivElement>(null);

  const startScratchPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stack = panelStackRef.current;

    if (!stack) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const stackRect = stack.getBoundingClientRect();
    const startY = event.clientY;
    const startRatio = scratchPanelRatio;

    const updateRatio = (clientY: number) => {
      const nextScratchHeight = stackRect.height * startRatio - (clientY - startY);
      const nextRatio = Math.min(
        scratchPanelMaxRatio,
        Math.max(scratchPanelMinRatio, nextScratchHeight / stackRect.height),
      );
      setScratchPanelRatio(nextRatio);
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      updateRatio(pointerEvent.clientY);
    };

    const stopResize = () => {
      document.body.classList.remove("project-panel-splitter-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    document.body.classList.add("project-panel-splitter-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  return (
    <aside className="project-panel">
      <div className="project-panel-resizable-stack" ref={panelStackRef}>
        <div className="project-panel-main-region" style={{ flexBasis: `${(1 - scratchPanelRatio) * 100}%` }}>
          <ProjectPanelStart
            folderView={folderView}
            leftPanelWidth={leftPanelWidth}
            onOpenFolder={onOpenFolder}
            onOpenRecentFolder={onOpenRecentFolder}
            recentFolders={recentFolders}
          />
          <FileTreePanel
            activePath={activePath}
            selectedPath={selectedPath}
            clipboard={clipboard}
            contextMenu={contextMenu}
            draggedNode={draggedNode}
            dropTarget={dropTarget}
            treeView={
              folderView
                ? {
                    error: folderView.error,
                    loadingPath: folderView.loadingPath,
                    nodes: folderView.nodes,
                    rootExpanded: folderView.rootExpanded,
                    rootName: folderView.rootName,
                    rootPath: folderView.rootPath,
                  }
                : null
            }
            scope="main"
            onContextMenu={onContextMenu}
            onCopyNode={onCopyNode}
            onCutNode={onCutNode}
            onDragEnd={onDragEnd}
            onDragNode={onDragNode}
            onDropNode={onDropNode}
            onDropTargetChange={onDropTargetChange}
            onOpenFile={onOpenTreeFile}
            onSelectNode={onSelectTreeNode}
            onPasteNode={onPasteNode}
            onRefreshFolder={onRefreshFolder}
            onRequestCreateDirectory={onRequestCreateDirectory}
            onRequestCreateFile={onRequestCreateFile}
            onRequestRenameNode={onRequestRenameNode}
            onRequestTrashNode={onRequestTrashNode}
            onToggleDirectory={onToggleDirectory}
            onToggleRootDirectory={onToggleRootDirectory}
            onExpandAll={onExpandAll}
            onCollapseAll={onCollapseAll}
            onRevealActiveFile={onRevealActiveFile}
          />
        </div>
        <div
          aria-label="Resize temporary folder area"
          aria-orientation="horizontal"
          aria-valuemax={scratchPanelMaxRatio * 100}
          aria-valuemin={scratchPanelMinRatio * 100}
          aria-valuenow={Math.round(scratchPanelRatio * 100)}
          className="project-panel-splitter"
          role="separator"
          tabIndex={0}
          onPointerDown={startScratchPanelResize}
        >
          <span className="project-panel-splitter-line" />
        </div>
        <ProjectPanelScratchFolder
          activePath={activePath}
          selectedPath={selectedPath}
          clipboard={clipboard}
          contextMenu={contextMenu}
          draggedNode={draggedNode}
          dropTarget={dropTarget}
          scratchFolder={scratchFolder}
          scratchFolderView={scratchFolderView}
          style={{ flexBasis: `${scratchPanelRatio * 100}%` }}
          onContextMenu={onContextMenu}
          onCopyNode={onCopyNode}
          onCutNode={onCutNode}
          onDragEnd={onDragEnd}
          onDragNode={onDragNode}
          onDropNode={onDropNode}
          onDropTargetChange={onDropTargetChange}
          onOpenFile={onOpenTreeFile}
          onSelectNode={onSelectTreeNode}
          onPasteNode={onPasteNode}
          onRefreshFolder={onRefreshFolder}
          onRequestCreateDirectory={onRequestCreateDirectory}
          onRequestCreateFile={onRequestCreateFile}
          onRequestRenameNode={onRequestRenameNode}
          onRequestTrashNode={onRequestTrashNode}
          onToggleDirectory={onToggleScratchDirectory}
          onToggleRootDirectory={onToggleScratchRootDirectory}
        />
      </div>
      <ProjectPanelFooter onOpenSettings={onOpenSettings} />
    </aside>
  );
}

export function ProjectPanelStart({
  folderView,
  leftPanelWidth,
  onOpenFolder,
  onOpenRecentFolder,
  recentFolders,
}: {
  folderView: FolderView | null;
  leftPanelWidth: number;
  onOpenFolder: () => void;
  onOpenRecentFolder: (path: string) => void;
  recentFolders: RecentFolder[];
}) {
  const activeFolderPath = folderView?.rootPath ?? null;
  const activeRecentFolder = recentFolders.find((folder) => folder.path === activeFolderPath);
  const activeFolderName =
    activeRecentFolder?.name ?? (folderView ? getPathName(folderView.rootPath) : "Recent folders");
  const activePathMaxLength = Math.max(18, Math.floor((leftPanelWidth - 96) / 6.2));
  const activeFolderPathLabel = folderView ? getTailPath(folderView.rootPath, activePathMaxLength) : "";
  const activeFolderAccentStyle = getProjectAccentStyle(activeFolderName);
  const currentFolder = folderView ? { name: activeFolderName, path: folderView.rootPath } : null;
  const inactiveRecentFolders = recentFolders.filter((folder) => folder.path !== activeFolderPath);

  const renderRecentFolderItem = (project: RecentFolder, selected: boolean) => (
    <DropdownMenuItem
      aria-selected={selected}
      className={cn("project-panel-recent-menu-item", selected && "project-panel-recent-menu-item-selected")}
      key={project.path}
      onSelect={() => onOpenRecentFolder(project.path)}
    >
      <span className="project-panel-recent-menu-avatar" style={getProjectAccentStyle(project.name)}>
        {getProjectInitials(project.name)}
      </span>
      <span className="project-panel-recent-text">
        <span className="project-panel-recent-name">{project.name}</span>
        <span className="project-panel-recent-path" title={project.path}>
          {getCompactPath(project.path, 5)}
        </span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <div className="project-panel-start">
      <button className="project-panel-action-button" type="button" onClick={onOpenFolder}>
        <FolderOpen className="h-[18px] w-[18px] shrink-0" />
        Open New Folder
      </button>
      <div className="project-panel-divider" aria-hidden="true" />
      {folderView ? (
        <div className="project-panel-recent-switcher">
          <div className="project-panel-recent-heading">Recent folders</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="project-panel-recent-select" type="button">
                <span className="project-panel-recent-select-avatar" style={activeFolderAccentStyle}>
                  {getProjectInitials(activeFolderName)}
                </span>
                <span className="project-panel-recent-select-text">
                  <span className="project-panel-recent-select-name">{activeFolderName}</span>
                  {activeFolderPathLabel ? (
                    <span className="project-panel-recent-select-path" title={folderView?.rootPath}>
                      {activeFolderPathLabel}
                    </span>
                  ) : null}
                </span>
                <span className="project-panel-recent-select-chevron">
                  <ChevronDown className="h-3.5 w-3.5" />
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="project-panel-recent-menu" sideOffset={6}>
              {currentFolder ? renderRecentFolderItem(currentFolder, true) : null}
              {currentFolder && inactiveRecentFolders.length > 0 ? (
                <DropdownMenuSeparator className="project-panel-recent-menu-separator" />
              ) : null}
              {inactiveRecentFolders.length > 0 ? (
                inactiveRecentFolders
                  .slice(0, currentFolder ? 7 : 8)
                  .map((project) => renderRecentFolderItem(project, false))
              ) : currentFolder ? null : (
                <DropdownMenuItem className="project-panel-recent-menu-item" disabled>
                  No recent folders yet
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <div className="project-panel-recent">
          <div className="project-panel-recent-label">Recent folders</div>
          {recentFolders.length > 0 ? (
            recentFolders.slice(0, 5).map((project) => (
              <button
                className="project-panel-recent-item"
                key={project.path}
                type="button"
                onClick={() => onOpenRecentFolder(project.path)}
              >
                <span className="project-panel-recent-text">
                  <span className="project-panel-recent-name">{project.name}</span>
                  <span className="project-panel-recent-path">{project.path}</span>
                </span>
              </button>
            ))
          ) : (
            <div className="project-panel-recent-empty">No recent folders yet</div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectPanelScratchFolder({
  activePath,
  selectedPath,
  clipboard,
  contextMenu,
  draggedNode,
  dropTarget,
  scratchFolder,
  scratchFolderView,
  style,
  onContextMenu,
  onCopyNode,
  onCutNode,
  onDragEnd,
  onDragNode,
  onDropNode,
  onDropTargetChange,
  onOpenFile,
  onSelectNode,
  onPasteNode,
  onRefreshFolder,
  onRequestCreateDirectory,
  onRequestCreateFile,
  onRequestRenameNode,
  onRequestTrashNode,
  onToggleDirectory,
  onToggleRootDirectory,
}: {
  activePath: string;
  selectedPath: string | null;
  clipboard: FileTreeClipboard | null;
  contextMenu: FileTreeContextMenuState | null;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  scratchFolder: ScratchFolder | null;
  scratchFolderView: ScratchFolderView;
  style?: CSSProperties;
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onCopyNode: (node: FileTreeNode) => void;
  onCutNode: (node: FileTreeNode) => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onSelectNode: (node: FileTreeNode) => void;
  onPasteNode: (targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onRefreshFolder: (path: string, scope?: "main" | "scratch") => void;
  onRequestCreateDirectory: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestCreateFile: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestRenameNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onRequestTrashNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onToggleDirectory: (node: FileTreeNode) => void;
  onToggleRootDirectory: () => void;
}) {
  const scratchTreeView: TreePanelView | null = scratchFolder
    ? {
        error: scratchFolderView.error,
        loadingPath: scratchFolderView.loadingPath,
        nodes: scratchFolderView.nodes,
        rootExpanded: scratchFolderView.expanded,
        rootName: "临时文件夹",
        rootPath: scratchFolder.path,
      }
    : null;

  return (
    <div className="project-panel-scratch" style={style}>
      <div className="project-panel-scratch-heading">临时文件夹</div>
      <FileTreePanel
        activePath={activePath}
        selectedPath={selectedPath}
        clipboard={clipboard}
        contextMenu={contextMenu}
        draggedNode={draggedNode}
        dropTarget={dropTarget}
        scope="scratch"
        treeView={scratchTreeView}
        onContextMenu={onContextMenu}
        onCopyNode={onCopyNode}
        onCutNode={onCutNode}
        onDragEnd={onDragEnd}
        onDragNode={onDragNode}
        onDropNode={onDropNode}
        onDropTargetChange={onDropTargetChange}
        onOpenFile={onOpenFile}
        onSelectNode={onSelectNode}
        onPasteNode={onPasteNode}
        onRefreshFolder={onRefreshFolder}
        onRequestCreateDirectory={onRequestCreateDirectory}
        onRequestCreateFile={onRequestCreateFile}
        onRequestRenameNode={onRequestRenameNode}
        onRequestTrashNode={onRequestTrashNode}
        onToggleDirectory={onToggleDirectory}
        onToggleRootDirectory={onToggleRootDirectory}
      />
    </div>
  );
}

export function ProjectPanelFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="project-panel-footer">
      <button className="project-panel-action-button" type="button" onClick={onOpenSettings}>
        <Settings className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">Settings</span>
      </button>
    </div>
  );
}
