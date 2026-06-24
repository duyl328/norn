import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  Copy,
  FilePlus,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Link2,
  LocateFixed,
  Pencil,
  RefreshCw,
  Scissors,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type {
  FileTreeClipboard,
  FileTreeContextMenuState,
  FileTreeNameDialog,
  FileTreeNode,
  TreeDropTarget,
  TreePanelView,
} from "../types";
import { flattenVisibleTreeRows, formatFileSize, getFileTreeIcon, isPathInsideOrEqual } from "../workbench-utils";

export function FileTreePanel({
  activePath,
  selectedPath,
  clipboard,
  contextMenu,
  draggedNode,
  dropTarget,
  scope,
  treeView,
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
  onRevealNode,
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
  scope: "main" | "scratch";
  treeView: TreePanelView | null;
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
  onRevealNode: (node: FileTreeNode) => void;
  onToggleDirectory: (node: FileTreeNode) => void;
  onToggleRootDirectory: () => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  onRevealActiveFile?: () => void;
}) {
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => (treeView && treeView.rootExpanded ? flattenVisibleTreeRows(treeView.nodes, 1) : []),
    [treeView?.nodes, treeView?.rootExpanded],
  );
  const treeVirtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => 28,
    getScrollElement: () => scrollParentRef.current,
    overscan: 12,
  });

  // 「定位当前文件」:点击后置位 pending,待祖先目录异步加载/展开使目标行出现在 rows 中,
  // 再把它滚动到可见区中部。pending 用 ref 记录,滚动一次后清除,避免之后任何树变化都把视图拉回。
  const pendingRevealRef = useRef(false);
  const [revealNonce, setRevealNonce] = useState(0);
  const canRevealActiveFile = Boolean(activePath && treeView && isPathInsideOrEqual(activePath, treeView.rootPath));

  const handleRevealActiveFile = () => {
    onRevealActiveFile?.();
    pendingRevealRef.current = true;
    setRevealNonce((nonce) => nonce + 1);
  };

  useEffect(() => {
    if (!pendingRevealRef.current) {
      return;
    }

    // 定位按钮已把选中行切到编辑区当前文件;滚动到该选中行。
    const targetIndex = rows.findIndex((row) => row.node.path === selectedPath);

    if (targetIndex < 0) {
      // 祖先目录仍在加载,目标行尚未出现;rows 更新后本 effect 会重跑。
      return;
    }

    pendingRevealRef.current = false;
    treeVirtualizer.scrollToIndex(targetIndex, { align: "center" });
  }, [revealNonce, rows, selectedPath, treeVirtualizer]);

  if (!treeView) {
    return <div className="min-h-0 flex-1" />;
  }

  const hasRootDirectories = treeView.nodes.some((node) => node.kind === "directory");
  const targetDirectory = contextMenu?.node?.kind === "directory" ? contextMenu.node.path : treeView.rootPath;
  const scopedContextMenu = contextMenu?.scope === scope ? contextMenu : null;

  return (
    <>
      {treeView.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-ui text-destructive">
          {treeView.error}
        </div>
      ) : null}
      <FileTreeRootRow
        dropTarget={dropTarget}
        scope={scope}
        treeView={treeView}
        onContextMenu={onContextMenu}
        onDropTargetChange={onDropTargetChange}
        onToggle={onToggleRootDirectory}
        onExpandAll={onExpandAll}
        onCollapseAll={onCollapseAll}
        onRevealActiveFile={onRevealActiveFile ? handleRevealActiveFile : undefined}
        canRevealActiveFile={canRevealActiveFile}
      />
      <div
        className="file-tree-scroll min-h-0 flex-1"
        ref={scrollParentRef}
        onContextMenu={(event) => onContextMenu(null, event, scope)}
      >
        <div
          className={cn("file-tree-list", !hasRootDirectories && "file-tree-list-flat")}
          role="tree"
          aria-label={treeView.rootName}
          data-tree-drop-path={treeView.rootPath}
          data-tree-drop-scope={scope}
        >
          {treeView.loadingPath === treeView.rootPath && treeView.nodes.length === 0 ? (
            <div className="px-2 py-2 text-ui text-muted-foreground">Loading folder...</div>
          ) : null}
          <div className="file-tree-virtual-inner" style={{ height: `${treeVirtualizer.getTotalSize()}px` }}>
            {treeVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];

              return (
                <div
                  className="file-tree-virtual-row"
                  key={row.node.path}
                  // 用 top 而非 transform 定位:transform 会把行提升为 GPU 合成层,
                  // 在 Windows/WebView2 上该层会关闭 ClearType 子像素抗锯齿 → 文字发虚/重影。
                  style={{ top: `${virtualRow.start}px` }}
                >
                  <FileTreeRow
                    selectedPath={selectedPath}
                    ancestorCanonicalPaths={row.ancestorCanonicalPaths}
                    depth={row.depth}
                    draggedNode={draggedNode}
                    dropTarget={dropTarget}
                    loadingPath={treeView.loadingPath}
                    node={row.node}
                    scope={scope}
                    onContextMenu={onContextMenu}
                    onDragEnd={onDragEnd}
                    onDragNode={onDragNode}
                    onDropNode={onDropNode}
                    onDropTargetChange={onDropTargetChange}
                    onOpenFile={onOpenFile}
                    onSelectNode={onSelectNode}
                    onToggleDirectory={onToggleDirectory}
                  />
                </div>
              );
            })}
          </div>
          {treeView.rootExpanded &&
          treeView.nodes.length === 0 &&
          treeView.loadingPath !== treeView.rootPath &&
          !treeView.error ? (
            <div className="px-2 py-2 text-ui text-muted-foreground">No files in this folder.</div>
          ) : null}
        </div>
      </div>
      {scopedContextMenu ? (
        <FileTreeContextMenu
          clipboard={clipboard}
          node={scopedContextMenu.node}
          onCopyNode={onCopyNode}
          onCutNode={onCutNode}
          onPasteNode={() => onPasteNode(targetDirectory, scope)}
          onRefresh={() =>
            onRefreshFolder(
              scopedContextMenu.node?.kind === "directory" ? scopedContextMenu.node.path : treeView.rootPath,
              scope,
            )
          }
          onRequestCreateDirectory={() => onRequestCreateDirectory(targetDirectory, scope)}
          onRequestCreateFile={() => onRequestCreateFile(targetDirectory, scope)}
          onRequestRenameNode={(node) => onRequestRenameNode(node, scope)}
          onRequestTrashNode={(node) => onRequestTrashNode(node, scope)}
          onRevealNode={onRevealNode}
          x={scopedContextMenu.x}
          y={scopedContextMenu.y}
        />
      ) : null}
    </>
  );
}

