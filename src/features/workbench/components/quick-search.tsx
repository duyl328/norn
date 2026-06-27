import { invoke } from "@tauri-apps/api/core";
import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  FileText,
  Folder,
  FolderOpen,
  GripHorizontal,
  Regex,
  Search,
  Trash2,
  WholeWord,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type FocusEvent,
  Fragment,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";
import type { FileTreeNode } from "../types";
import {
  getFileTreeDisplayIcon,
  isTauriRuntime,
  saveQuickSearchHistory,
  upsertQuickSearchHistory,
} from "../workbench-utils";
import {
  baseName,
  buildMatchTree,
  buildPreviewRegex,
  firstMatchColumn,
  fuzzyHighlight,
  fuzzyMatch,
  type MatchTreeNode,
  PREVIEW_LINE_CAP,
  renderHighlighted,
  type SearchTextHit,
  toRelativePath,
} from "./quick-search-utils";
type QuickSearchResult = {
  detail: string;
  id: string;
  label: string;
};

const collectTreeSearchResults = (nodes: FileTreeNode[], out: QuickSearchResult[] = []) => {
  for (const node of nodes) {
    out.push({
      detail: node.relativePath || node.path,
      id: node.path,
      label: node.name,
    });

    if (node.children) {
      collectTreeSearchResults(node.children, out);
    }
  }

  return out;
};

export function QuickSearch({ onClose, open }: { onClose: () => void; open: boolean }) {
  if (!open) {
    return null;
  }

  // 经 portal 挂到 body:逃离标题栏的 z-index:100 层叠上下文,否则会被编辑器 Tab 条
  // (z-30000)等高层元素盖住,导致结果点不到、背板也挡不住外部点击。
  return createPortal(<QuickSearchDialog onClose={onClose} />, document.body);
}

// 遍历过滤默认值。ponytail: 暂写死(排除隐藏 + 尊重 .gitignore),后续接入设置项再透传两个 bool。
const SEARCH_EXCLUDE_HIDDEN = true;
const SEARCH_RESPECT_IGNORE = true;
const FILE_RESULT_LIMIT = 50;

type SearchMode = "files" | "text";
type FileResult = { detail: string; label: string; path: string };

