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
import { type TranslationKey, useI18n } from "../i18n";
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
  titleKey: TranslationKey;
  items: Array<{ id: SettingsTabId; icon: typeof Settings; labelKey: TranslationKey }>;
}> = [
  {
    titleKey: "settings.group.basic",
    items: [
      { id: "general", icon: Gauge, labelKey: "settings.tab.general" },
      { id: "appearance", icon: Palette, labelKey: "settings.tab.appearance" },
      { id: "shortcuts", icon: Keyboard, labelKey: "settings.tab.shortcuts" },
    ],
  },
  {
    titleKey: "settings.group.security",
    items: [
      { id: "permissions", icon: ShieldCheck, labelKey: "settings.tab.permissions" },
      { id: "git", icon: GitBranch, labelKey: "settings.tab.git" },
    ],
  },
  {
    titleKey: "settings.group.other",
    items: [
      { id: "data", icon: Database, labelKey: "settings.tab.data" },
      { id: "advanced", icon: MonitorCog, labelKey: "settings.tab.advanced" },
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
  const { t } = useI18n();
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
            {t("settings.back")}
          </button>
          <div className="settings-search">
            <Search className="h-4 w-4" />
            <span>{t("settings.search")}</span>
          </div>
          <nav className="settings-nav" aria-label={t("settings.navLabel")}>
            {settingsGroups.map((group) => (
              <div className="settings-nav-group" key={group.titleKey}>
                <div className="settings-nav-heading">{t(group.titleKey)}</div>
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
                      <span>{t(item.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
        <div
          aria-label={t("settings.resizeSidebar")}
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
  const { t } = useI18n();

  if (activeTab === "permissions") {
    return (
      <SettingsPanel title={t("settings.tab.permissions")} description={t("settings.permissions.description")}>
        <SettingsList>
          <SettingsListRow
            title={t("settings.permissions.workspace.title")}
            description={t("settings.permissions.workspace.description")}
            enabled
          />
          <SettingsListRow
            title={t("settings.permissions.git.title")}
            description={t("settings.permissions.git.description")}
            enabled
          />
          <SettingsListRow
            title={t("settings.permissions.crossDirectory.title")}
            description={t("settings.permissions.crossDirectory.description")}
          />
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
        title={t("settings.tab.shortcuts")}
        description={t("settings.shortcuts.description")}
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
  const { language, setLanguage, t } = useI18n();
  const tabSize = useWorkbenchStore((state) => state.editorTabSize);
  const setTabSize = useWorkbenchStore((state) => state.setEditorTabSize);
  const formatOnSave = useWorkbenchStore((state) => state.editorFormatOnSave);
  const setFormatOnSave = useWorkbenchStore((state) => state.setEditorFormatOnSave);
  const restoreLastWorkspace = useWorkbenchStore((state) => state.restoreLastWorkspace);
  const setRestoreLastWorkspace = useWorkbenchStore((state) => state.setRestoreLastWorkspace);
  const showStatusBar = useWorkbenchStore((state) => state.showStatusBar);
  const setShowStatusBar = useWorkbenchStore((state) => state.setShowStatusBar);

  return (
    <SettingsPanel title={t("settings.tab.general")} description={t("settings.general.description")}>
      <SettingsList>
        <SettingsSegmentedRow<"zh" | "en">
          title={t("settings.general.language.title")}
          description={t("settings.general.language.description")}
          value={language}
          options={[
            { value: "zh", label: t("settings.general.language.zh") },
            { value: "en", label: t("settings.general.language.en") },
          ]}
          onChange={setLanguage}
        />
        <SettingsStepperRow
          title={t("settings.general.tabSize.title")}
          description={t("settings.general.tabSize.description")}
          value={tabSize}
          min={TAB_SIZE_MIN}
          max={TAB_SIZE_MAX}
          onChange={setTabSize}
        />
        <SettingsListRow
          title={t("settings.general.formatOnSave.title")}
          description={t("settings.general.formatOnSave.description")}
          enabled={formatOnSave}
          onClick={() => setFormatOnSave(!formatOnSave)}
        />
        <SettingsListRow
          title={t("settings.general.restoreWorkspace.title")}
          description={t("settings.general.restoreWorkspace.description")}
          enabled={restoreLastWorkspace}
          onClick={() => setRestoreLastWorkspace(!restoreLastWorkspace)}
        />
        <SettingsListRow
          title={t("settings.general.statusBar.title")}
          description={t("settings.general.statusBar.description")}
          enabled={showStatusBar}
          onClick={() => setShowStatusBar(!showStatusBar)}
        />
      </SettingsList>
    </SettingsPanel>
  );
}

/** 外观:主题、字号与面板显示。 */
function AppearancePanel() {
  const { t } = useI18n();
  const theme = useWorkbenchStore((state) => state.theme);
  const setTheme = useWorkbenchStore((state) => state.setTheme);
  const fontSize = useWorkbenchStore((state) => state.editorFontSize);
  const setFontSize = useWorkbenchStore((state) => state.setEditorFontSize);
  const lineWrapping = useWorkbenchStore((state) => state.editorLineWrapping);
  const setLineWrapping = useWorkbenchStore((state) => state.setEditorLineWrapping);
  const resizeHandleHints = useWorkbenchStore((state) => state.resizeHandleHintsVisible);
  const setResizeHandleHints = useWorkbenchStore((state) => state.setResizeHandleHintsVisible);

  return (
    <SettingsPanel title={t("settings.tab.appearance")} description={t("settings.appearance.description")}>
      <SettingsList>
        <SettingsSegmentedRow
          title={t("settings.appearance.theme.title")}
          description={t("settings.appearance.theme.description")}
          value={theme}
          options={[
            { value: "system", label: t("settings.appearance.theme.system") },
            { value: "light", label: t("settings.appearance.theme.light") },
            { value: "dark", label: t("settings.appearance.theme.dark") },
          ]}
          onChange={setTheme}
        />
        <SettingsStepperRow
          title={t("settings.appearance.fontSize.title")}
          description={t("settings.appearance.fontSize.description")}
          value={fontSize}
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          onChange={setFontSize}
        />
        <SettingsListRow
          title={t("settings.appearance.lineWrapping.title")}
          description={t("settings.appearance.lineWrapping.description")}
          enabled={lineWrapping}
          onClick={() => setLineWrapping(!lineWrapping)}
        />
        <SettingsListRow
          title={t("settings.appearance.resizeHints.title")}
          description={t("settings.appearance.resizeHints.description")}
          enabled={resizeHandleHints}
          onClick={() => setResizeHandleHints(!resizeHandleHints)}
        />
      </SettingsList>
    </SettingsPanel>
  );
}

/** 数据 / 同步:导入导出一整套习惯,跨设备搬运。 */
function DataPanel() {
  const { t } = useI18n();
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
      setNote(target ? t("settings.data.exported", { target }) : t("settings.data.exportCanceled"));
    } catch (error) {
      setNote(t("settings.data.exportFailed", { error: String(error) }));
    }
  };

  const onImport = async () => {
    setNote(null);
    try {
      const result = await importSettings();
      if (!result) {
        setNote(t("settings.data.importCanceled"));
        return;
      }
      applySettings(result.settings);
      setKeymapOverrides(result.keybindings);
      await saveKeymapOverrides(result.keybindings);
      setNote(t("settings.data.imported"));
    } catch (error) {
      setNote(t("settings.data.importFailed", { error: String(error) }));
    }
  };

  return (
    <SettingsPanel title={t("settings.tab.data")} description={t("settings.data.description")}>
      <div className="flex flex-wrap gap-2 px-1 pb-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-ui text-foreground hover:bg-accent"
          onClick={() => void onExport()}
        >
          {t("settings.data.export")}
        </button>
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-ui text-foreground hover:bg-accent"
          onClick={() => void onImport()}
        >
          {t("settings.data.import")}
        </button>
      </div>
      {note ? <div className="px-1 pb-2 text-ui text-muted-foreground">{note}</div> : null}
      <SettingsList>
        <SettingsInfoRow title={t("settings.data.configFile")} value="settings.json + keybindings.json" />
        <SettingsInfoRow title={t("settings.data.storageLocation")} value={configDir ?? t("settings.data.browserLocalStorage")} />
      </SettingsList>
      <div className="settings-note">{t("settings.data.note")}</div>
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
  const { t } = useI18n();
  const gitWorkspace = useWorkbenchStore((state) => state.gitWorkspace);
  const gitInspection = gitWorkspace.kind === "ready" ? gitWorkspace.inspection : null;
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<GitCliDetection | null>(null);

  const gitCommandLabel =
    detection?.available && detection.version
      ? detection.version
      : gitWorkspace.kind === "loading"
        ? t("settings.git.detecting")
        : gitInspection?.gitAvailable
          ? (gitInspection.gitVersion ?? t("settings.git.available"))
          : gitWorkspace.kind === "ready"
            ? t("settings.git.unavailable")
            : t("settings.git.notDetected");
  const repositoryLabel =
    gitWorkspace.kind === "loading"
      ? t("settings.git.detecting")
      : gitInspection?.isRepository
        ? t("settings.git.repoDetected")
        : gitInspection
          ? t("settings.git.notRepo")
          : t("settings.git.openFolderFirst");
  const gitRootLabel = gitInspection?.gitRoot ?? t("settings.git.none");
  const dotGitLabel = gitInspection
    ? gitInspection.hasDotGit
      ? t("settings.git.dotGitExists")
      : t("settings.git.dotGitMissing")
    : t("settings.git.notDetected");
  const branchLabel = gitInspection?.branch ?? t("settings.git.none");
  const messageLabel =
    detection?.message ??
    (gitWorkspace.kind === "error"
      ? gitWorkspace.message
      : (gitInspection?.message ?? t("settings.git.autoDetectNote")));

  const runDetect = async () => {
    if (!isTauriRuntime()) {
      setDetection({ available: false, version: null, message: t("settings.git.desktopOnly") });
      return;
    }
    setDetecting(true);
    try {
      setDetection(await invoke<GitCliDetection>("detect_git_cli"));
    } catch (error) {
      setDetection({ available: false, version: null, message: t("settings.git.detectFailed", { error: String(error) }) });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <SettingsPanel title={t("settings.tab.git")} description={t("settings.git.description")}>
      <div className="flex flex-wrap gap-2 px-1 pb-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-ui text-foreground hover:bg-accent disabled:opacity-50"
          disabled={detecting}
          onClick={() => void runDetect()}
        >
          {detecting ? `${t("settings.git.detecting")}…` : t("settings.git.detectCommand")}
        </button>
      </div>
      <SettingsList>
        <SettingsInfoRow title={t("settings.git.command")} value={gitCommandLabel} />
        <SettingsInfoRow title={t("settings.git.repositoryStatus")} value={repositoryLabel} />
        <SettingsInfoRow title={t("settings.git.dotGit")} value={dotGitLabel} />
        <SettingsInfoRow title={t("settings.git.root")} value={gitRootLabel} />
        <SettingsInfoRow title={t("settings.git.currentBranch")} value={branchLabel} />
      </SettingsList>
      <div className="settings-note">{messageLabel}</div>
    </SettingsPanel>
  );
}

/** 高级:只读诊断信息。 */
function AdvancedPanel() {
  const { t } = useI18n();

  return (
    <SettingsPanel title={t("settings.tab.advanced")} description={t("settings.advanced.description")}>
      <SettingsList>
        <SettingsInfoRow title={t("settings.advanced.editorCore")} value="CodeMirror 6" />
        <SettingsInfoRow title={t("settings.advanced.keymap")} value="JetBrains" />
        <SettingsInfoRow title={t("settings.advanced.configStorage")} value="appConfigDir / settings.json" />
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
  const { t } = useI18n();
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
      setNote(owner ? t("settings.shortcuts.conflictUnbound", { title: owner.title }) : null);
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
                  {recording ? t("settings.shortcuts.pressShortcut") : current ? formatKey(current) : t("settings.shortcuts.unbound")}
                </button>
                {!isDefault ? (
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-ui text-muted-foreground hover:bg-accent"
                    title={t("settings.shortcuts.resetDefault")}
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

      <div className="px-1 pb-1 pt-4 text-ui font-medium text-foreground">{t("settings.shortcuts.primitivesTitle")}</div>
      <div className="px-1 pb-2 text-ui text-muted-foreground">{t("settings.shortcuts.primitivesDescription")}</div>
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
  const { t } = useI18n();
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
          aria-label={t("settings.stepper.decrease")}
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
          aria-label={t("settings.stepper.increase")}
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
