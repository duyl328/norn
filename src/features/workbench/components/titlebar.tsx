import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Menu,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Square,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { recentProjects, type WindowsTitlebarMenuId, windowsTitlebarMenus } from "../constants";
import type { EditorTabPreview } from "../types";
import { getProjectAccentStyle, getProjectInitials } from "../workbench-utils";

export function WindowsTitleBar({
  leftPanelOpen,
  onCloseSearch,
  onCreateFile,
  onOpenFile,
  onOpenFolder,
  onOpenSearch,
  onSaveFile,
  onSaveFileAs,
  onToggleLeftPanel,
  onToggleRightPanel,
  rightPanelOpen,
  searchOpen,
}: {
  leftPanelOpen: boolean;
  onCloseSearch: () => void;
  onCreateFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenSearch: () => void;
  onSaveFile: () => void;
  onSaveFileAs: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
  searchOpen: boolean;
}) {
  const appWindow = getCurrentWindow();
  const [projectName, setProjectName] = useState<string>(recentProjects[0].name);
  const projectInitials = getProjectInitials(projectName);
  const projectAccentStyle = getProjectAccentStyle(projectName);
  const menuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [menuExpanded, setMenuExpanded] = useState(false);
  const [activeMenu, setActiveMenu] = useState<WindowsTitlebarMenuId | null>(null);
  const [submenuLeft, setSubmenuLeft] = useState(0);

  const selectProject = (name: string) => {
    setProjectName(name);
    setProjectMenuOpen(false);
  };

  const openMenu = () => {
    setProjectMenuOpen(false);
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
    if (!projectMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (projectMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setProjectMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectMenuOpen(false);
      }
    };

    const handleWindowBlur = () => {
      setProjectMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [projectMenuOpen]);

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

  const handleMenuItemClick = (child: string) => {
    if (child === "New File") {
      onCreateFile();
    }

    if (child === "Open File") {
      onOpenFile();
    }

    if (child === "Open Folder") {
      onOpenFolder();
    }

    if (child === "Save") {
      onSaveFile();
    }

    if (child === "Save As") {
      onSaveFileAs();
    }

    if (child === "Minimize") appWindow.minimize();
    if (child === "Maximize / Restore") appWindow.toggleMaximize();
    if (child === "Close") appWindow.close();
    collapseMenu();
  };

  return (
    <header className="windows-titlebar" onDoubleClick={handleTitlebarDoubleClick}>
      <div className="windows-titlebar-left" ref={menuRef}>
        {!menuExpanded ? (
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
            <PanelToggleButton
              className="titlebar-panel-button"
              label={leftPanelOpen ? "Hide file tree" : "Show file tree"}
              open={leftPanelOpen}
              side="left"
              onClick={onToggleLeftPanel}
            />
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
                {activeMenuConfig.children.map((child) => (
                  <button
                    className={cn(
                      "windows-titlebar-submenu-item",
                      child === "Close" && "windows-titlebar-submenu-item-danger",
                    )}
                    key={child}
                    type="button"
                    data-titlebar-submenu-action="true"
                    onClick={() => handleMenuItemClick(child)}
                  >
                    {child}
                  </button>
                ))}
              </div>
            ) : null}
          </nav>
        )}
        {!menuExpanded ? (
          <div className="windows-titlebar-project">
            <div className="windows-titlebar-project-picker" ref={projectMenuRef}>
              <button
                className={cn("windows-titlebar-folder", projectMenuOpen && "windows-titlebar-folder-active")}
                type="button"
                aria-expanded={projectMenuOpen}
                onClick={() => setProjectMenuOpen((value) => !value)}
              >
                <span className="windows-titlebar-folder-icon" style={projectAccentStyle}>
                  {projectInitials}
                </span>
                <span className="windows-titlebar-folder-name">{projectName}</span>
              </button>
              {projectMenuOpen ? (
                <div className="windows-titlebar-folder-menu">
                  <button className="windows-titlebar-folder-menu-item" type="button" onClick={onOpenFolder}>
                    Open Folder
                  </button>
                  <button
                    className="windows-titlebar-folder-menu-item"
                    type="button"
                    onClick={() => setProjectMenuOpen(false)}
                  >
                    Add Folder
                  </button>
                  <div className="windows-titlebar-folder-menu-section">
                    {recentProjects.map((project) => (
                      <button
                        className="windows-titlebar-recent-project"
                        key={project.path}
                        type="button"
                        onClick={() => selectProject(project.name)}
                      >
                        <span
                          className="windows-titlebar-recent-project-icon"
                          style={getProjectAccentStyle(project.name)}
                        >
                          {getProjectInitials(project.name)}
                        </span>
                        <span className="windows-titlebar-recent-project-text">
                          <span className="windows-titlebar-recent-project-name">{project.name}</span>
                          <span className="windows-titlebar-recent-project-path">{project.path}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="windows-titlebar-drag-fill" data-tauri-drag-region />
      <div className="windows-titlebar-search-entry">
        <TopSearchButton className="windows-titlebar-search-button" onClick={onOpenSearch} />
      </div>
      <QuickSearch open={searchOpen} onClose={onCloseSearch} />
      <div className="windows-titlebar-drag-fill windows-titlebar-drag-fill-right" data-tauri-drag-region />
      <div className="windows-titlebar-right-tools">
        <PanelToggleButton
          className="titlebar-panel-button"
          label={rightPanelOpen ? "Hide Git panel" : "Show Git panel"}
          open={rightPanelOpen}
          side="right"
          showBadge
          onClick={onToggleRightPanel}
        />
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
  leftPanelOpen,
  onCloseSearch,
  onOpenSearch,
  onToggleLeftPanel,
  onToggleRightPanel,
  rightPanelOpen,
  searchOpen,
}: {
  leftPanelOpen: boolean;
  onCloseSearch: () => void;
  onOpenSearch: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  rightPanelOpen: boolean;
  searchOpen: boolean;
}) {
  return (
    <header className="mac-titlebar" data-tauri-drag-region>
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
  className,
  label,
  onClick,
  open,
  showBadge = false,
  side,
  useLocalSidebarIcon = false,
}: {
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
      {showBadge ? <span className="panel-toggle-badge">4</span> : null}
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

export function QuickSearch({ onClose, open }: { onClose: () => void; open: boolean }) {
  if (!open) {
    return null;
  }

  return (
    <div className="windows-quick-search" role="dialog" aria-label="Quick search" onClick={onClose}>
      <div className="windows-quick-search-panel" onClick={(event) => event.stopPropagation()}>
        <input
          className="windows-quick-search-input"
          autoFocus
          placeholder="Search files, commands, symbols"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClose();
            }
          }}
        />
        <div className="windows-quick-search-results">
          <button className="windows-quick-search-result" type="button">
            src/features/workbench/workbench-page.tsx
          </button>
          <button className="windows-quick-search-result" type="button">
            src-tauri/src/lib.rs
          </button>
          <button className="windows-quick-search-result" type="button">
            src/styles.css
          </button>
        </div>
        <button className="windows-quick-search-close" type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
