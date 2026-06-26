import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Clock3,
  FileText,
  Menu,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { formatKey } from "../actions/registry";
import { useActions } from "../actions/use-actions";
import { type WindowsMenuItem, type WindowsTitlebarMenuId, windowsTitlebarMenus } from "../constants";
import { useWorkbenchStore } from "../store/workbench-store";
import type { EditorTabPreview, FileTreeNode } from "../types";
import { saveQuickSearchHistory, upsertQuickSearchHistory } from "../workbench-utils";

export function WindowsTitleBar({
  gitBadgeCount,
  leftPanelOpen,
  onCloseSearch,
  onOpenSearch,
  onToggleLeftPanel,
  onToggleRightPanel,
  rightPanelOpen,
  searchOpen,
  variant = "workbench",
}: {
  gitBadgeCount?: number;
  leftPanelOpen: boolean;
  onCloseSearch: () => void;
  onOpenSearch: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
  searchOpen: boolean;
  // "settings" 变体:仅保留汉堡菜单 + 窗口控制按钮(隐藏搜索 / 面板开关 / 项目选择器),
  // 用于设置页顶部 —— Windows 无边框窗口,设置页也需要可关闭窗口与访问菜单。
  variant?: "workbench" | "settings";
}) {
  const appWindow = getCurrentWindow();
  const { actions, dispatch } = useActions();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuExpanded, setMenuExpanded] = useState(false);
  const [activeMenu, setActiveMenu] = useState<WindowsTitlebarMenuId | null>(null);
  const [submenuLeft, setSubmenuLeft] = useState(0);

  const openMenu = () => {
    setMenuExpanded(true);
  };

  const collapseMenu = () => {
    setMenuExpanded(false);
    setActiveMenu(null);
  };

  const activateMenu = (menuId: WindowsTitlebarMenuId, menuElement: HTMLElement) => {
    setSubmenuLeft(menuElement.offsetLeft);
    setActiveMenu(menuId);
  };

  useEffect(() => {
    if (!menuExpanded) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest("[data-titlebar-submenu-action='true']")) {
        return;
      }

      collapseMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        collapseMenu();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        collapseMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", collapseMenu);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", collapseMenu);
    };
  }, [menuExpanded]);

  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;

    if (target.closest("button, input, textarea, select, a, [role='dialog'], [contenteditable='true']")) {
      return;
    }

    if (!target.closest("[data-tauri-drag-region]")) {
      return;
    }

    appWindow.toggleMaximize();
  };

  const activeMenuConfig = activeMenu ? windowsTitlebarMenus.find((item) => item.id === activeMenu) : null;

  const actionById = new Map(actions.map((action) => [action.id, action]));

  const handleMenuItemClick = (item: WindowsMenuItem) => {
    if (item.window === "minimize") appWindow.minimize();
    else if (item.window === "maximize") appWindow.toggleMaximize();
    else if (item.window === "close") appWindow.close();
    else if (item.actionId) dispatch(item.actionId);
    collapseMenu();
  };

  return (
    <header className="windows-titlebar" onDoubleClick={handleTitlebarDoubleClick}>
      <div className="windows-titlebar-left" ref={menuRef}>
        {variant === "settings" ? null : !menuExpanded ? (
          <>
            <button
              className="windows-titlebar-menu-button"
              type="button"
              aria-label="Toggle application menu"
              aria-expanded={menuExpanded}
              onClick={openMenu}
            >
              <Menu className="h-4 w-4" />
            </button>
            {variant === "workbench" ? (
              <PanelToggleButton
                className="titlebar-panel-button"
                label={leftPanelOpen ? "Hide file tree" : "Show file tree"}
                open={leftPanelOpen}
                side="left"
                onClick={onToggleLeftPanel}
              />
            ) : null}
          </>
        ) : (
          <nav className="windows-titlebar-inline-menu" aria-label="Application menu">
            {windowsTitlebarMenus.map((item) => (
              <div
                className="windows-titlebar-parent-menu"
                key={item.id}
                onPointerEnter={(event) => activateMenu(item.id, event.currentTarget)}
              >
                <button
                  className={cn(
                    "windows-titlebar-parent-menu-button",
                    activeMenu === item.id && "windows-titlebar-parent-menu-button-active",
                  )}
                  type="button"
                  aria-expanded={activeMenu === item.id}
                  onClick={(event) => {
                    const menuElement = event.currentTarget.parentElement;
                    if (menuElement) {
                      activateMenu(item.id, menuElement);
                    }
                  }}
                  onFocus={(event) => {
                    const menuElement = event.currentTarget.parentElement;
                    if (menuElement) {
                      activateMenu(item.id, menuElement);
                    }
                  }}
                >
                  {item.label}
                </button>
              </div>
            ))}
            {activeMenuConfig ? (
              <div className="windows-titlebar-submenu" style={{ transform: `translateX(${submenuLeft}px)` }}>
                {activeMenuConfig.children.map((child) => {
                  const action = child.actionId ? actionById.get(child.actionId) : undefined;
                  const label = action?.title ?? child.label;
                  const shortcut = action?.keys?.[0] ? formatKey(action.keys[0]) : null;

                  return (
                    <button
                      className={cn(
                        "windows-titlebar-submenu-item",
                        child.window === "close" && "windows-titlebar-submenu-item-danger",
                      )}
                      key={child.label}
                      type="button"
                      data-titlebar-submenu-action="true"
                      onClick={() => handleMenuItemClick(child)}
                    >
                      <span>{label}</span>
                      {shortcut ? <span className="windows-titlebar-submenu-shortcut">{shortcut}</span> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </nav>
        )}
      </div>
      <div className="windows-titlebar-drag-fill" data-tauri-drag-region />
      {variant === "workbench" ? (
        <>
          <div className="windows-titlebar-search-entry">
            <TopSearchButton className="windows-titlebar-search-button" onClick={onOpenSearch} />
          </div>
          <QuickSearch open={searchOpen} onClose={onCloseSearch} />
        </>
      ) : null}
      <div className="windows-titlebar-drag-fill windows-titlebar-drag-fill-right" data-tauri-drag-region />
      <div className="windows-titlebar-right-tools">
        {variant === "workbench" ? (
          <PanelToggleButton
            className="titlebar-panel-button"
            label={rightPanelOpen ? "Hide Git panel" : "Show Git panel"}
            open={rightPanelOpen}
            side="right"
            badgeCount={gitBadgeCount}
            showBadge
            onClick={onToggleRightPanel}
          />
        ) : null}
      </div>
      <div className="windows-titlebar-controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button
          className="windows-window-button"
          type="button"
          aria-label="Minimize"
          onClick={() => appWindow.minimize()}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          className="windows-window-button"
          type="button"
          aria-label="Maximize or restore"
          onClick={() => appWindow.toggleMaximize()}
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          className="windows-window-button windows-window-button-close"
          type="button"
          aria-label="Close"
          onClick={() => appWindow.close()}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

export function MacTitlebar({
  gitBadgeCount,
  leftPanelOpen,
  leftPanelWidth,
  onCloseSearch,
  onOpenSearch,
  onToggleLeftPanel,
  onToggleRightPanel,
  rightPanelOpen,
  rightPanelWidth,
  searchOpen,
}: {
  gitBadgeCount?: number;
  leftPanelOpen: boolean;
  leftPanelWidth: number;
  onCloseSearch: () => void;
  onOpenSearch: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  searchOpen: boolean;
}) {
  // 搜索框跟随「编辑区」:把左/右面板占用的横向区间作为 CSS 变量传给 CSS,
  // 由 .mac-titlebar-search 用 calc 居中到「左面板右沿 ↔ 右面板左沿」之间(即编辑区)。
  // 面板收起时对应区间为 0 → 退化为整窗居中。
  const editorRegionStyle = {
    "--titlebar-editor-left": `${leftPanelOpen ? leftPanelWidth : 0}px`,
    "--titlebar-editor-right": `${rightPanelOpen ? rightPanelWidth : 0}px`,
  } as CSSProperties;

  return (
    <header className="mac-titlebar" data-tauri-drag-region style={editorRegionStyle}>
      <div className="mac-titlebar-side mac-titlebar-side-left" data-tauri-drag-region>
        <PanelToggleButton
          className="titlebar-panel-button mac-panel-toggle-button"
          label={leftPanelOpen ? "Hide file tree" : "Show file tree"}
          open={leftPanelOpen}
          side="left"
          useLocalSidebarIcon
          onClick={onToggleLeftPanel}
        />
      </div>
      <div className="mac-titlebar-search">
        <TopSearchButton className="mac-titlebar-search-button" onClick={onOpenSearch} />
      </div>
      <div className="mac-titlebar-side mac-titlebar-side-right" data-tauri-drag-region>
        <PanelToggleButton
          className="titlebar-panel-button mac-panel-toggle-button"
          label={rightPanelOpen ? "Hide Git panel" : "Show Git panel"}
          open={rightPanelOpen}
          side="right"
          badgeCount={gitBadgeCount}
          showBadge
          useLocalSidebarIcon
          onClick={onToggleRightPanel}
        />
      </div>
      <QuickSearch open={searchOpen} onClose={onCloseSearch} />
    </header>
  );
}

export function PanelToggleButton({
  badgeCount,
  className,
  label,
  onClick,
  open,
  showBadge = false,
  side,
  useLocalSidebarIcon = false,
}: {
  badgeCount?: number;
  className?: string;
  label: string;
  onClick: () => void;
  open: boolean;
  showBadge?: boolean;
  side: "left" | "right";
  useLocalSidebarIcon?: boolean;
}) {
  // Windows(非 useLocalSidebarIcon)用随面板开合切换箭头的 lucide 图标;mac 仍用本地自绘 SVG。
  const StatefulIcon =
    side === "left" ? (open ? PanelLeftClose : PanelLeftOpen) : open ? PanelRightClose : PanelRightOpen;

  return (
    <button
      className={cn("panel-toggle-button", className, open && "panel-toggle-button-active")}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={open}
      onClick={onClick}
    >
      {useLocalSidebarIcon ? <SidebarPanelIcon side={side} /> : <StatefulIcon className="h-3 w-3" />}
      {showBadge && badgeCount !== undefined && badgeCount > 0 ? (
        <span className="panel-toggle-badge">{badgeCount > 99 ? "99+" : badgeCount}</span>
      ) : null}
    </button>
  );
}

export function SidebarPanelIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg
      className={cn("sidebar-panel-svg", side === "right" && "sidebar-panel-svg-right")}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="22" height="22" rx="6" fill="#F3F6E6" />
      <rect x="4" y="4" width="16" height="16" rx="3.4" stroke="#7E847A" strokeWidth="1.4" fill="none" />
      <rect x="6.75" y="7.4" width="2.05" height="9" rx="1.02" fill="#7B8178" />
    </svg>
  );
}

export function PanelResizeHandle({
  max,
  min,
  onKeyDown,
  onPointerDown,
  open,
  side,
  value,
}: {
  max: number;
  min: number;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  open: boolean;
  side: "left" | "right";
  value: number;
}) {
  return (
    <div
      aria-hidden={!open}
      aria-label={`Resize ${side} panel`}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={cn(
        "workbench-panel-resize-handle",
        `workbench-panel-resize-handle-${side}`,
        !open && "workbench-panel-resize-handle-hidden",
      )}
      onKeyDown={open ? onKeyDown : undefined}
      onPointerDown={open ? onPointerDown : undefined}
      role="separator"
      tabIndex={open ? 0 : -1}
    />
  );
}

export function TabFoldStack({
  open,
  side,
  tabs,
}: {
  open: boolean;
  side: "left" | "right";
  tabs: EditorTabPreview[];
}) {
  return (
    <div
      className={cn(
        "editor-file-tabs-fold-stack",
        `editor-file-tabs-fold-stack-${side}`,
        tabs.length > 0 && "editor-file-tabs-fold-stack-visible",
        open && "editor-file-tabs-fold-stack-open",
      )}
      aria-hidden="true"
    >
      {tabs.map((tab) => (
        <span
          className="editor-file-tabs-fold-card"
          key={tab.id}
          style={{ "--tab-fold-color": tab.accent } as CSSProperties}
        />
      ))}
    </div>
  );
}

export function TopSearchButton({ className, onClick }: { className: string; onClick: () => void }) {
  return (
    <button className={className} type="button" onClick={onClick}>
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Search files, commands, symbols</span>
    </button>
  );
}

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

  return <QuickSearchDialog onClose={onClose} />;
}

function QuickSearchDialog({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const openDocuments = useWorkbenchStore((state) => state.openDocuments);
  const folderView = useWorkbenchStore((state) => state.folderView);
  const scratchFolderView = useWorkbenchStore((state) => state.scratchFolderView);
  const quickSearchHistory = useWorkbenchStore((state) => state.quickSearchHistory);
  const setQuickSearchHistory = useWorkbenchStore((state) => state.setQuickSearchHistory);

  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const results: QuickSearchResult[] = [];
    const add = (result: QuickSearchResult) => {
      if (seen.has(result.id)) {
        return;
      }

      seen.add(result.id);
      results.push(result);
    };

    for (const document of openDocuments) {
      add({
        detail: document.path,
        id: document.path,
        label: document.name,
      });
    }

    collectTreeSearchResults(folderView?.nodes ?? []).forEach(add);
    collectTreeSearchResults(scratchFolderView.nodes).forEach(add);

    return results;
  }, [folderView?.nodes, openDocuments, scratchFolderView.nodes]);

  const trimmedQuery = query.trim();
  const normalizedQuery = trimmedQuery.toLocaleLowerCase();
  const results = useMemo(() => {
    if (!normalizedQuery) {
      return [];
    }

    return candidates
      .filter((candidate) =>
        `${candidate.label}\n${candidate.detail}`.toLocaleLowerCase().includes(normalizedQuery),
      )
      .slice(0, 8);
  }, [candidates, normalizedQuery]);

  const commitHistory = (value: string) => {
    const next = upsertQuickSearchHistory(quickSearchHistory, value);
    setQuickSearchHistory(next);
    saveQuickSearchHistory(next);
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

  return (
    <div className="windows-quick-search" role="dialog" aria-label="Quick search" onClick={onClose}>
      <div className="windows-quick-search-panel" onClick={(event) => event.stopPropagation()}>
        <div className="windows-quick-search-input-wrap">
          <Search className="windows-quick-search-input-icon" aria-hidden="true" />
          <input
            className="windows-quick-search-input"
            autoFocus
            ref={inputRef}
            value={query}
            placeholder="Search files, commands, symbols"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
                return;
              }

              if (event.key === "Enter" && trimmedQuery) {
                event.preventDefault();
                commitHistory(trimmedQuery);
              }
            }}
          />
        </div>
        {quickSearchHistory.length > 0 ? (
          <section className="windows-quick-search-section" aria-label="Search history">
            <div className="windows-quick-search-section-heading">
              <span>Search history</span>
              <button
                className="windows-quick-search-icon-button"
                type="button"
                aria-label="Clear search history"
                title="Clear search history"
                onClick={clearHistory}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="windows-quick-search-history-list">
              {quickSearchHistory.map((item) => {
                const selected = item.toLocaleLowerCase() === normalizedQuery;

                return (
                  <button
                    className={cn("windows-quick-search-history-item", selected && "windows-quick-search-item-selected")}
                    type="button"
                    key={item}
                    aria-label={`Use ${item} from search history`}
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
        <div className="windows-quick-search-results" aria-label="Search results">
          {trimmedQuery ? (
            results.length > 0 ? (
              results.map((result) => (
                <button
                  className="windows-quick-search-result"
                  type="button"
                  key={result.id}
                  onClick={() => {
                    commitHistory(trimmedQuery);
                    onClose();
                  }}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="windows-quick-search-result-text">
                    <span className="windows-quick-search-result-label">{result.label}</span>
                    <span className="windows-quick-search-result-detail">{result.detail}</span>
                  </span>
                </button>
              ))
            ) : (
              <div className="windows-quick-search-empty">No results</div>
            )
          ) : quickSearchHistory.length === 0 ? (
            <div className="windows-quick-search-empty">No search history yet</div>
          ) : null}
        </div>
        <button className="windows-quick-search-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
