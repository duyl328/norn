import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Database,
  Gauge,
  GitBranch,
  Keyboard,
  MonitorCog,
  Palette,
  Search,
  type Settings,
  ShieldCheck,
} from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { EDITOR_PRIMITIVES } from "../actions/editor-actions";
import { eventToSpec, formatKey } from "../actions/registry";
import { useActions } from "../actions/use-actions";
import { settingsSidebarDefaultWidth, settingsSidebarMaxWidth, settingsSidebarMinWidth } from "../constants";
import {
  exportSettings,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  importSettings,
  resolveConfigDir,
  TAB_SIZE_MAX,
  TAB_SIZE_MIN,
} from "../settings";
import { collectSettings, useWorkbenchStore } from "../store/workbench-store";
import { clamp, isTauriRuntime, loadKeymapOverrides, saveKeymapOverrides } from "../workbench-utils";

type SettingsTabId = "general" | "permissions" | "git" | "appearance" | "shortcuts" | "data" | "advanced";

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
    items: [
      { id: "data", icon: Database, label: "数据 / 同步" },
      { id: "advanced", icon: MonitorCog, label: "高级选项" },
    ],
  },
];

export function SettingsPage({
  onBack,
  showMacTitlebar,
}: {
  onBack: () => void;
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
          <SettingsContent activeTab={activeTab} />
        </main>
      </div>
    </div>
  );
}

export function SettingsContent({ activeTab }: { activeTab: SettingsTabId }) {
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
    return <GitSettingsPanel />;
  }

  if (activeTab === "appearance") {
    return <AppearancePanel />;
  }

  if (activeTab === "shortcuts") {
    return (
      <SettingsPanel
        title="快捷键"
        description="点击某条的键位按钮，按下新组合即可改键；重复键位会自动从原命令解绑。Esc 取消录制。"
      >
        <KeymapEditor />
      </SettingsPanel>
    );
  }

  if (activeTab === "data") {
    return <DataPanel />;
  }

  if (activeTab === "advanced") {
    return <AdvancedPanel />;
  }

  return <GeneralPanel />;
}

/** 通用:编辑器基础行为。 */
function GeneralPanel() {
  const tabSize = useWorkbenchStore((state) => state.editorTabSize);
  const setTabSize = useWorkbenchStore((state) => state.setEditorTabSize);
  const formatOnSave = useWorkbenchStore((state) => state.editorFormatOnSave);
  const setFormatOnSave = useWorkbenchStore((state) => state.setEditorFormatOnSave);
  const restoreLastWorkspace = useWorkbenchStore((state) => state.restoreLastWorkspace);
  const setRestoreLastWorkspace = useWorkbenchStore((state) => state.setRestoreLastWorkspace);
  const showStatusBar = useWorkbenchStore((state) => state.showStatusBar);
  const setShowStatusBar = useWorkbenchStore((state) => state.setShowStatusBar);

  return (
    <SettingsPanel title="通用设置" description="调整 Norn 的基础行为和默认工作方式。">
      <SettingsList>
        <SettingsStepperRow
          title="Tab 宽度"
          description="一个缩进等于几个空格,影响显示与缩进键。"
          value={tabSize}
          min={TAB_SIZE_MIN}
          max={TAB_SIZE_MAX}
          onChange={setTabSize}
        />
        <SettingsListRow
          title="保存时整理"
          description="保存前按文件类型整理缩进与空白(JSON / 花括号 / 标签 / 空白),不改变语义。"
          enabled={formatOnSave}
          onClick={() => setFormatOnSave(!formatOnSave)}
        />
        <SettingsListRow
          title="启动后恢复上次工作区"
          description="下次打开时自动恢复最近使用的文件夹。"
          enabled={restoreLastWorkspace}
          onClick={() => setRestoreLastWorkspace(!restoreLastWorkspace)}
        />
        <SettingsListRow
          title="显示底部状态栏"
          description="展示当前文件、编码和 Git 状态。"
          enabled={showStatusBar}
          onClick={() => setShowStatusBar(!showStatusBar)}
        />
      </SettingsList>
    </SettingsPanel>
  );
}

