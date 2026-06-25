import type { EditorScrollMetrics } from "./types";

export const nativeMenuEvent = "norn-menu";

export const nativeMenuCommands = {
  find: "menu-find",
  newFile: "menu-new-file",
  openFile: "menu-open-file",
  openFolder: "menu-open-folder",
  saveFile: "menu-save-file",
  saveFileAs: "menu-save-file-as",
  showExplorer: "menu-show-explorer",
  toggleGitPanel: "menu-toggle-git-panel",
} as const;

export const EDITOR_SCROLLBAR_SIZE = 18;
export const EDITOR_MIN_THUMB_SIZE = 44;
export const LARGE_FILE_CONFIRM_BYTES = 5 * 1024 * 1024;
export const LARGE_FILE_READONLY_BYTES = 25 * 1024 * 1024;
export const SUPER_LARGE_FILE_BYTES = 100 * 1024 * 1024;
export const LARGE_FILE_CHUNK_BYTES = 512 * 1024;
export const leftPanelMinWidth = 220;
export const leftPanelMaxWidth = 380;
export const leftPanelDefaultWidth = 260;
export const rightPanelMinWidth = 300;
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

export const windowsTitlebarMenus = [
  { id: "file", label: "File", children: ["New File", "Open File", "Open Folder", "Save", "Save As"] },
  { id: "edit", label: "Edit", children: ["Undo", "Redo", "Find"] },
  { id: "view", label: "View", children: ["Explorer", "Git Panel", "Terminal"] },
  { id: "window", label: "Window", children: ["Minimize", "Maximize / Restore", "Close"] },
  {
    id: "help",
    label: "Help",
    children: [
      "Welcome",
      "Documentation",
      "Keyboard Shortcuts",
      "Release Notes",
      "Report Issue",
      "View Logs",
      "Check for Updates",
      "Community",
      "Privacy Statement",
      "About Norn",
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
export const resizeHandleHintsStorageKey = "norn.resizeHandleHints";
export const editorLineWrappingStorageKey = "norn.editorLineWrapping";
export const maxRecentFolders = 8;

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