export function FileTreeRootRow({
  dropTarget,
  scope,
  treeView,
  onContextMenu,
  onDropTargetChange,
  onToggle,
  onExpandAll,
  onCollapseAll,
  onRevealActiveFile,
  canRevealActiveFile,
}: {
  dropTarget: TreeDropTarget | null;
  scope: "main" | "scratch";
  treeView: TreePanelView;
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onToggle: () => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  onRevealActiveFile?: () => void;
  canRevealActiveFile?: boolean;
}) {
  const isDropTarget = dropTarget?.scope === scope && dropTarget.path === treeView.rootPath;
  const hasActions = Boolean(onExpandAll || onCollapseAll || onRevealActiveFile);

  return (
    <div className="file-tree-root">
      <button
        aria-expanded={treeView.rootExpanded}
        className={cn("tree-row tree-row-root w-full text-left", isDropTarget && "tree-row-drop-target")}
        data-tree-drop-path={treeView.rootPath}
        data-tree-drop-scope={scope}
        role="treeitem"
        type="button"
        title={treeView.rootPath}
        onClick={onToggle}
        onContextMenu={(event) => onContextMenu(null, event, scope)}
        onDragLeave={() => (isDropTarget ? onDropTargetChange(null) : undefined)}
        onDragOver={(event) => {
          event.preventDefault();
          onDropTargetChange({ path: treeView.rootPath, scope });
        }}
      >
        <span className="tree-row-toggle">
          {treeView.rootExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
        <span className="tree-row-main">
          <FolderOpen className="tree-row-icon tree-row-icon-directory" />
          <span className="tree-row-name">{treeView.rootName}</span>
        </span>
        <span className="tree-row-size">{treeView.loadingPath === treeView.rootPath ? "..." : ""}</span>
      </button>
      {hasActions ? (
        <div className="file-tree-root-actions">
          {onRevealActiveFile ? (
            <button
              className="file-tree-root-action"
              type="button"
              title="定位当前文件"
              aria-label="Reveal active file in tree"
              disabled={!canRevealActiveFile}
              onClick={onRevealActiveFile}
            >
              <LocateFixed className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {onExpandAll ? (
            <button
              className="file-tree-root-action"
              type="button"
              title="全部展开"
              aria-label="Expand all folders"
              onClick={onExpandAll}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {onCollapseAll ? (
            <button
              className="file-tree-root-action"
              type="button"
              title="全部折叠"
              aria-label="Collapse all folders"
              onClick={onCollapseAll}
            >
              <ChevronsDownUp className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FileTreeRow({
  selectedPath,
  ancestorCanonicalPaths,
  depth = 0,
  draggedNode,
  dropTarget,
  loadingPath,
  node,
  scope,
  onContextMenu,
  onDragEnd,
  onDragNode,
  onDropNode,
  onDropTargetChange,
  onOpenFile,
  onSelectNode,
  onToggleDirectory,
}: {
  selectedPath: string | null;
  ancestorCanonicalPaths: string[];
  depth?: number;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  loadingPath: string | null;
  node: FileTreeNode;
  scope: "main" | "scratch";
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onSelectNode: (node: FileTreeNode) => void;
  onToggleDirectory: (node: FileTreeNode) => void;
}) {
  const isDirectory = node.kind === "directory";
  const isSelected = node.path === selectedPath;
  const isLoading = loadingPath === node.path;
  const isDropTarget = isDirectory && dropTarget?.scope === scope && dropTarget.path === node.path;
  const canonicalPath = node.canonicalPath ?? node.path;
  const wouldCycle = isDirectory && node.isSymlink && ancestorCanonicalPaths.includes(canonicalPath);
  const { className: iconClassName, Icon } = getFileTreeIcon(node);

  // 单击:仅选中(高亮),不打开文件、不展开目录。
  const handleSelect = () => {
    onSelectNode(node);
  };

  // 双击 / 回车「确认」:文件 → 打开到编辑区;目录 → 展开/折叠。
  const handleConfirm = () => {
    if (!isDirectory) {
      onOpenFile(node);
      return;
    }

    if (wouldCycle) {
      return;
    }

    onToggleDirectory(node);
  };

  // 仅点箭头时展开/折叠目录:阻止冒泡,避免连带触发整行的「选中」。
  const handleToggleChevron = (event: MouseEvent) => {
    event.stopPropagation();

    if (wouldCycle) {
      return;
    }

    onToggleDirectory(node);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.path);
    onDragNode(node);
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    if (
      !isDirectory ||
      !draggedNode ||
      draggedNode.path === node.path ||
      isPathInsideOrEqual(node.path, draggedNode.path)
    ) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDropTargetChange({ path: node.path, scope });
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    if (!isDirectory || !draggedNode) {
      return;
    }

    event.preventDefault();
    onDropNode(draggedNode, node.path, scope);
  };

  return (
    <div className="file-tree-node" role="none">
      <button
        aria-expanded={isDirectory ? Boolean(node.expanded) : undefined}
        aria-selected={isSelected}
        className={cn(
          "tree-row w-full text-left",
          isSelected && "tree-row-active",
          (node.error || wouldCycle) && "tree-row-muted",
          node.isHidden && "tree-row-hidden",
          node.isReadonly && "tree-row-readonly",
          isDropTarget && "tree-row-drop-target",
        )}
        data-tree-drop-path={isDirectory ? node.path : undefined}
        data-tree-drop-scope={isDirectory ? scope : undefined}
        draggable
        role="treeitem"
        style={{ "--tree-depth": depth } as CSSProperties}
        type="button"
        title={wouldCycle ? `${node.path}\nSymlink loop blocked.` : node.path}
        onClick={handleSelect}
        onDoubleClick={handleConfirm}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            handleConfirm();
          }
        }}
        onContextMenu={(event) => {
          // 阻止冒泡到 .file-tree-scroll 的 onContextMenu（那里会把目标 node 重置为 null，
          // 导致右键文件时 Rename / Copy / Cut / Trash 菜单项被禁用）。
          event.stopPropagation();
          onContextMenu(node, event, scope);
        }}
        onDragEnd={onDragEnd}
        onDragLeave={() => (isDropTarget ? onDropTargetChange(null) : undefined)}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
      >
        {/* 箭头仅作鼠标便捷展开/折叠;键盘用户用整行的 Enter(handleConfirm)切换,故不另设交互语义。 */}
        <span className="tree-row-toggle" onClick={isDirectory ? handleToggleChevron : undefined}>
          {isDirectory ? (
            node.expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )
          ) : null}
        </span>
        <span className="tree-row-main">
          <Icon className={cn("tree-row-icon", iconClassName)} />
          <span className="tree-row-name">{node.name}</span>
          {node.isSymlink ? <Link2 className="tree-row-badge-icon" /> : null}
        </span>
        <span className="tree-row-size">
          {isLoading ? "..." : wouldCycle ? "loop" : isDirectory ? "" : formatFileSize(node.size)}
        </span>
      </button>
      {node.error || wouldCycle ? (
        <div className="tree-row-error" style={{ "--tree-depth": depth } as CSSProperties}>
          {wouldCycle ? "Symlink loop blocked." : node.error}
        </div>
      ) : null}
    </div>
  );
}

export function FileTreeContextMenu({
  clipboard,
  node,
  onCopyNode,
  onCutNode,
  onPasteNode,
  onRefresh,
  onRequestCreateDirectory,
  onRequestCreateFile,
  onRequestRenameNode,
  onRequestTrashNode,
  onRevealNode,
  x,
  y,
}: {
  clipboard: FileTreeClipboard | null;
  node: FileTreeNode | null;
  onCopyNode: (node: FileTreeNode) => void;
  onCutNode: (node: FileTreeNode) => void;
  onPasteNode: () => void;
  onRefresh: () => void;
  onRequestCreateDirectory: () => void;
  onRequestCreateFile: () => void;
  onRequestRenameNode: (node: FileTreeNode) => void;
  onRequestTrashNode: (node: FileTreeNode) => void;
  onRevealNode: (node: FileTreeNode) => void;
  x: number;
  y: number;
}) {
  const menuStyle = {
    left: Math.min(x, window.innerWidth - 216),
    top: Math.min(y, window.innerHeight - 260),
  } satisfies CSSProperties;

  const menu = (
    <div className="file-tree-context-menu" role="menu" style={menuStyle} onClick={(event) => event.stopPropagation()}>
      <button className="file-tree-context-item" type="button" onClick={onRequestCreateFile}>
        <FilePlus className="file-tree-context-icon" />
        New File
      </button>
      <button className="file-tree-context-item" type="button" onClick={onRequestCreateDirectory}>
        <FolderPlus className="file-tree-context-icon" />
        New Folder
      </button>
      <button className="file-tree-context-item" type="button" onClick={onRefresh}>
        <RefreshCw className="file-tree-context-icon" />
        Refresh
      </button>
      <button
        className="file-tree-context-item"
        disabled={!node}
        type="button"
        onClick={() => node && onRevealNode(node)}
      >
        <FolderSearch className="file-tree-context-icon" />
        在文件管理器中显示
      </button>
      <div className="file-tree-context-separator" />
      <button
        className="file-tree-context-item"
        disabled={!node}
        type="button"
        onClick={() => node && onRequestRenameNode(node)}
      >
        <Pencil className="file-tree-context-icon" />
        Rename
      </button>
      <button
        className="file-tree-context-item"
        disabled={!node}
        type="button"
        onClick={() => node && onCopyNode(node)}
      >
        <Copy className="file-tree-context-icon" />
        Copy
      </button>
      <button className="file-tree-context-item" disabled={!node} type="button" onClick={() => node && onCutNode(node)}>
        <Scissors className="file-tree-context-icon" />
        Cut
      </button>
      <button className="file-tree-context-item" disabled={!clipboard} type="button" onClick={onPasteNode}>
        <ClipboardPaste className="file-tree-context-icon" />
        Paste
      </button>
      <div className="file-tree-context-separator" />
      <button
        className="file-tree-context-item file-tree-context-item-danger"
        disabled={!node}
        type="button"
        onClick={() => node && onRequestTrashNode(node)}
      >
        <Trash2 className="file-tree-context-icon" />
        Move to Trash
      </button>
    </div>
  );

  return createPortal(menu, globalThis.document.body);
}

export function FileTreeNameDialogView({
  dialog,
  name,
  onCancel,
  onNameChange,
  onSubmit,
}: {
  dialog: FileTreeNameDialog | null;
  name: string;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const title =
    dialog?.kind === "create-file" ? "New File" : dialog?.kind === "create-directory" ? "New Folder" : "Rename";

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <Dialog open={Boolean(dialog)} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Enter a name for this file tree item.</DialogDescription>
          </DialogHeader>
          <Input autoFocus className="mt-4" value={name} onChange={(event) => onNameChange(event.target.value)} />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">{dialog?.kind === "rename" ? "Rename" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FileTreeTrashDialog({
  node,
  onCancel,
  onConfirm,
}: {
  node: FileTreeNode | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(node)} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Trash?</DialogTitle>
          <DialogDescription>
            {node ? `${node.name} will be moved to the system Trash.` : "This item will be moved to the system Trash."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
