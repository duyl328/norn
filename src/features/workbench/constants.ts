import type { EditorScrollMetrics } from "./types";

export const nativeMenuEvent = "norn-menu";
export const nativeOpenFilesEvent = "norn-open-files";

// Rust 文件系统监听器上报「受影响目录」时发出的事件(见 src-tauri watch_directory)。
export const workspaceFsChangeEvent = "workspace-fs-change";

export const nativeMenuCommands = {
  find: "menu-find",
  newFile: "menu-new-file",
  openFile: "menu-open-file",
  openFolder: "menu-open-folder",
  saveFile: "menu-save-file",
  saveFileAs: "menu-save-file-as",
  showExplorer: "menu-show-explorer",
  toggleGitPanel: "menu-toggle-git-panel",
  welcome: "menu-welcome",
} as const;

// 帮助菜单里「打开外链」类项 → 目标 URL。其余帮助项（快捷键→设置、查看日志→显示配置目录、
// 关于→版本弹窗）在 workbench-page 的菜单监听里单独处理。改链接只动这里。
const repoUrl = "https://github.com/duyl328/norn";
export const helpMenuUrls: Record<string, string> = {
  "menu-documentation": `${repoUrl}#readme`,
  "menu-release-notes": `${repoUrl}/releases`,
  "menu-report-issue": `${repoUrl}/issues/new`,
  "menu-community": `${repoUrl}/discussions`,
  "menu-privacy-statement": `${repoUrl}#readme`,
};

export const EDITOR_SCROLLBAR_SIZE = 18;
export const EDITOR_MIN_THUMB_SIZE = 44;
export const LARGE_FILE_CONFIRM_BYTES = 5 * 1024 * 1024;
export const LARGE_FILE_READONLY_BYTES = 25 * 1024 * 1024;
export const SUPER_LARGE_FILE_BYTES = 100 * 1024 * 1024;
export const LARGE_FILE_CHUNK_BYTES = 512 * 1024;
export const leftPanelMinWidth = 220;
export const leftPanelMaxWidth = 380;
export const leftPanelDefaultWidth = 260;
export const rightPanelMinWidth = 340;
export const rightPanelMaxWidth = 520;
export const rightPanelDefaultWidth = 360;
export const settingsSidebarMinWidth = 240;
export const settingsSidebarMaxWidth = 360;
export const settingsSidebarDefaultWidth = 280;
export const scratchPanelMinHeight = 92;
export const scratchPanelDefaultHeight = 180;
export const scratchPanelMaxHeightRatio = 0.6;
export const scratchPanelFocusThreshold = 150;

export const emptyEditorScrollMetrics: EditorScrollMetrics = {
  clientHeight: 0,
  clientWidth: 0,
  gutterWidth: 52,
  scrollHeight: 0,
  scrollLeft: 0,
  scrollTop: 0,
  scrollWidth: 0,
  shellHeight: 0,
  shellWidth: 0,
};

/**
 * Windows 标题栏菜单项。三类:
 * - `actionId`:走 action 系统分发,label/快捷键从注册表取(传 label 仅作兜底)。
 * - `window`:窗口控制(最小化/最大化/关闭),由 titlebar 直接操作原生窗口。
 * - 仅 label:占位/待接入项,点击关闭菜单不做事。
 */
export type WindowsMenuItem = {
  label: string;
  actionId?: string;
  window?: "minimize" | "maximize" | "close";
};

export const windowsTitlebarMenus: ReadonlyArray<{
  id: string;
  label: string;
  children: ReadonlyArray<WindowsMenuItem>;
}> = [
  {
    id: "file",
    label: "File",
    children: [
      { label: "New File", actionId: "file.new" },
      { label: "Open File…", actionId: "file.open" },
      { label: "Open Folder…", actionId: "file.openFolder" },
      { label: "Save", actionId: "file.save" },
      { label: "Save As…", actionId: "file.saveAs" },
    ],
  },
  {
    id: "view",
    label: "View",
    children: [
      { label: "Explorer", actionId: "view.toggleExplorer" },
      { label: "Git Panel", actionId: "view.toggleGit" },
      { label: "Find Action…", actionId: "navigate.commandPalette" },
      { label: "Go to File…", actionId: "navigate.goToFile" },
      { label: "Settings", actionId: "view.settings" },
    ],
  },
  {
    id: "window",
    label: "Window",
    children: [
      { label: "Minimize", window: "minimize" },
      { label: "Maximize / Restore", window: "maximize" },
      { label: "Close", window: "close" },
    ],
  },
  {
    id: "help",
    label: "Help",
    children: [
      { label: "Welcome", actionId: "help.welcome" },
      { label: "Documentation" },
      { label: "Keyboard Shortcuts", actionId: "view.settings" },
      { label: "About Norn" },
    ],
  },
] as const;

export type WindowsTitlebarMenuId = (typeof windowsTitlebarMenus)[number]["id"];

export const recentProjects = [
  { name: "norn", path: "D:/yuanll/code/norn" },
  { name: "NornWorkbench", path: "D:/yuanll/code/NornWorkbench" },
  { name: "robotSDK", path: "D:/yuanll/code/robotSDK" },
  { name: "QAIStudio", path: "D:/yuanll/code/QAIStudio" },
] as const;

export const recentFoldersStorageKey = "norn.recentFolders";
export const quickSearchHistoryStorageKey = "norn.quickSearchHistory";
export const editorSearchHistoryStorageKey = "norn.editorSearchHistory";
export const resizeHandleHintsStorageKey = "norn.resizeHandleHints";
export const keymapOverridesStorageKey = "norn.keymapOverrides";
export const editorLineWrappingStorageKey = "norn.editorLineWrapping";
export const maxRecentFolders = 8;
export const maxQuickSearchHistory = 10;
export const maxEditorSearchHistory = 10;

export const projectColorPairs = [
  { background: "#2563eb", foreground: "#eff6ff" },
  { background: "#0f766e", foreground: "#f0fdfa" },
  { background: "#7c3aed", foreground: "#f5f3ff" },
  { background: "#be123c", foreground: "#fff1f2" },
  { background: "#047857", foreground: "#ecfdf5" },
  { background: "#a16207", foreground: "#fefce8" },
  { background: "#4338ca", foreground: "#eef2ff" },
  { background: "#c2410c", foreground: "#fff7ed" },
];