// 结果树:复用主文件树的 tree-row 样式。只显示目录 + 文件(命中明细看右侧预览)。
// 双击文件 = 打开并跳到第一处命中;命中行的精确跳转在预览里逐行点击。
function MatchTree({
  collapsed,
  depth = 0,
  nodes,
  onOpenFile,
  onSelect,
  onToggle,
  selectedPath,
}: {
  collapsed: Set<string>;
  depth?: number;
  nodes: MatchTreeNode[];
  onOpenFile: (path: string) => void;
  onSelect: (path: string) => void;
  onToggle: (key: string) => void;
  selectedPath: string | null;
}) {
  return (
    <>
      {nodes.map((node) => {
        const depthStyle = { "--tree-depth": depth } as CSSProperties;

        // 文件叶子
        if (node.path) {
          const filePath = node.path;
          const { Icon, className: iconClassName } = getFileTreeDisplayIcon({
            kind: "file",
            name: node.name,
          } as FileTreeNode);
          return (
            <button
              key={node.key}
              type="button"
              role="option"
              aria-selected={filePath === selectedPath}
              style={depthStyle}
              className={cn("tree-row w-full text-left", filePath === selectedPath && "tree-row-active")}
              onClick={() => onSelect(filePath)}
              onDoubleClick={() => onOpenFile(filePath)}
            >
              <span className="tree-row-toggle" />
              <span className="tree-row-main">
                <Icon className={cn("tree-row-icon", iconClassName)} />
                <span className="tree-row-name">{node.name}</span>
              </span>
              <span className="tree-row-size">{node.count}</span>
            </button>
          );
        }

        // 目录节点
        const isCollapsed = collapsed.has(node.key);
        return (
          <Fragment key={node.key}>
            <button
              type="button"
              style={depthStyle}
              className="tree-row w-full text-left"
              aria-expanded={!isCollapsed}
              onClick={() => onToggle(node.key)}
            >
              <span className="tree-row-toggle">
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </span>
              <span className="tree-row-main">
                {isCollapsed ? (
                  <Folder className="tree-row-icon tree-row-icon-directory" />
                ) : (
                  <FolderOpen className="tree-row-icon tree-row-icon-directory" />
                )}
                <span className="tree-row-name">{node.name}</span>
              </span>
              <span className="tree-row-size" />
            </button>
            {isCollapsed ? null : (
              <MatchTree
                collapsed={collapsed}
                depth={depth + 1}
                nodes={node.children}
                onOpenFile={onOpenFile}
                onSelect={onSelect}
                onToggle={onToggle}
                selectedPath={selectedPath}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function QuickSearchDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  // 两态:false = 居中搜索弹窗(左树右预览);true = 选中文件开始查看后,竖向浮层停靠右边缘。
  const [docked, setDocked] = useState(false);
  // 停靠卡片的位置(可拖动);null = 用默认右上角。
  const [dockPos, setDockPos] = useState<{ left: number; top: number } | null>(null);
  // 停靠卡片折叠:只留头部条,不占大块空间。
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [textHits, setTextHits] = useState<SearchTextHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDocuments = useWorkbenchStore((state) => state.openDocuments);
  const folderView = useWorkbenchStore((state) => state.folderView);
  const scratchFolderView = useWorkbenchStore((state) => state.scratchFolderView);
  const quickSearchHistory = useWorkbenchStore((state) => state.quickSearchHistory);
  const setQuickSearchHistory = useWorkbenchStore((state) => state.setQuickSearchHistory);
  const openFileFromSearch = useWorkbenchStore((state) => state.openFileFromSearch);
  const setPendingReveal = useWorkbenchStore((state) => state.setPendingReveal);

  const root = folderView?.rootPath;
  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  // 文件名:打开且有工作区时,一次性拉全量文件路径缓存,后续在前端模糊过滤。
  // 无工作区时不清空(渲染按 root 走内存树回退,不读 fileNames)。
  useEffect(() => {
    if (!root || !isTauriRuntime()) {
      return;
    }

    let cancelled = false;
    invoke<string[]>("search_file_names", {
      root,
      excludeHidden: SEARCH_EXCLUDE_HIDDEN,
      respectIgnoreFiles: SEARCH_RESPECT_IGNORE,
    })
      .then((paths) => {
        if (!cancelled) setFileNames(paths);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [root]);

  // 内容:防抖 200ms 后调后端并行遍历搜索;开关变化也会重搜。
  // 条件不满足时直接返回(渲染按 mode/trimmedQuery 守卫,不读 textHits)。
  useEffect(() => {
    if (mode !== "text" || !root || !isTauriRuntime() || !trimmedQuery) {
      return;
    }

    let cancelled = false;
    const handle = window.setTimeout(() => {
      setBusy(true);
      invoke<SearchTextHit[]>("search_in_files", {
        root,
        query: trimmedQuery,
        caseSensitive,
        wholeWord,
        regex: useRegex,
        excludeHidden: SEARCH_EXCLUDE_HIDDEN,
        respectIgnoreFiles: SEARCH_RESPECT_IGNORE,
      })
        .then((hits) => {
          if (!cancelled) {
            setTextHits(hits);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setTextHits([]);
            setError(String(err));
          }
        })
        .finally(() => {
          if (!cancelled) setBusy(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mode, root, trimmedQuery, caseSensitive, wholeWord, useRegex]);

  // 文件名结果:有工作区用后端缓存模糊过滤;无工作区回退到内存树 + 已打开文档(保留旧能力)。
  const fileResults = useMemo<FileResult[]>(() => {
    if (!normalizedQuery) return [];

    if (root) {
      const out: FileResult[] = [];
      for (const path of fileNames) {
        const rel = toRelativePath(path, root);
        if (fuzzyMatch(rel, normalizedQuery)) {
          out.push({ detail: rel, label: baseName(rel), path });
          if (out.length >= FILE_RESULT_LIMIT) break;
        }
      }
      return out;
    }

    const seen = new Set<string>();
    const out: FileResult[] = [];
    const add = (path: string, label: string, detail: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      if (fuzzyMatch(`${label}\n${detail}`, normalizedQuery)) out.push({ detail, label, path });
    };
    openDocuments.forEach((document) => add(document.path, document.name, document.path));
    collectTreeSearchResults(folderView?.nodes ?? []).forEach((result) => add(result.id, result.label, result.detail));
    collectTreeSearchResults(scratchFolderView.nodes).forEach((result) => add(result.id, result.label, result.detail));
    return out.slice(0, FILE_RESULT_LIMIT);
  }, [root, fileNames, normalizedQuery, openDocuments, folderView?.nodes, scratchFolderView.nodes]);

  // 内容结果按文件分组(VSCode 风格):每组一个文件头 + 若干行命中。
  const textGroups = useMemo(() => {
    const map = new Map<string, SearchTextHit[]>();
    for (const hit of textHits) {
      const list = map.get(hit.path);
      if (list) list.push(hit);
      else map.set(hit.path, [hit]);
    }
    return [...map.entries()];
  }, [textHits]);

  // IDEA 式分栏:左侧文件列表 + 右侧高亮预览。
  const groupPaths = useMemo(() => textGroups.map(([path]) => path), [textGroups]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // 派生「实际选中项」:用户选过且仍在结果里就用它,否则回退到第一个 —— 避免在 effect 里 setState。
  const effectiveSelected = selectedPath && groupPaths.includes(selectedPath) ? selectedPath : (groupPaths[0] ?? null);

  const [preview, setPreview] = useState<{ content: string; path: string } | null>(null);
  const [previewErrorPath, setPreviewErrorPath] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const previewRegex = useMemo(
    () => buildPreviewRegex(trimmedQuery, caseSensitive, wholeWord, useRegex),
    [trimmedQuery, caseSensitive, wholeWord, useRegex],
  );
  const selectedHits = useMemo(
    () => textGroups.find(([path]) => path === effectiveSelected)?.[1] ?? [],
    [textGroups, effectiveSelected],
  );
  const matchLineSet = useMemo(() => new Set(selectedHits.map((hit) => hit.line)), [selectedHits]);

  // 文件内命中导航:matchNav 记住「哪个文件 + 第几处」;切文件时派生回 0,避免在 effect 里 setState。
  const [matchNav, setMatchNav] = useState<{ index: number; path: string } | null>(null);
  const currentMatchIndex =
    matchNav && matchNav.path === effectiveSelected ? Math.min(matchNav.index, selectedHits.length - 1) : 0;
  const currentMatchLine = selectedHits[currentMatchIndex]?.line;
  const gotoMatch = (delta: number) => {
    if (selectedHits.length < 1 || !effectiveSelected) return;
    const next = (currentMatchIndex + delta + selectedHits.length) % selectedHits.length; // 循环
    setMatchNav({ index: next, path: effectiveSelected });
  };

  const matchTree = useMemo(() => buildMatchTree(textGroups, root), [textGroups, root]);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const toggleDir = (key: string) =>
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // 选中文件变化时读取其内容用于预览(已加载同一文件则跳过,setState 只在异步回调里发生)。
  useEffect(() => {
    if (mode !== "text" || !effectiveSelected || !isTauriRuntime()) return;
    if (preview?.path === effectiveSelected) return;

    let cancelled = false;
    invoke<{ content: string }>("read_text_file", { path: effectiveSelected })
      .then((file) => {
        if (!cancelled) setPreview({ content: file.content, path: effectiveSelected });
      })
      .catch(() => {
        if (!cancelled) setPreviewErrorPath(effectiveSelected);
      });

    return () => {
      cancelled = true;
    };
  }, [mode, effectiveSelected, preview]);

  // 预览就绪 / 上一处下一处导航时,把当前命中行滚动到视图中央。
  useEffect(() => {
    if (preview?.path !== effectiveSelected || !currentMatchLine) return;
    previewRef.current?.querySelector(`[data-line="${currentMatchLine}"]`)?.scrollIntoView({ block: "center" });
  }, [preview, effectiveSelected, currentMatchLine]);

  const commitHistory = (value: string) => {
    if (!value) return;
    const next = upsertQuickSearchHistory(quickSearchHistory, value);
    setQuickSearchHistory(next);
    saveQuickSearchHistory(next);
  };

  // Files 模式:快速打开并关闭(Ctrl+P 式)。
  const quickOpen = (path: string) => {
    commitHistory(trimmedQuery);
    openFileFromSearch?.(path);
    onClose();
  };

  // 文本模式:打开到主编辑器并定位到行/列,同时把结果停靠为右侧卡片(无需重搜)。
  const viewFileAt = (path: string, line: number, column: number) => {
    commitHistory(trimmedQuery);
    setPendingReveal({ column, line, path });
    openFileFromSearch?.(path);
    setDocked(true);
    setDockCollapsed(false); // 开始查看时总是展开
  };

  // 打开某文件并定位到它的第一处命中(树节点双击 / 回车)。
  const viewFile = (path: string) => {
    const hit = textGroups.find(([groupPath]) => groupPath === path)?.[1]?.[0];
    viewFileAt(path, hit?.line ?? 1, hit ? firstMatchColumn(hit.text, previewRegex) : 0);
  };

  // 拖动停靠卡片:按住头部移动。点头部里的按钮(折叠/关闭)不触发拖动,否则指针捕获会吞掉按钮点击。
  const onDockDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDockDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragOffsetRef.current) return;
    // 限制在视口内,卡片不能被拖出屏幕。
    const rect = panelRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 420;
    const height = rect?.height ?? 0;
    const margin = 8;
    const left = Math.min(
      Math.max(event.clientX - dragOffsetRef.current.x, margin),
      window.innerWidth - width - margin,
    );
    const top = Math.min(
      Math.max(event.clientY - dragOffsetRef.current.y, margin),
      window.innerHeight - height - margin,
    );
    setDockPos({ left, top });
  };
  const onDockDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragOffsetRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const applyHistoryItem = (value: string) => {
    setQuery(value);
    commitHistory(value);
    inputRef.current?.focus();
  };

  const clearHistory = () => {
    setQuickSearchHistory([]);
    saveQuickSearchHistory([]);
    inputRef.current?.focus();
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const needsFolderForText = mode === "text" && !root;
  const showTextSplit = mode === "text" && Boolean(root) && Boolean(trimmedQuery) && !busy && textGroups.length > 0;
  // 停靠折叠时只显示头部条,隐藏搜索框与结果。
  const showBody = !(docked && dockCollapsed);

  // 焦点离开整个面板 → 隐藏(取消聚焦即关闭)。点内部按钮不算离开(见下方 onMouseDown)。
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!panelRef.current?.contains(event.relatedTarget as Node | null)) {
      onClose();
    }
  };

  // 停靠卡片的位置:用户拖过就用 dockPos,否则默认靠右上。
  const dockStyle = docked
    ? { left: dockPos?.left ?? Math.max(16, window.innerWidth - 420 - 24), top: dockPos?.top ?? 56 }
    : undefined;

  return (
    <div
      className={cn("windows-quick-search", docked && "windows-quick-search-docked")}
      role="dialog"
      aria-label={t("quickSearch.dialogLabel")}
      onClick={docked ? undefined : onClose}
    >
      <div
        className={cn(
          "windows-quick-search-panel",
          !docked && mode === "text" && textGroups.length > 0 && "windows-quick-search-panel-wide",
          docked && "windows-quick-search-panel-docked",
          docked && dockCollapsed && "windows-quick-search-panel-docked-collapsed",
        )}
        ref={panelRef}
        style={dockStyle}
        onClick={(event) => event.stopPropagation()}
        onBlur={docked ? undefined : handleBlur}
        // WebKit 点击按钮不会转移焦点;阻止默认让输入框保持聚焦,内部点击因此不触发 blur 关闭,
        // 但 click 仍会照常派发(结果/标签/开关都能点)。输入框本身放行以便定位光标。
        onMouseDown={(event) => {
          if (event.target !== inputRef.current) {
            event.preventDefault();
          }
        }}
      >
        {docked ? (
          <div
            className="windows-quick-search-dock-header"
            onPointerDown={onDockDragStart}
            onPointerMove={onDockDragMove}
            onPointerUp={onDockDragEnd}
          >
            <GripHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="windows-quick-search-dock-title">{t("quickSearch.resultsTitle")}</span>
            <button
              type="button"
              className="windows-quick-search-icon-button"
              aria-label={dockCollapsed ? t("common.expand") : t("common.collapse")}
              title={dockCollapsed ? t("common.expand") : t("common.collapse")}
              onClick={() => setDockCollapsed((value) => !value)}
            >
              {dockCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className="windows-quick-search-icon-button"
              aria-label={t("quickSearch.closeSearch")}
              title={t("common.close")}
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {docked ? null : (
          <div className="windows-quick-search-tabs" role="tablist" aria-label={t("quickSearch.modeLabel")}>
            {(["files", "text"] as const).map((value) => (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={mode === value}
                className={cn("windows-quick-search-tab", mode === value && "windows-quick-search-tab-active")}
                onClick={() => {
                  setMode(value);
                  setDocked(false); // 切换 Tab = 回到搜索弹窗形态
                }}
              >
                {value === "files" ? t("quickSearch.files") : t("quickSearch.text")}
              </button>
            ))}
          </div>
        )}

        <div className={cn("windows-quick-search-input-wrap", !showBody && "hidden")}>
          <Search className="windows-quick-search-input-icon" aria-hidden="true" />
          <input
            className="windows-quick-search-input"
            autoFocus
            ref={inputRef}
            value={query}
            placeholder={mode === "files" ? t("quickSearch.searchFilesPlaceholder") : t("quickSearch.searchTextPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
                return;
              }

              // 文本模式:上下键在左侧文件列表里移动选中项。
              if (mode === "text" && (event.key === "ArrowDown" || event.key === "ArrowUp") && groupPaths.length > 0) {
                event.preventDefault();
                const index = effectiveSelected ? groupPaths.indexOf(effectiveSelected) : -1;
                const next =
                  event.key === "ArrowDown" ? Math.min(index + 1, groupPaths.length - 1) : Math.max(index - 1, 0);
                setSelectedPath(groupPaths[next]);
                return;
              }

              if (event.key === "Enter" && trimmedQuery) {
                event.preventDefault();
                if (mode === "text") {
                  // 文本模式回车 = 开始查看:打开到编辑器 + 停靠右侧(预览自动滚到当前命中)。
                  if (effectiveSelected) viewFile(effectiveSelected);
                } else if (fileResults[0]) {
                  quickOpen(fileResults[0].path);
                } else {
                  commitHistory(trimmedQuery);
                }
              }
            }}
          />
          {mode === "text" ? (
            <div className="windows-quick-search-flags">
              <button
                type="button"
                title={t("quickSearch.matchCase")}
                aria-pressed={caseSensitive}
                className={cn("windows-quick-search-flag", caseSensitive && "windows-quick-search-flag-on")}
                onClick={() => setCaseSensitive((value) => !value)}
              >
                <CaseSensitive className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={t("quickSearch.matchWholeWord")}
                aria-pressed={wholeWord}
                className={cn("windows-quick-search-flag", wholeWord && "windows-quick-search-flag-on")}
                onClick={() => setWholeWord((value) => !value)}
              >
                <WholeWord className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title={t("quickSearch.useRegex")}
                aria-pressed={useRegex}
                className={cn("windows-quick-search-flag", useRegex && "windows-quick-search-flag-on")}
                onClick={() => setUseRegex((value) => !value)}
              >
                <Regex className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>

        {!docked && quickSearchHistory.length > 0 ? (
          <section className="windows-quick-search-section" aria-label={t("quickSearch.history")}>
            <div className="windows-quick-search-section-heading">
              <span>{t("quickSearch.history")}</span>
              <button
                className="windows-quick-search-icon-button"
                type="button"
                aria-label={t("quickSearch.clearHistory")}
                title={t("quickSearch.clearHistory")}
                onClick={clearHistory}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="windows-quick-search-history-list">
              {quickSearchHistory.map((item) => {
                const selected = item.toLowerCase() === normalizedQuery;

                return (
                  <button
                    className={cn(
                      "windows-quick-search-history-item",
                      selected && "windows-quick-search-item-selected",
                    )}
                    type="button"
                    key={item}
                    aria-label={t("quickSearch.useHistoryItem", { item })}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => applyHistoryItem(item)}
                  >
                    <Clock3 className="h-3.5 w-3.5 shrink-0" />
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <div
          className={cn(
            "windows-quick-search-results",
            showTextSplit && "windows-quick-search-results-split",
            !showBody && "hidden",
          )}
          aria-label={t("quickSearch.resultsLabel")}
        >
          {error ? <div className="windows-quick-search-empty">{error}</div> : null}
          {needsFolderForText ? (
            <div className="windows-quick-search-empty">{t("quickSearch.openFolderForText")}</div>
          ) : mode === "files" ? (
            trimmedQuery ? (
              fileResults.length > 0 ? (
                fileResults.map((result) => (
                  <button
                    className="windows-quick-search-result"
                    type="button"
                    key={result.path}
                    onClick={() => quickOpen(result.path)}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="windows-quick-search-result-text">
                      <span className="windows-quick-search-result-label">{result.label}</span>
                      <span className="windows-quick-search-result-detail">
                        {fuzzyHighlight(result.detail, normalizedQuery)}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="windows-quick-search-empty">{t("quickSearch.noFilesMatch")}</div>
              )
            ) : quickSearchHistory.length === 0 ? (
              <div className="windows-quick-search-empty">{t("quickSearch.typeToSearchFiles")}</div>
            ) : null
          ) : !trimmedQuery ? (
            <div className="windows-quick-search-empty">{t("quickSearch.typeToSearchContents")}</div>
          ) : busy ? (
            <div className="windows-quick-search-empty">{t("quickSearch.searching")}</div>
          ) : textGroups.length > 0 ? (
            <div className={cn("windows-quick-search-split", docked && "windows-quick-search-split-docked")}>
              <div className="windows-quick-search-file-list" role="listbox" aria-label={t("quickSearch.matchedFiles")}>
                <MatchTree
                  collapsed={collapsedDirs}
                  nodes={matchTree}
                  onOpenFile={viewFile}
                  onSelect={setSelectedPath}
                  onToggle={toggleDir}
                  selectedPath={effectiveSelected}
                />
              </div>
              <div className="windows-quick-search-preview-pane">
                {effectiveSelected && selectedHits.length > 0 ? (
                  <div className="windows-quick-search-preview-bar">
                    <span className="windows-quick-search-preview-bar-title">{baseName(effectiveSelected)}</span>
                    <span className="windows-quick-search-preview-bar-count">
                      {currentMatchIndex + 1}/{selectedHits.length}
                    </span>
                    <button
                      type="button"
                      className="windows-quick-search-icon-button"
                      title={t("quickSearch.previousMatch")}
                      aria-label={t("quickSearch.previousMatch")}
                      disabled={selectedHits.length < 2}
                      onClick={() => gotoMatch(-1)}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="windows-quick-search-icon-button"
                      title={t("quickSearch.nextMatch")}
                      aria-label={t("quickSearch.nextMatch")}
                      disabled={selectedHits.length < 2}
                      onClick={() => gotoMatch(1)}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                <div className="windows-quick-search-preview" ref={previewRef}>
                  {effectiveSelected && preview?.path === effectiveSelected ? (
                    preview.content
                      .split("\n")
                      .slice(0, PREVIEW_LINE_CAP)
                      .map((line, index) => {
                        const lineNo = index + 1;
                        const isMatch = matchLineSet.has(lineNo);
                        return (
                          <div
                            key={lineNo}
                            data-line={lineNo}
                            className={cn(
                              "windows-quick-search-preview-line",
                              isMatch && "windows-quick-search-preview-line-match",
                              lineNo === currentMatchLine && "windows-quick-search-preview-line-current",
                            )}
                            onClick={() => viewFileAt(effectiveSelected, lineNo, firstMatchColumn(line, previewRegex))}
                          >
                            <span className="windows-quick-search-preview-lineno">{lineNo}</span>
                            <span className="windows-quick-search-preview-code">
                              {isMatch ? renderHighlighted(line, previewRegex) : line || " "}
                            </span>
                          </div>
                        );
                      })
                  ) : previewErrorPath === effectiveSelected ? (
                    <div className="windows-quick-search-empty">{t("quickSearch.unablePreview")}</div>
                  ) : (
                    <div className="windows-quick-search-empty">{t("common.loading")}</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="windows-quick-search-empty">{t("quickSearch.noMatches")}</div>
          )}
        </div>

        {docked ? null : (
          <button className="windows-quick-search-close" type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        )}
      </div>
    </div>
  );
}
