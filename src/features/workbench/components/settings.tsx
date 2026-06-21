import {
  ArrowLeft,
  Gauge,
  GitBranch,
  Keyboard,
  MonitorCog,
  Palette,
  Search,
  type Settings,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { settingsSidebarDefaultWidth, settingsSidebarMaxWidth, settingsSidebarMinWidth } from "../constants";
import type { GitWorkspaceState } from "../types";
import { clamp } from "../workbench-utils";

type SettingsTabId = "general" | "permissions" | "git" | "appearance" | "shortcuts" | "advanced";

const settingsGroups: Array<{
  title: string;
  items: Array<{ id: SettingsTabId; icon: typeof Settings; label: string }>;
}> = [
  {
    title: "基础",
    items: [
      { id: "general", icon: Gauge, label: "通用设置" },
      { id: "appearance", icon: Palette, label: "外观设置" },
      { id: "shortcuts", icon: Keyboard, label: "快捷键" },
    ],
  },
  {
    title: "安全",
    items: [
      { id: "permissions", icon: ShieldCheck, label: "权限设置" },
      { id: "git", icon: GitBranch, label: "Git 设置" },
    ],
  },
  {
    title: "其他",
    items: [{ id: "advanced", icon: MonitorCog, label: "高级选项" }],
  },
];

export function SettingsPage({
  gitWorkspace,
  onBack,
  onToggleResizeHandleHints,
  resizeHandleHintsVisible,
  showMacTitlebar,
}: {
  gitWorkspace: GitWorkspaceState;
  onBack: () => void;
  onToggleResizeHandleHints: () => void;
  resizeHandleHintsVisible: boolean;
  showMacTitlebar: boolean;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("general");
  const [settingsSidebarWidth, setSettingsSidebarWidth] = useState(settingsSidebarDefaultWidth);
  const [settingsResizing, setSettingsResizing] = useState(false);

  const resizeSettingsSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keyDeltas: Record<string, number> = {
      ArrowLeft: -16,
      ArrowRight: 16,
    };

    if (event.key === "Home") {
      event.preventDefault();
      setSettingsSidebarWidth(settingsSidebarMinWidth);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setSettingsSidebarWidth(settingsSidebarMaxWidth);
      return;
    }

    const delta = keyDeltas[event.key];

    if (!delta) {
      return;
    }

    event.preventDefault();
    setSettingsSidebarWidth((width) => clamp(width + delta, settingsSidebarMinWidth, settingsSidebarMaxWidth));
  };

  const startSettingsSidebarResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerStart = event.clientX;
    const widthStart = settingsSidebarWidth;

    event.preventDefault();
    setSettingsResizing(true);

    const previousCursor = globalThis.document.body.style.cursor;
    const previousUserSelect = globalThis.document.body.style.userSelect;
    globalThis.document.body.style.cursor = "col-resize";
    globalThis.document.body.style.userSelect = "none";

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
      const delta = pointerEvent.clientX - pointerStart;
      setSettingsSidebarWidth(clamp(widthStart + delta, settingsSidebarMinWidth, settingsSidebarMaxWidth));
    };

    const handlePointerUp = () => {
      setSettingsResizing(false);
      globalThis.document.body.style.cursor = previousCursor;
      globalThis.document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div className={cn("settings-page", showMacTitlebar && "settings-page-mac")}>
      <div className="settings-drag-region" data-tauri-drag-region />
      <div
        className={cn("settings-shell", settingsResizing && "settings-shell-resizing")}
        style={
          {
            "--settings-sidebar-width": `${settingsSidebarWidth}px`,
          } as CSSProperties
        }
      >
        <aside className="settings-sidebar">
          <button className="settings-back-button" type="button" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            回到软件
          </button>
          <div className="settings-search">
            <Search className="h-4 w-4" />
            <span>搜索设置...</span>
          </div>
          <nav className="settings-nav" aria-label="设置分类">
            {settingsGroups.map((group) => (
              <div className="settings-nav-group" key={group.title}>
                <div className="settings-nav-heading">{group.title}</div>
                {group.items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <button
                      className={cn("settings-nav-item", activeTab === item.id && "settings-nav-item-active")}
                      key={item.id}
                      type="button"
                      onClick={() => setActiveTab(item.id)}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
        <div
          aria-label="调整设置侧栏宽度"
          aria-orientation="vertical"
          aria-valuemax={settingsSidebarMaxWidth}
          aria-valuemin={settingsSidebarMinWidth}
          aria-valuenow={settingsSidebarWidth}
          className="settings-resize-handle"
          onKeyDown={resizeSettingsSidebarWithKeyboard}
          onPointerDown={startSettingsSidebarResize}
          role="separator"
          tabIndex={0}
        />
        <main className="settings-main">
          <SettingsContent
            activeTab={activeTab}
            gitWorkspace={gitWorkspace}
            onToggleResizeHandleHints={onToggleResizeHandleHints}
            resizeHandleHintsVisible={resizeHandleHintsVisible}
          />
        </main>
      </div>
    </div>
  );
}

export function SettingsContent({
  activeTab,
  gitWorkspace,
  onToggleResizeHandleHints,
  resizeHandleHintsVisible,
}: {
  activeTab: SettingsTabId;
  gitWorkspace: GitWorkspaceState;
  onToggleResizeHandleHints: () => void;
  resizeHandleHintsVisible: boolean;
}) {
  const gitInspection = gitWorkspace.kind === "ready" ? gitWorkspace.inspection : null;
  const gitCommandLabel =
    gitWorkspace.kind === "loading"
      ? "检测中"
      : gitInspection?.gitAvailable
        ? (gitInspection.gitVersion ?? "可用")
        : gitWorkspace.kind === "ready"
          ? "不可用"
          : "尚未检测";
  const repositoryLabel =
    gitWorkspace.kind === "loading"
      ? "检测中"
      : gitInspection?.isRepository
        ? "已检测到 Git 仓库"
        : gitInspection
          ? "当前文件夹不是 Git 仓库"
          : "请先从左侧打开文件夹";
  const gitRootLabel = gitInspection?.gitRoot ?? "无";
  const dotGitLabel = gitInspection
    ? gitInspection.hasDotGit
      ? "当前文件夹存在 .git"
      : "当前文件夹没有 .git"
    : "尚未检测";
  const branchLabel = gitInspection?.branch ?? "无";
  const messageLabel =
    gitWorkspace.kind === "error"
      ? gitWorkspace.message
      : (gitInspection?.message ?? "打开文件夹后会自动检测 Git 状态。");

  if (activeTab === "permissions") {
    return (
      <SettingsPanel title="权限设置" description="管理 Norn 对文件、命令和系统能力的访问方式。">
        <SettingsList>
          <SettingsListRow title="默认工作区权限" description="允许读取和编辑当前打开工作区内的文件。" enabled />
          <SettingsListRow title="Git 命令权限" description="允许在当前工作区内读取 Git 状态和分支信息。" enabled />
          <SettingsListRow title="跨目录写入" description="需要单独确认后才允许写入工作区外的路径。" />
        </SettingsList>
      </SettingsPanel>
    );
  }

  if (activeTab === "git") {
    return (
      <SettingsPanel title="Git 设置" description="Git 检测以左侧当前打开的文件夹为准。">
        <SettingsList>
          <SettingsInfoRow title="Git 命令" value={gitCommandLabel} />
          <SettingsInfoRow title="仓库状态" value={repositoryLabel} />
          <SettingsInfoRow title=".git 检测" value={dotGitLabel} />
          <SettingsInfoRow title="Git 根目录" value={gitRootLabel} />
          <SettingsInfoRow title="当前分支" value={branchLabel} />
        </SettingsList>
        <div className="settings-note">{messageLabel}</div>
      </SettingsPanel>
    );
  }

  if (activeTab === "appearance") {
    return (
      <SettingsPanel title="外观设置" description="控制界面密度、主题和左右面板的显示方式。">
        <SettingsList>
          <SettingsInfoRow title="界面密度" value="紧凑" />
          <SettingsInfoRow title="主题" value="跟随系统" />
          <SettingsListRow title="轻量化面板" description="减少阴影和装饰，让编辑区域保持优先。" enabled />
          <SettingsListRow
            title="显示面板调节提示"
            description="常驻显示左右面板之间的淡色拖拽区域。关闭后仍可拖动，鼠标移入时显示反馈。"
            enabled={resizeHandleHintsVisible}
            onClick={onToggleResizeHandleHints}
          />
        </SettingsList>
      </SettingsPanel>
    );
  }

  if (activeTab === "shortcuts") {
    return (
      <SettingsPanel title="快捷键" description="当前采用接近 JetBrains 的默认快捷键方案。">
        <SettingsList>
          <SettingsInfoRow title="保存文件" value="Cmd / Ctrl + S" />
          <SettingsInfoRow title="另存为" value="Cmd / Ctrl + Shift + S" />
          <SettingsInfoRow title="打开搜索" value="Cmd / Ctrl + F" />
        </SettingsList>
      </SettingsPanel>
    );
  }

  if (activeTab === "advanced") {
    return (
      <SettingsPanel title="高级选项" description="这里预留后续工作区、缓存和诊断配置。">
        <SettingsList>
          <SettingsInfoRow title="配置存储" value="本地 JSON，待接入" />
          <SettingsInfoRow title="诊断日志" value="待接入" />
          <SettingsInfoRow title="最近项目" value="浏览器本地存储" />
        </SettingsList>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel title="通用设置" description="调整 Norn 的基础行为和默认工作方式。">
      <div className="settings-choice-grid">
        <button className="settings-choice settings-choice-active" type="button">
          <Terminal className="h-4 w-4" />
          <span>
            <strong>代码工作</strong>
            <small>显示更完整的技术细节和控制项</small>
          </span>
        </button>
        <button className="settings-choice" type="button">
          <MonitorCog className="h-4 w-4" />
          <span>
            <strong>日常轻量</strong>
            <small>减少次要信息，保持界面安静</small>
          </span>
        </button>
      </div>
      <SettingsList>
        <SettingsInfoRow title="快捷键方案" value="JetBrains 兼容" />
        <SettingsInfoRow title="编辑器内核" value="CodeMirror 6" />
        <SettingsListRow title="启动后恢复上次工作区" description="下次打开时自动恢复最近使用的文件夹。" />
        <SettingsListRow title="显示底部状态栏" description="展示当前文件、编码和 Git 状态。" enabled />
      </SettingsList>
    </SettingsPanel>
  );
}

export function SettingsPanel({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="settings-panel-body">{children}</div>
    </div>
  );
}

export function SettingsList({ children }: { children: ReactNode }) {
  return <div className="settings-list">{children}</div>;
}

export function SettingsInfoRow({ title, value }: { title: string; value: string }) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
      </div>
      <div className="settings-row-value">{value}</div>
    </div>
  );
}

export function SettingsListRow({
  description,
  enabled = false,
  onClick,
  title,
}: {
  description: string;
  enabled?: boolean;
  onClick?: () => void;
  title: string;
}) {
  const content = (
    <>
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        <div className="settings-row-description">{description}</div>
      </div>
      <span className={cn("settings-toggle", enabled && "settings-toggle-on")} aria-hidden="true" />
    </>
  );

  if (onClick) {
    return (
      <button className="settings-row settings-row-button" type="button" onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className="settings-row">{content}</div>;
}
