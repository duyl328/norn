import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardCopy,
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
  Terminal,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
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

import { useI18n } from "../i18n";
import type {
  FileTreeClipboard,
  FileTreeContextMenuState,
  FileTreeGitDecoration,
  FileTreeNameDialog,
  FileTreeNode,
  TreeDropTarget,
  TreePanelView,
  TreeSearch,
  TreeSelection,
  TreeSelectionModifiers,
} from "../types";
import {
  flattenVisibleTreeRows,
  formatFileSize,
  getFileTreeDisplayIcon,
  isPathInsideOrEqual,
} from "../workbench-utils";

export function FileTreePanel({
  activePath,
  selection,
  search,
  clipboard,
  contextMenu,
  draggedNode,
  dropTarget,
  gitDecorations,
  scope,
  treeView,
  onContextMenu,
  onCopyNode,
  onCutNode,
  onCopyPath,
  onDragEnd,
  onDragNode,
  onDropNode,
  onDropTargetChange,
  onOpenFile,
  onSelectNode,
  onTreeKeyDown,
  onTreeBlur,
  onPasteNode,
  onRefreshFolder,
  onRequestCreateDirectory,
  onRequestCreateFile,
  onRequestRenameNode,
  onRequestTrashNode,
  onRevealNode,
  onOpenTerminal,
  onToggleDirectory,
  onToggleRootDirectory,
  onExpandAll,
  onCollapseAll,
  onRevealActiveFile,
}: {
  activePath: string;
  selection: TreeSelection | null;
  search: TreeSearch | null;
  clipboard: FileTreeClipboard | null;
  contextMenu: FileTreeContextMenuState | null;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  gitDecorations?: Map<string, FileTreeGitDecoration> | null;
  scope: "main" | "scratch";
  treeView: TreePanelView | null;
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onCopyNode: (node: FileTreeNode) => void;
  onCutNode: (node: FileTreeNode) => void;
  onCopyPath: (node: FileTreeNode, mode: "absolute" | "relative") => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onSelectNode: (node: FileTreeNode, modifiers: TreeSelectionModifiers, scope: "main" | "scratch") => void;
  onTreeKeyDown: (scope: "main" | "scratch", event: ReactKeyboardEvent) => void;
  onTreeBlur: () => void;
  onPasteNode: (targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onRefreshFolder: (path: string, scope?: "main" | "scratch") => void;
  onRequestCreateDirectory: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestCreateFile: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestRenameNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onRequestTrashNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onRevealNode: (node: FileTreeNode) => void;
  onOpenTerminal: (node: FileTreeNode) => void;
  onToggleDirectory: (node: FileTreeNode) => void;
  onToggleRootDirectory: () => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  onRevealActiveFile?: () => void;
}) {
  const { t } = useI18n();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  // 该作用域当前选中的路径集合与光标行(跨作用域时为空,避免另一棵树误高亮)。
  const selectedPaths = useMemo(
    () => new Set(selection?.scope === scope ? selection.paths : []),
    [selection, scope],
  );
  const leadPath = selection?.scope === scope ? selection.leadPath : null;
  // 即输即搜:本作用域的查询(空 = 未搜索)。匹配在行内按子串高亮,命中数显示在搜索条上。
  const searchQuery = search?.scope === scope ? search.query : "";
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
  const searchMatchCount = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return needle ? rows.filter((row) => row.node.name.toLowerCase().includes(needle)).length : 0;
  }, [searchQuery, rows]);

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

    // 定位按钮已把光标行切到编辑区当前文件;滚动到该行。
    const targetIndex = rows.findIndex((row) => row.node.path === leadPath);

    if (targetIndex < 0) {
      // 祖先目录仍在加载,目标行尚未出现;rows 更新后本 effect 会重跑。
      return;
    }

    pendingRevealRef.current = false;
    treeVirtualizer.scrollToIndex(targetIndex, { align: "center" });
  }, [revealNonce, rows, leadPath, treeVirtualizer]);

  // 键盘移动光标(lead)后把它滚入视口;align:"auto" 已可见则不动,故鼠标点击可见行不会触发滚动。
  useEffect(() => {
    if (pendingRevealRef.current || leadPath == null) {
      return;
    }

    const targetIndex = rows.findIndex((row) => row.node.path === leadPath);

    if (targetIndex >= 0) {
      treeVirtualizer.scrollToIndex(targetIndex, { align: "auto" });
    }
    // 仅在 lead 变化时滚动;rows 频繁变化不应反复拉回视图。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadPath]);

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
      {searchQuery ? (
        <div className="file-tree-search-bar">
          <span className="file-tree-search-query">{searchQuery}</span>
          <span className="file-tree-search-count">
            {searchMatchCount > 0 ? t("fileTree.searchCount", { count: searchMatchCount }) : t("fileTree.noMatches")}
          </span>
        </div>
      ) : null}
      <div
        className="file-tree-scroll min-h-0 flex-1"
        ref={scrollParentRef}
        onContextMenu={(event) => onContextMenu(null, event, scope)}
      >
        <div
          className={cn("file-tree-list outline-none", !hasRootDirectories && "file-tree-list-flat")}
          role="tree"
          aria-label={treeView.rootName}
          aria-multiselectable
          aria-activedescendant={leadPath ? `tree-row:${scope}:${leadPath}` : undefined}
          data-tree-drop-path={treeView.rootPath}
          data-tree-drop-scope={scope}
          tabIndex={0}
          // 整棵树共享一个键盘焦点(roving 焦点会与虚拟滚动冲突):点击任意行把焦点拉到容器,
          // 之后方向键/快捷键都在这里处理,行被虚拟化卸载也不会丢失焦点。
          onKeyDown={(event) => onTreeKeyDown(scope, event)}
          onMouseDown={(event) => event.currentTarget.focus()}
          // 焦点离开文件树即退出搜索(类 IDEA speed search)。行不可聚焦,blur 即代表焦点真正离开本树。
          onBlur={onTreeBlur}
        >
          {treeView.loadingPath === treeView.rootPath && treeView.nodes.length === 0 ? (
            <div className="px-2 py-2 text-ui text-muted-foreground">{t("fileTree.loadingFolder")}</div>
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
                    selectedPaths={selectedPaths}
                    leadPath={leadPath}
                    searchQuery={searchQuery}
                    ancestorCanonicalPaths={row.ancestorCanonicalPaths}
                    depth={row.depth}
                    draggedNode={draggedNode}
                    dropTarget={dropTarget}
                    gitDecoration={gitDecorations?.get(row.node.path) ?? null}
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
            <div className="px-2 py-2 text-ui text-muted-foreground">{t("fileTree.emptyFolder")}</div>
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
          onOpenTerminal={onOpenTerminal}
          onCopyPath={onCopyPath}
          rootPath={treeView.rootPath}
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
  const { t } = useI18n();
  const isDropTarget = dropTarget?.scope === scope && dropTarget.path === treeView.rootPath;
  const hasActions = Boolean(onExpandAll || onCollapseAll || onRevealActiveFile);
  const rootNode: FileTreeNode = {
    children: treeView.nodes,
    childrenLoaded: true,
    expanded: treeView.rootExpanded,
    kind: "directory",
    name: treeView.rootName,
    path: treeView.rootPath,
    relativePath: ".",
  };

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
        onContextMenu={(event) => {
          event.stopPropagation();
          onContextMenu(rootNode, event, scope);
        }}
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
              title={t("fileTree.revealActive")}
              aria-label={t("fileTree.revealActiveAria")}
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
              title={t("fileTree.expandAll")}
              aria-label={t("fileTree.expandAllAria")}
              onClick={onExpandAll}
            >
              <ChevronsUpDown className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {onCollapseAll ? (
            <button
              className="file-tree-root-action"
              type="button"
              title={t("fileTree.collapseAll")}
              aria-label={t("fileTree.collapseAllAria")}
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

// 即输即搜:把名字里第一处匹配(不分大小写)用 <mark> 高亮。无查询/无命中时原样返回。
function highlightMatch(name: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return name;
  }
  const start = name.toLowerCase().indexOf(needle);
  if (start < 0) {
    return name;
  }
  return (
    <>
      {name.slice(0, start)}
      <mark className="tree-row-match">{name.slice(start, start + needle.length)}</mark>
      {name.slice(start + needle.length)}
    </>
  );
}

export function FileTreeRow({
  selectedPaths,
  leadPath,
  searchQuery,
  ancestorCanonicalPaths,
  depth = 0,
  draggedNode,
  dropTarget,
  gitDecoration,
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
  selectedPaths: Set<string>;
  leadPath: string | null;
  searchQuery: string;
  ancestorCanonicalPaths: string[];
  depth?: number;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  gitDecoration: FileTreeGitDecoration | null;
  loadingPath: string | null;
  node: FileTreeNode;
  scope: "main" | "scratch";
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onSelectNode: (node: FileTreeNode, modifiers: TreeSelectionModifiers, scope: "main" | "scratch") => void;
  onToggleDirectory: (node: FileTreeNode) => void;
}) {
  const { t } = useI18n();
  const isDirectory = node.kind === "directory";
  const isSelected = selectedPaths.has(node.path);
  const isLead = node.path === leadPath;
  const isLoading = loadingPath === node.path;
  const isDropTarget = isDirectory && dropTarget?.scope === scope && dropTarget.path === node.path;
  const canonicalPath = node.canonicalPath ?? node.path;
  const wouldCycle = isDirectory && node.isSymlink && ancestorCanonicalPaths.includes(canonicalPath);
  const { className: iconClassName, Icon } = getFileTreeDisplayIcon(node);

  // 单击:更新多选(高亮),不打开文件、不展开目录。Ctrl/Cmd 切换单项,Shift 选区间。
  const handleSelect = (event: MouseEvent) => {
    onSelectNode(node, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey }, scope);
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

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.path);
    onDragNode(node);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
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

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!isDirectory || !draggedNode) {
      return;
    }

    event.preventDefault();
    onDropNode(draggedNode, node.path, scope);
  };

  return (
    <div className="file-tree-node" role="none">
      <div
        aria-expanded={isDirectory ? Boolean(node.expanded) : undefined}
        aria-selected={isSelected}
        className={cn(
          "tree-row w-full text-left",
          isSelected && "tree-row-active",
          isLead && "tree-row-lead",
          (node.error || wouldCycle) && "tree-row-muted",
          node.isHidden && "tree-row-hidden",
          node.isReadonly && "tree-row-readonly",
          gitDecoration && `tree-row-git-${gitDecoration}`,
          isDropTarget && "tree-row-drop-target",
        )}
        data-tree-drop-path={isDirectory ? node.path : undefined}
        data-tree-drop-scope={isDirectory ? scope : undefined}
        draggable
        role="treeitem"
        // 行不可聚焦(无 tabIndex):点击不会把焦点从 .file-tree-list 容器抢走,
        // 否则该行被虚拟化卸载后焦点丢到 body,方向键就失效了。光标由容器的 aria-activedescendant 跟踪。
        id={`tree-row:${scope}:${node.path}`}
        style={{ "--tree-depth": depth } as CSSProperties}
        title={wouldCycle ? t("fileTree.symlinkLoopTitle", { path: node.path }) : node.path}
        onClick={handleSelect}
        onDoubleClick={handleConfirm}
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
          <span className="tree-row-name">{highlightMatch(node.name, searchQuery)}</span>
          {node.isSymlink ? <Link2 className="tree-row-badge-icon" /> : null}
        </span>
        <span className="tree-row-size">
          {isLoading ? "..." : wouldCycle ? t("fileTree.loop") : isDirectory ? "" : formatFileSize(node.size)}
        </span>
      </div>
      {node.error || wouldCycle ? (
        <div className="tree-row-error" style={{ "--tree-depth": depth } as CSSProperties}>
          {wouldCycle ? t("fileTree.symlinkLoopBlocked") : node.error}
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
  onOpenTerminal,
  onCopyPath,
  rootPath,
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
  onOpenTerminal: (node: FileTreeNode) => void;
  onCopyPath: (node: FileTreeNode, mode: "absolute" | "relative") => void;
  rootPath: string;
  x: number;
  y: number;
}) {
  const { t } = useI18n();
  const isRootNode = Boolean(node && node.kind === "directory" && node.path === rootPath);
  const menuStyle = {
    left: Math.min(x, window.innerWidth - 216),
    top: Math.min(y, window.innerHeight - 260),
  } satisfies CSSProperties;

  const menu = (
    <div className="file-tree-context-menu" role="menu" style={menuStyle} onClick={(event) => event.stopPropagation()}>
      <button className="file-tree-context-item" role="menuitem" type="button" onClick={onRequestCreateFile}>
        <FilePlus className="file-tree-context-icon" />
        {t("fileTree.newFile")}
      </button>
      <button className="file-tree-context-item" role="menuitem" type="button" onClick={onRequestCreateDirectory}>
        <FolderPlus className="file-tree-context-icon" />
        {t("fileTree.newFolder")}
      </button>
      <button className="file-tree-context-item" role="menuitem" type="button" onClick={onRefresh}>
        <RefreshCw className="file-tree-context-icon" />
        {t("common.refresh")}
      </button>
      <button
        className="file-tree-context-item"
        disabled={!node}
        role="menuitem"
        type="button"
        onClick={() => node && onRevealNode(node)}
      >
        <FolderSearch className="file-tree-context-icon" />
        {t("fileTree.revealInFileManager")}
      </button>
      <button
        className="file-tree-context-item"
        disabled={!node}
        role="menuitem"
        type="button"
        onClick={() => node && onOpenTerminal(node)}
      >
        <Terminal className="file-tree-context-icon" />
        {t("fileTree.openTerminalHere")}
      </button>
      <div className="file-tree-context-separator" />
      <button
        className="file-tree-context-item"
        disabled={!node || isRootNode}
        role="menuitem"
        type="button"
        onClick={() => node && onRequestRenameNode(node)}
      >
        <Pencil className="file-tree-context-icon" />
        {t("common.rename")}
      </button>
      <button
        className="file-tree-context-item"
        disabled={!node}
        role="menuitem"
        type="button"
        onClick={() => node && onCopyNode(node)}
      >
        <Copy className="file-tree-context-icon" />
        {t("common.copy")}
      </button>
      <button
        className="file-tree-context-item"
        disabled={!node}
        role="menuitem"
        type="button"
        onClick={() => node && onCutNode(node)}
      >
        <Scissors className="file-tree-context-icon" />
        {t("common.cut")}
      </button>
      <button className="file-tree-context-item" disabled={!clipboard} role="menuitem" type="button" onClick={onPasteNode}>
        <ClipboardPaste className="file-tree-context-icon" />
        {t("common.paste")}
      </button>
      <div className="file-tree-context-separator" />
      <button
        className="file-tree-context-item"
        disabled={!node}
        role="menuitem"
        type="button"
        onClick={() => node && onCopyPath(node, "absolute")}
      >
        <ClipboardCopy className="file-tree-context-icon" />
        {t("fileTree.copyPath")}
      </button>
      <button
        className="file-tree-context-item"
        disabled={!node}
        role="menuitem"
        type="button"
        onClick={() => node && onCopyPath(node, "relative")}
      >
        <ClipboardCopy className="file-tree-context-icon" />
        {t("fileTree.copyRelativePath")}
      </button>
      <div className="file-tree-context-separator" />
      <button
        className="file-tree-context-item file-tree-context-item-danger"
        disabled={!node || isRootNode}
        role="menuitem"
        type="button"
        onClick={() => node && onRequestTrashNode(node)}
      >
        <Trash2 className="file-tree-context-icon" />
        {t("fileTree.moveToTrash")}
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
  const { t } = useI18n();
  const title =
    dialog?.kind === "create-file"
      ? t("fileTree.newFile")
      : dialog?.kind === "create-directory"
        ? t("fileTree.newFolder")
        : t("common.rename");

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
            <DialogDescription>{t("fileTree.nameDialogDescription")}</DialogDescription>
          </DialogHeader>
          <Input autoFocus className="mt-4" value={name} onChange={(event) => onNameChange(event.target.value)} />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit">{dialog?.kind === "rename" ? t("common.rename") : t("common.create")}</Button>
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
  const { t } = useI18n();

  return (
    <Dialog open={Boolean(node)} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("fileTree.moveToTrashTitle")}</DialogTitle>
          <DialogDescription>
            {node ? t("fileTree.moveToTrashNamed", { name: node.name }) : t("fileTree.moveToTrashFallback")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("fileTree.moveToTrash")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