/** 外观:主题、字号与面板显示。 */
function AppearancePanel() {
  const theme = useWorkbenchStore((state) => state.theme);
  const setTheme = useWorkbenchStore((state) => state.setTheme);
  const fontSize = useWorkbenchStore((state) => state.editorFontSize);
  const setFontSize = useWorkbenchStore((state) => state.setEditorFontSize);
  const lineWrapping = useWorkbenchStore((state) => state.editorLineWrapping);
  const setLineWrapping = useWorkbenchStore((state) => state.setEditorLineWrapping);
  const resizeHandleHints = useWorkbenchStore((state) => state.resizeHandleHintsVisible);
  const setResizeHandleHints = useWorkbenchStore((state) => state.setResizeHandleHintsVisible);

  return (
    <SettingsPanel title="外观设置" description="控制主题、编辑器字号和面板的显示方式。">
      <SettingsList>
        <SettingsSegmentedRow
          title="主题"
          description="跟随系统会随操作系统的明暗自动切换。"
          value={theme}
          options={[
            { value: "system", label: "跟随系统" },
            { value: "light", label: "浅色" },
            { value: "dark", label: "深色" },
          ]}
          onChange={setTheme}
        />
        <SettingsStepperRow
          title="编辑器字号"
          description="编辑区文字大小。"
          value={fontSize}
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          onChange={setFontSize}
        />
        <SettingsListRow
          title="长行自动换行"
          description="超出宽度的长行自动折到下一行显示，不再横向滚动。"
          enabled={lineWrapping}
          onClick={() => setLineWrapping(!lineWrapping)}
        />
        <SettingsListRow
          title="显示面板调节提示"
          description="常驻显示左右面板之间的淡色拖拽区域。关闭后仍可拖动，鼠标移入时显示反馈。"
          enabled={resizeHandleHints}
          onClick={() => setResizeHandleHints(!resizeHandleHints)}
        />
      </SettingsList>
    </SettingsPanel>
  );
}

/** 数据 / 同步:导入导出一整套习惯,跨设备搬运。 */
function DataPanel() {
  const applySettings = useWorkbenchStore((state) => state.applySettings);
  const setKeymapOverrides = useWorkbenchStore((state) => state.setKeymapOverrides);
  const [note, setNote] = useState<string | null>(null);
  const [configDir, setConfigDir] = useState<string | null>(null);

  useEffect(() => {
    void resolveConfigDir().then(setConfigDir);
  }, []);

  const onExport = async () => {
    setNote(null);
    try {
      const settings = collectSettings(useWorkbenchStore.getState());
      const keybindings = await loadKeymapOverrides();
      const target = await exportSettings(settings, keybindings);
      setNote(target ? `已导出到 ${target}` : "已取消导出。");
    } catch (error) {
      setNote(`导出失败:${String(error)}`);
    }
  };

  const onImport = async () => {
    setNote(null);
    try {
      const result = await importSettings();
      if (!result) {
        setNote("已取消导入。");
        return;
      }
      applySettings(result.settings);
      setKeymapOverrides(result.keybindings);
      await saveKeymapOverrides(result.keybindings);
      setNote("已导入并应用。设置与快捷键均已更新。");
    } catch (error) {
      setNote(`导入失败:${String(error)}`);
    }
  };

  return (
    <SettingsPanel title="数据 / 同步" description="把设置与快捷键打包成一个文件,在多台设备间搬运同一套习惯。">
      <div className="flex flex-wrap gap-2 px-1 pb-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-ui text-foreground hover:bg-accent"
          onClick={() => void onExport()}
        >
          导出设置…
        </button>
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-ui text-foreground hover:bg-accent"
          onClick={() => void onImport()}
        >
          导入设置…
        </button>
      </div>
      {note ? <div className="px-1 pb-2 text-ui text-muted-foreground">{note}</div> : null}
      <SettingsList>
        <SettingsInfoRow title="配置文件" value="settings.json + keybindings.json" />
        <SettingsInfoRow title="存储位置" value={configDir ?? "浏览器本地存储"} />
      </SettingsList>
      <div className="settings-note">
        导出包含主题、编辑器与界面偏好、以及自定义快捷键。最近文件夹、搜索历史等本机状态不会被导出。
      </div>
    </SettingsPanel>
  );
}

interface GitCliDetection {
  available: boolean;
  version: string | null;
  message: string;
}

/** Git 设置:当前工作区的检测结果 + 一键检测 Git 命令(不依赖打开的文件夹)。 */
function GitSettingsPanel() {
  const gitWorkspace = useWorkbenchStore((state) => state.gitWorkspace);
  const gitInspection = gitWorkspace.kind === "ready" ? gitWorkspace.inspection : null;
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<GitCliDetection | null>(null);

  const gitCommandLabel =
    detection?.available && detection.version
      ? detection.version
      : gitWorkspace.kind === "loading"
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
    detection?.message ??
    (gitWorkspace.kind === "error"
      ? gitWorkspace.message
      : (gitInspection?.message ?? "打开文件夹后会自动检测 Git 状态。"));

  const runDetect = async () => {
    if (!isTauriRuntime()) {
      setDetection({ available: false, version: null, message: "仅桌面端可检测 Git 命令。" });
      return;
    }
    setDetecting(true);
    try {
      setDetection(await invoke<GitCliDetection>("detect_git_cli"));
    } catch (error) {
      setDetection({ available: false, version: null, message: `检测失败：${String(error)}` });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <SettingsPanel title="Git 设置" description="Git 检测以左侧当前打开的文件夹为准;也可直接检测 Git 命令是否可用。">
      <div className="flex flex-wrap gap-2 px-1 pb-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-ui text-foreground hover:bg-accent disabled:opacity-50"
          disabled={detecting}
          onClick={() => void runDetect()}
        >
          {detecting ? "检测中…" : "检测 Git 命令"}
        </button>
      </div>
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

/** 高级:只读诊断信息。 */
function AdvancedPanel() {
  return (
    <SettingsPanel title="高级选项" description="环境与内核信息,便于排查问题。">
      <SettingsList>
        <SettingsInfoRow title="编辑器内核" value="CodeMirror 6" />
        <SettingsInfoRow title="快捷键方案" value="JetBrains 兼容" />
        <SettingsInfoRow title="配置存储" value="appConfigDir / settings.json" />
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

/** 可编辑的快捷键列表:点击键位按钮录制新组合,自动解绑冲突,支持恢复默认。 */
function KeymapEditor() {
  const { actions, defaultKeysOf, setBinding, resetBinding } = useActions();
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!recordingId) return;

    // 捕获阶段拦截,避免录制的按键被全局快捷键分发器同时触发。
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecordingId(null);
        return;
      }

      const spec = eventToSpec(event);
      if (!spec) return; // 仅按下修饰键,继续等待主键

      const owner = actions.find((action) => action.id !== recordingId && (action.keys ?? []).includes(spec));
      setBinding(recordingId, spec);
      setNote(owner ? `已将「${owner.title}」原本的该键位解绑。` : null);
      setRecordingId(null);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingId, actions, setBinding]);

  return (
    <>
      {note ? <div className="px-1 pb-2 text-ui text-muted-foreground">{note}</div> : null}
      <SettingsList>
        {actions.map((action) => {
          const current = action.keys?.[0];
          const isDefault = JSON.stringify(action.keys ?? []) === JSON.stringify(defaultKeysOf(action.id));
          const recording = recordingId === action.id;

          return (
            <div className="settings-row" key={action.id}>
              <div className="settings-row-copy">
                <div className="settings-row-title">{action.title}</div>
                <div className="settings-row-description">{action.category}</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={cn(
                    "min-w-[120px] rounded border border-border px-2 py-1 text-ui",
                    recording ? "border-primary text-primary" : "text-foreground hover:bg-accent",
                  )}
                  onClick={() => {
                    setNote(null);
                    setRecordingId(action.id);
                  }}
                >
                  {recording ? "按下快捷键…" : current ? formatKey(current) : "未绑定"}
                </button>
                {!isDefault ? (
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-ui text-muted-foreground hover:bg-accent"
                    title="恢复默认"
                    onClick={() => {
                      setNote(null);
                      resetBinding(action.id);
                    }}
                  >
                    ↺
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </SettingsList>

      <div className="px-1 pb-1 pt-4 text-ui font-medium text-foreground">编辑器原语(只读)</div>
      <div className="px-1 pb-2 text-ui text-muted-foreground">
        这些是 CodeMirror 的基础编辑键,不参与改键,仅供你了解哪些键位已被占用。
      </div>
      <SettingsList>
        {EDITOR_PRIMITIVES.map((item) => (
          <SettingsInfoRow key={item.title} title={item.title} value={item.keys} />
        ))}
      </SettingsList>
    </>
  );
}

/** 分段选择行(如主题:跟随系统 / 浅色 / 深色)。 */
function SettingsSegmentedRow<T extends string>({
  description,
  onChange,
  options,
  title,
  value,
}: {
  description: string;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  title: string;
  value: T;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        <div className="settings-row-description">{description}</div>
      </div>
      <div className="flex items-center gap-1 rounded border border-border p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={cn(
              "rounded px-2 py-1 text-ui",
              option.value === value ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 数值步进行(如 Tab 宽度、字号),带 − / + 与范围夹取。 */
function SettingsStepperRow({
  description,
  max,
  min,
  onChange,
  suffix,
  title,
  value,
}: {
  description: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix?: string;
  title: string;
  value: number;
}) {
  const step = (delta: number) => onChange(clamp(value + delta, min, max));
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-row-title">{title}</div>
        <div className="settings-row-description">{description}</div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-ui text-foreground hover:bg-accent disabled:opacity-40"
          disabled={value <= min}
          onClick={() => step(-1)}
          aria-label="减小"
        >
          −
        </button>
        <span className="min-w-[44px] text-center text-ui tabular-nums text-foreground">
          {value}
          {suffix ?? ""}
        </span>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-ui text-foreground hover:bg-accent disabled:opacity-40"
          disabled={value >= max}
          onClick={() => step(1)}
          aria-label="增大"
        >
          +
        </button>
      </div>
    </div>
  );
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
