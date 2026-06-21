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
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, StateEffect, type Extension } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  Braces,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Database,
  FileArchive,
  FileCode,
  FileCog,
  FileJson,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  Image,
  Menu,
  Minus,
  Square,
  X,
  GitBranch,
  GitPullRequest,
  PanelLeft,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Terminal,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Input } from "@/components/ui/input";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES,
  createSmartOverlayExtension,
  loadHighlightExtensions,
  resolveHighlightMode,
} from "./editor-highlighting";
import { changes, editorLines } from "./mock-data";

type ProjectAccentStyle = {
  "--project-color": string;
  "--project-color-foreground": string;
};

type RecentFolder = {
  name: string;
  path: string;
};

type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

const isTauriRuntime = () => Boolean((window as TauriRuntimeWindow).__TAURI_INTERNALS__);

const createDocumentId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

const nativeMenuEvent = "norn-menu";

const nativeMenuCommands = {
  find: "menu-find",
  newFile: "menu-new-file",
  openFile: "menu-open-file",
  openFolder: "menu-open-folder",
  saveFile: "menu-save-file",
  saveFileAs: "menu-save-file-as",
  showExplorer: "menu-show-explorer",
  toggleGitPanel: "menu-toggle-git-panel",
} as const;

type NativeTextFile = {
  name: string;
  path: string;
  content: string;
  size: number;
  lastModified?: number | null;
};

type NativeTextFileInspection = {
  name: string;
  path: string;
  size: number;
  lastModified?: number | null;
  isBinary: boolean;
  isUtf8: boolean;
  sample: string;
};

type NativeTextFileRange = {
  path: string;
  content: string;
  size: number;
  requestedOffset: number;
  startOffset: number;
  endOffset: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};

type NativeSavedTextFile = {
  name: string;
  path: string;
  size: number;
  lastModified?: number | null;
};

type NativeSaveErrorKind = "deleted" | "invalid-path" | "io" | "modified" | "permission";

type NativeSaveError = {
  kind?: NativeSaveErrorKind;
  message?: string;
};

type NativeDirectoryEntry = {
  name: string;
  path: string;
  relativePath: string;
  kind: "file" | "directory";
  size?: number | null;
  lastModified?: number | null;
};

type FolderView = {
  rootPath: string;
  rootName: string;
  origin: "open-folder" | "containing-folder";
  nodes: FileTreeNode[];
  loadingPath: string | null;
  error: string | null;
};

type ScratchView = {
  error: string | null;
  loadingPath: string | null;
  loading: boolean;
  nodes: FileTreeNode[];
  rootPath: string;
};

type FileTreeNode = {
  name: string;
  path: string;
  relativePath: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
  children?: FileTreeNode[];
  childrenLoaded?: boolean;
  expanded?: boolean;
  error?: string;
};

type PendingFileOpen =
  | { kind: "file-dialog" }
  | { kind: "path"; clearFolderView?: boolean; path: string; size?: number };

type EditorScrollMetrics = {
  clientHeight: number;
  clientWidth: number;
  gutterWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  shellHeight: number;
  shellWidth: number;
};

type EditorScrollbarOrientation = "horizontal" | "vertical";

type EditorScrollbarGeometry = {
  maxScroll: number;
  scrollPosition: number;
  thumbOffset: number;
  thumbSize: number;
  trackSize: number;
};

type SaveState = "idle" | "saving" | "saved" | "error";

type SaveConflict = {
  content: string;
  lastModified?: number;
  message: string;
  path: string;
};

const EDITOR_SCROLLBAR_SIZE = 18;
const EDITOR_MIN_THUMB_SIZE = 44;
const LARGE_FILE_CONFIRM_BYTES = 5 * 1024 * 1024;
const LARGE_FILE_READONLY_BYTES = 25 * 1024 * 1024;
const SUPER_LARGE_FILE_BYTES = 100 * 1024 * 1024;
const LARGE_FILE_CHUNK_BYTES = 512 * 1024;
const leftPanelMinWidth = 220;
const leftPanelMaxWidth = 380;
const leftPanelDefaultWidth = 260;
const rightPanelMinWidth = 300;
const rightPanelMaxWidth = 520;
const rightPanelDefaultWidth = 360;
const scratchPanelMinHeight = 92;
const scratchPanelDefaultHeight = 180;
const scratchPanelMaxHeightRatio = 0.6;
const scratchPanelFocusThreshold = 150;

const emptyEditorScrollMetrics: EditorScrollMetrics = {
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getPathName = (path: string) => {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const name = normalizedPath.split("/").filter(Boolean).pop();

  return name || path;
};

const getCompactPath = (path: string, visibleSegments = 4) => {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalizedPath.split("/").filter(Boolean);

  if (segments.length <= visibleSegments) {
    return normalizedPath || path;
  }

  return `.../${segments.slice(-visibleSegments).join("/")}`;
};

const getTailPath = (path: string, maxLength: number) => {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");

  if (normalizedPath.length <= maxLength) {
    return normalizedPath || path;
  }

  const prefix = ".../";
  const tailLength = Math.max(8, maxLength - prefix.length);

  return `${prefix}${normalizedPath.slice(-tailLength).replace(/^[/\\]+/, "")}`;
};

const getFileExtension = (name: string) => {
  const normalizedName = name.toLowerCase();
  const extensionIndex = normalizedName.lastIndexOf(".");

  if (extensionIndex <= 0 || extensionIndex === normalizedName.length - 1) {
    return "";
  }

  return normalizedName.slice(extensionIndex + 1);
};

const getFileTreeIcon = (node: FileTreeNode) => {
  if (node.kind === "directory") {
    return {
      className: "tree-row-icon-directory",
      Icon: node.expanded ? FolderOpen : Folder,
    };
  }

  const extension = getFileExtension(node.name);

  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "cs", "swift"].includes(extension)) {
    return { className: "tree-row-icon-code", Icon: FileCode };
  }

  if (["json", "jsonc"].includes(extension)) {
    return { className: "tree-row-icon-json", Icon: FileJson };
  }

  if (["css", "scss", "less", "html", "xml", "md", "mdx"].includes(extension)) {
    return { className: "tree-row-icon-markup", Icon: FileType };
  }

  if (["toml", "yaml", "yml", "env", "ini", "conf", "config", "lock"].includes(extension)) {
    return { className: "tree-row-icon-config", Icon: FileCog };
  }

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) {
    return { className: "tree-row-icon-image", Icon: Image };
  }

  if (["zip", "tar", "gz", "rar", "7z"].includes(extension)) {
    return { className: "tree-row-icon-archive", Icon: FileArchive };
  }

  if (["csv", "xls", "xlsx"].includes(extension)) {
    return { className: "tree-row-icon-sheet", Icon: FileSpreadsheet };
  }

  if (["sql", "sqlite", "db"].includes(extension)) {
    return { className: "tree-row-icon-data", Icon: Database };
  }

  if (["sh", "bash", "zsh", "ps1", "bat"].includes(extension)) {
    return { className: "tree-row-icon-terminal", Icon: FileTerminal };
  }

  if (["vue", "svelte"].includes(extension)) {
    return { className: "tree-row-icon-component", Icon: Braces };
  }

  return { className: "tree-row-icon-file", Icon: FileText };
};

const getParentPath = (path: string) => {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

  if (separatorIndex < 0) {
    return null;
  }

  if (separatorIndex === 0) {
    return "/";
  }

  if (/^[a-zA-Z]:[\\/]/.test(path) && separatorIndex === 2) {
    return path.slice(0, 3);
  }

  return path.slice(0, separatorIndex);
};

const replacePathName = (path: string, name: string) => {
  const parentPath = getParentPath(path);

  if (!parentPath) {
    return name;
  }

  if (parentPath === "/" || /[\\/]$/.test(parentPath)) {
    return `${parentPath}${name}`;
  }

  const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";

  return `${parentPath}${separator}${name}`;
};

const isAbsolutePath = (path: string) => path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path);

const getFileOpenId = (path: string, lastModified?: number | null) => `${path}-${lastModified ?? Date.now()}`;

const formatFileSize = (size?: number) => {
  if (typeof size !== "number") {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getNativeSaveError = (error: unknown): NativeSaveError => {
  if (error && typeof error === "object") {
    return error as NativeSaveError;
  }

  return { kind: "io", message: error instanceof Error ? error.message : String(error) };
};

const toFileTreeNode = (entry: NativeDirectoryEntry): FileTreeNode => ({
  name: entry.name,
  path: entry.path,
  relativePath: entry.relativePath,
  kind: entry.kind,
  size: entry.size ?? undefined,
  lastModified: entry.lastModified ?? undefined,
  children: entry.kind === "directory" ? [] : undefined,
  childrenLoaded: false,
  expanded: false,
});

const createDirectoryRootNode = (path: string, children: FileTreeNode[] = [], expanded = true): FileTreeNode => ({
  name: getPathName(path),
  path,
  relativePath: "",
  kind: "directory",
  children,
  childrenLoaded: true,
  expanded,
});

const updateTreeNode = (
  nodes: FileTreeNode[],
  path: string,
  update: (node: FileTreeNode) => FileTreeNode,
): FileTreeNode[] =>
  nodes.map((node) => {
    if (node.path === path) {
      return update(node);
    }

    if (node.children) {
      return { ...node, children: updateTreeNode(node.children, path, update) };
    }

    return node;
  });

const getEditorScrollbarGeometry = (
  orientation: EditorScrollbarOrientation,
  metrics: EditorScrollMetrics,
): EditorScrollbarGeometry | null => {
  const maxHorizontalScroll = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  const maxVerticalScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const hasHorizontalScrollbar = maxHorizontalScroll > 1;
  const hasVerticalScrollbar = maxVerticalScroll > 1;

  if (orientation === "horizontal" && !hasHorizontalScrollbar) {
    return null;
  }

  if (orientation === "vertical" && !hasVerticalScrollbar) {
    return null;
  }

  const trackSize =
    orientation === "horizontal"
      ? Math.max(0, metrics.shellWidth - metrics.gutterWidth - (hasVerticalScrollbar ? EDITOR_SCROLLBAR_SIZE : 0))
      : Math.max(0, metrics.shellHeight);
  const maxScroll = orientation === "horizontal" ? maxHorizontalScroll : maxVerticalScroll;

  if (trackSize <= 0 || maxScroll <= 0) {
    return null;
  }

  const totalSize = trackSize + maxScroll;
  const thumbSize = Math.min(trackSize, Math.max(EDITOR_MIN_THUMB_SIZE, (trackSize / totalSize) * trackSize));
  const scrollPosition = orientation === "horizontal" ? metrics.scrollLeft : metrics.scrollTop;
  const thumbOffset = (clamp(scrollPosition, 0, maxScroll) / maxScroll) * Math.max(0, trackSize - thumbSize);

  return {
    maxScroll,
    scrollPosition,
    thumbOffset,
    thumbSize,
    trackSize,
  };
};

const windowsTitlebarMenus = [
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

type WindowsTitlebarMenuId = (typeof windowsTitlebarMenus)[number]["id"];

type WorkbenchDocument = {
  id: string;
  name: string;
  path: string;
  content: string;
  savedContent: string;
  size?: number;
  lastModified?: number;
  isUntitled?: boolean;
  mode?: "editable" | "large-readonly";
  range?: {
    endOffset: number;
    hasMoreAfter: boolean;
    hasMoreBefore: boolean;
    startOffset: number;
  };
};

type EditorTabPreview = {
  accent: string;
  borderAccent: string;
  id: string;
  name: string;
  path: string;
  dirty?: boolean;
};

type EditorTabLayout = {
  coveredLeft: number;
  coveredRight: number;
  hideLeft: number;
  hideRight: number;
  side: "left" | "normal" | "right";
  stickyLeft: number;
  stickyRight: number;
  zIndex: number;
};

type EditorTabPosition = {
  left: number;
  naturalLeft: number;
  side: EditorTabLayout["side"];
  stickyLeft: number;
  stickyRight: number;
  width: number;
};

const initialDocument: WorkbenchDocument = {
  id: "mock-workbench-page",
  name: "workbench-page.tsx",
  path: "src/features/workbench/workbench-page.tsx",
  content: editorLines.join("\n"),
  savedContent: editorLines.join("\n"),
  mode: "editable",
};

const editorTabPreviewNames = [
  "workbench-page.tsx",
  "settings.json",
  "runtime.log",
  "app.config.toml",
  "README.md",
  "very-long-file-name-for-overflow-testing.yaml",
  "main.rs",
  "docker-compose.yml",
  ".env.local",
  "query.sql",
  "notes.txt",
  "index.html",
];

const getDocumentLines = (document: WorkbenchDocument) => {
  const lines = document.content.split(/\r\n|\n|\r/);
  return lines.length > 0 ? lines : [""];
};

const codeMirrorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "hsl(var(--editor-background))",
    color: "hsl(var(--foreground))",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "12px calc(var(--editor-scrollbar-size) + 8px) calc(var(--editor-scrollbar-size) + 18px) 0",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--editor-gutter))",
    borderRight: "1px solid hsl(var(--border))",
    color: "hsl(var(--muted-foreground))",
    paddingBottom: "calc(var(--editor-scrollbar-size) + 12px)",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--accent) / 0.32)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--accent) / 0.48)",
    color: "hsl(var(--foreground))",
  },
  ".cm-cursor": {
    borderLeftColor: "hsl(var(--primary))",
  },
});

const createCodeMirrorExtensions = (
  languageCompartment: Compartment,
  document: WorkbenchDocument,
  onChange: (content: string) => void,
): Extension[] => [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  indentOnInput(),
  bracketMatching(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  highlightActiveLine(),
  keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
  languageCompartment.of([]),
  ...createSmartOverlayExtension(document.content.length),
  EditorView.editable.of(document.mode !== "large-readonly"),
  EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  }),
  codeMirrorTheme,
];

const recentProjects = [
  { name: "norn", path: "D:/yuanll/code/norn" },
  { name: "NornWorkbench", path: "D:/yuanll/code/NornWorkbench" },
  { name: "robotSDK", path: "D:/yuanll/code/robotSDK" },
  { name: "QAIStudio", path: "D:/yuanll/code/QAIStudio" },
] as const;

const recentFoldersStorageKey = "norn.recentFolders";
const maxRecentFolders = 8;

const loadRecentFolders = (): RecentFolder[] => {
  try {
    const value = window.localStorage.getItem(recentFoldersStorageKey);

    if (!value) {
      return [];
    }

    const folders = JSON.parse(value);

    if (!Array.isArray(folders)) {
      return [];
    }

    return folders
      .filter((folder): folder is RecentFolder => Boolean(folder?.path && folder?.name))
      .slice(0, maxRecentFolders);
  } catch {
    return [];
  }
};

const saveRecentFolders = (folders: RecentFolder[]) => {
  window.localStorage.setItem(recentFoldersStorageKey, JSON.stringify(folders.slice(0, maxRecentFolders)));
};

const getProjectInitials = (name: string) => {
  const explicitWords = name.split(/[\s._-]+/).filter(Boolean);
  const camelParts = name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const words = explicitWords.length > 1 ? explicitWords : camelParts;

  const initials = words
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (initials || name.slice(0, 2)).toUpperCase();
};

const projectColorPairs = [
  { background: "#2563eb", foreground: "#eff6ff" },
  { background: "#0f766e", foreground: "#f0fdfa" },
  { background: "#7c3aed", foreground: "#f5f3ff" },
  { background: "#be123c", foreground: "#fff1f2" },
  { background: "#047857", foreground: "#ecfdf5" },
  { background: "#a16207", foreground: "#fefce8" },
  { background: "#4338ca", foreground: "#eef2ff" },
  { background: "#c2410c", foreground: "#fff7ed" },
];

const getProjectAccentStyle = (name: string): ProjectAccentStyle => {
  const hash = Array.from(name).reduce((value, character) => value + character.charCodeAt(0), 0);
  const pair = projectColorPairs[hash % projectColorPairs.length];

  return {
    "--project-color": pair.background,
    "--project-color-foreground": pair.foreground,
  };
};

const getTabAccent = (id: string) => {
  const hash = Array.from(id).reduce((value, character) => value + character.charCodeAt(0), 0);

  return projectColorPairs[hash % projectColorPairs.length].background;
};

const getTabBorderAccent = (name: string, fallback: string) => {
  const extension = getFileExtension(name);

  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "cs", "swift"].includes(extension)) {
    return "#2563eb";
  }

  if (["json", "jsonc", "sql", "sqlite", "db"].includes(extension)) {
    return "#7c3aed";
  }

  if (["css", "scss", "less", "html", "xml", "md", "mdx"].includes(extension)) {
    return "#0f766e";
  }

  if (["toml", "yaml", "yml", "env", "ini", "conf", "config", "lock"].includes(extension)) {
    return "#64748b";
  }

  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(extension)) {
    return "#c2410c";
  }

  if (["csv", "xls", "xlsx"].includes(extension)) {
    return "#047857";
  }

  if (["zip", "tar", "gz", "rar", "7z"].includes(extension)) {
    return "#a16207";
  }

  if (["sh", "bash", "zsh", "ps1", "bat"].includes(extension)) {
    return "#475569";
  }

  return fallback;
};

export function WorkbenchPage() {
  const [document, setDocument] = useState<WorkbenchDocument>(initialDocument);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(leftPanelDefaultWidth);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(rightPanelDefaultWidth);
  const [resizingPanel, setResizingPanel] = useState<"left" | "right" | null>(null);
  const [scratchPanelHeight, setScratchPanelHeight] = useState(scratchPanelDefaultHeight);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [folderView, setFolderView] = useState<FolderView | null>(null);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>(() => loadRecentFolders());
  const [pendingFileOpen, setPendingFileOpen] = useState<PendingFileOpen | null>(null);
  const [scratchView, setScratchView] = useState<ScratchView | null>(null);
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [searchOpen, setSearchOpen] = useState(false);
  const showWindowsTitlebar = useMemo(() => navigator.userAgent.includes("Windows") && isTauriRuntime(), []);
  const showMacTitlebar = useMemo(() => navigator.userAgent.includes("Mac") && isTauriRuntime(), []);
  const isDirty = document.content !== document.savedContent;

  const createFile = () => {
    const nextDocument: WorkbenchDocument = {
      id: createDocumentId("untitled"),
      name: "Untitled.txt",
      path: "Untitled.txt",
      content: "",
      savedContent: "",
      isUntitled: true,
      mode: "editable",
    };

    setFileError(null);
    setLeftPanelOpen(false);
    setFolderView(null);
    setSaveConflict(null);
    setSaveState("idle");
    setDocument(nextDocument);

    return nextDocument;
  };

  const applySavedDocument = (savedFile: NativeSavedTextFile, content: string) => {
    setDocument((currentDocument) => ({
      ...currentDocument,
      id: getFileOpenId(savedFile.path, savedFile.lastModified),
      name: savedFile.name,
      path: savedFile.path,
      content,
      savedContent: content,
      size: savedFile.size,
      lastModified: savedFile.lastModified ?? undefined,
      isUntitled: false,
      mode: "editable",
      range: undefined,
    }));
    setSaveConflict(null);
    setSaveState("saved");
    setFileError(null);
  };

  const saveDocumentAs = async (contentOverride?: string) => {
    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError("Large files are opened in read-only browsing mode and cannot be saved yet.");
      return;
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError("Native saving is only available in the Tauri desktop app.");
      return;
    }

    try {
      const path = await invoke<string | null>("open_save_dialog", { defaultName: document.name });

      if (!path) {
        setSaveState(document.content !== document.savedContent ? "idle" : "saved");
        return;
      }

      const content = contentOverride ?? document.content;
      setSaveState("saving");
      setFileError(null);

      const savedFile = await invoke<NativeSavedTextFile>("save_text_file_as", {
        path,
        content,
      });

      applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);
      setSaveState("error");
      setFileError(saveError.message ?? "Unable to save this file.");
    }
  };

  const saveDocument = async (options: { force?: boolean } = {}) => {
    if (saveState === "saving") {
      return;
    }

    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError("Large files are opened in read-only browsing mode and cannot be saved yet.");
      return;
    }

    if (document.isUntitled || !isAbsolutePath(document.path)) {
      await saveDocumentAs();
      return;
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError("Native saving is only available in the Tauri desktop app.");
      return;
    }

    const content = document.content;
    setSaveState("saving");
    setFileError(null);

    try {
      const savedFile = await invoke<NativeSavedTextFile>("save_text_file", {
        path: document.path,
        content,
        expectedLastModified: options.force ? null : document.lastModified ?? null,
        force: options.force ?? false,
      });

      applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);

      if (saveError.kind === "deleted") {
        setSaveState("idle");
        setFileError(saveError.message ?? "The original file was deleted. Choose a new location to save it.");
        await saveDocumentAs(content);
        return;
      }

      if (saveError.kind === "modified") {
        setSaveState("idle");
        setSaveConflict({
          content,
          lastModified: document.lastModified,
          message: saveError.message ?? "This file was changed outside Norn.",
          path: document.path,
        });
        return;
      }

      setSaveState("error");
      setFileError(saveError.message ?? "Unable to save this file.");
    }
  };

  const reloadConflictedDocument = async () => {
    const conflict = saveConflict;

    if (!conflict) {
      return;
    }

    setSaveConflict(null);
    await openNativeFile(conflict.path);
  };

  const readFolderEntries = async (path: string) => {
    const entries = await invoke<NativeDirectoryEntry[]>("list_directory", { path });

    return entries.map(toFileTreeNode);
  };

  const loadScratchView = async () => {
    if (!isTauriRuntime()) {
      setScratchView({
        error: "Scratch files are only available in the Tauri desktop app.",
        loadingPath: null,
        loading: false,
        nodes: [createDirectoryRootNode("temp/norn-scratch")],
        rootPath: "temp/norn-scratch",
      });
      return;
    }

    setScratchView((currentView) => ({
      error: null,
      loadingPath: currentView?.rootPath ?? "temp/norn-scratch",
      loading: true,
      nodes: currentView?.nodes ?? [createDirectoryRootNode("temp/norn-scratch")],
      rootPath: currentView?.rootPath ?? "temp/norn-scratch",
    }));

    try {
      const rootPath = await invoke<string>("ensure_scratch_directory");
      const nodes = await readFolderEntries(rootPath);

      setScratchView({
        error: null,
        loadingPath: null,
        loading: false,
        nodes: [createDirectoryRootNode(rootPath, nodes)],
        rootPath,
      });
    } catch (error) {
      setScratchView((currentView) => ({
        error: error instanceof Error ? error.message : String(error),
        loadingPath: null,
        loading: false,
        nodes: currentView?.nodes ?? [createDirectoryRootNode("temp/norn-scratch")],
        rootPath: currentView?.rootPath ?? "temp/norn-scratch",
      }));
    }
  };

  const openNativeFile = async (path: string, options: { clearFolderView?: boolean; size?: number } = {}) => {
    const { clearFolderView = false, size } = options;

    setFileError(null);
    setSaveConflict(null);

    try {
      const inspection = await invoke<NativeTextFileInspection>("inspect_text_file", { path });

      if (inspection.isBinary || !inspection.isUtf8) {
        setFileError(`${inspection.name} cannot be opened as UTF-8 text.`);
        return;
      }

      if (inspection.size > LARGE_FILE_READONLY_BYTES) {
        const rangeOffset =
          inspection.size > SUPER_LARGE_FILE_BYTES
            ? Math.max(0, inspection.size - LARGE_FILE_CHUNK_BYTES)
            : 0;
        const range = await invoke<NativeTextFileRange>("read_text_file_range", {
          path,
          offset: rangeOffset,
          length: LARGE_FILE_CHUNK_BYTES,
        });
        const contentPrefix = range.hasMoreBefore ? "[Earlier content omitted in large file browsing mode]\n\n" : "";
        const contentSuffix = range.hasMoreAfter ? "\n\n[More content omitted in large file browsing mode]" : "";
        const rangeContent = `${contentPrefix}${range.content}${contentSuffix}`;

        setDocument({
          id: getFileOpenId(inspection.path, inspection.lastModified),
          name: inspection.name,
          path: inspection.path,
          content: rangeContent,
          savedContent: rangeContent,
          size: inspection.size,
          lastModified: inspection.lastModified ?? undefined,
          mode: "large-readonly",
          range: {
            endOffset: range.endOffset,
            hasMoreAfter: range.hasMoreAfter,
            hasMoreBefore: range.hasMoreBefore,
            startOffset: range.startOffset,
          },
        });
        setSaveState("saved");

        if (clearFolderView) {
          setFolderView(null);
          setLeftPanelOpen(false);
        }

        return;
      }

      if ((typeof size === "number" ? size : inspection.size) > LARGE_FILE_CONFIRM_BYTES) {
        const shouldOpen = window.confirm(`This file is ${formatFileSize(inspection.size)}. Open it as text?`);

        if (!shouldOpen) {
          return;
        }
      }

      const file = await invoke<NativeTextFile>("read_text_file", { path });

      setDocument({
        id: getFileOpenId(file.path, file.lastModified),
        name: file.name,
        path: file.path,
        content: file.content,
        savedContent: file.content,
        size: file.size,
        lastModified: file.lastModified ?? undefined,
        mode: "editable",
      });
      setSaveState("saved");

      if (clearFolderView) {
        setFolderView(null);
        setLeftPanelOpen(false);
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const continueFileOpen = async (pendingOpen: PendingFileOpen) => {
    if (pendingOpen.kind === "path") {
      await openNativeFile(pendingOpen.path, {
        clearFolderView: pendingOpen.clearFolderView,
        size: pendingOpen.size,
      });
      return;
    }

    if (!isTauriRuntime()) {
      setFileError("Native file opening is only available in the Tauri desktop app.");
      return;
    }

    try {
      const path = await invoke<string | null>("open_file_dialog");

      if (path) {
        await openNativeFile(path, { clearFolderView: true });
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const requestFileOpen = (pendingOpen: PendingFileOpen) => {
    if (isDirty) {
      setPendingFileOpen(pendingOpen);
      return;
    }

    void continueFileOpen(pendingOpen);
  };

  const openFilePicker = () => {
    requestFileOpen({ kind: "file-dialog" });
  };

  useEffect(() => {
    void loadScratchView();
  }, []);

  const toggleFilesTool = () => {
    setLeftPanelOpen((value) => !value);
  };

  const openSearchTool = () => {
    setSearchOpen(true);
  };

  const closeSearchTool = () => {
    setSearchOpen(false);
  };

  const openSettingsTool = () => {
    setSettingsOpen(true);
  };

  const updateSettingsOpen = (open: boolean) => {
    setSettingsOpen(open);
  };

  const resizePanelWithKeyboard = (side: "left" | "right", event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keyDeltas: Record<string, number> = {
      ArrowLeft: -16,
      ArrowRight: 16,
    };

    if (event.key === "Home") {
      event.preventDefault();
      if (side === "left") {
        setLeftPanelWidth(leftPanelMinWidth);
        return;
      }
      setRightPanelWidth(rightPanelMinWidth);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      if (side === "left") {
        setLeftPanelWidth(leftPanelMaxWidth);
        return;
      }
      setRightPanelWidth(rightPanelMaxWidth);
      return;
    }

    const delta = keyDeltas[event.key];

    if (!delta) {
      return;
    }

    event.preventDefault();

    if (side === "left") {
      setLeftPanelWidth((width) => clamp(width + delta, leftPanelMinWidth, leftPanelMaxWidth));
      return;
    }

    setRightPanelWidth((width) => clamp(width - delta, rightPanelMinWidth, rightPanelMaxWidth));
  };

  const startPanelResize = (side: "left" | "right", event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerStart = event.clientX;
    const widthStart = side === "left" ? leftPanelWidth : rightPanelWidth;

    event.preventDefault();
    setResizingPanel(side);

    const previousCursor = globalThis.document.body.style.cursor;
    const previousUserSelect = globalThis.document.body.style.userSelect;
    globalThis.document.body.style.cursor = "col-resize";
    globalThis.document.body.style.userSelect = "none";

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
      const delta = pointerEvent.clientX - pointerStart;

      if (side === "left") {
        setLeftPanelWidth(clamp(widthStart + delta, leftPanelMinWidth, leftPanelMaxWidth));
        return;
      }

      setRightPanelWidth(clamp(widthStart - delta, rightPanelMinWidth, rightPanelMaxWidth));
    };

    const handlePointerUp = () => {
      setResizingPanel(null);
      globalThis.document.body.style.cursor = previousCursor;
      globalThis.document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const startScratchResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerStart = event.clientY;
    const heightStart = scratchPanelHeight;
    const panel = event.currentTarget.closest(".project-panel");
    const panelHeight = panel?.getBoundingClientRect().height ?? window.innerHeight;
    const maxHeight = Math.max(scratchPanelMinHeight, Math.floor(panelHeight * scratchPanelMaxHeightRatio));

    event.preventDefault();

    const previousCursor = globalThis.document.body.style.cursor;
    const previousUserSelect = globalThis.document.body.style.userSelect;
    globalThis.document.body.style.cursor = "row-resize";
    globalThis.document.body.style.userSelect = "none";

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
      const delta = pointerStart - pointerEvent.clientY;
      setScratchPanelHeight(clamp(heightStart + delta, scratchPanelMinHeight, maxHeight));
    };

    const handlePointerUp = () => {
      globalThis.document.body.style.cursor = previousCursor;
      globalThis.document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const rememberRecentFolder = (path: string) => {
    const folder = { name: getPathName(path), path };

    setRecentFolders((currentFolders) => {
      const nextFolders = [folder, ...currentFolders.filter((item) => item.path !== path)].slice(0, maxRecentFolders);
      saveRecentFolders(nextFolders);
      return nextFolders;
    });
  };

  const openFolderView = async (rootPath: string, origin: FolderView["origin"]) => {
    setLeftPanelOpen(true);
    setFolderView({
      rootPath,
      rootName: getPathName(rootPath),
      origin,
      nodes: [createDirectoryRootNode(rootPath, [], true)],
      loadingPath: rootPath,
      error: null,
    });

    try {
      const nodes = await readFolderEntries(rootPath);

      setFolderView({
        rootPath,
        rootName: getPathName(rootPath),
        origin,
        nodes: [createDirectoryRootNode(rootPath, nodes, true)],
        loadingPath: null,
        error: null,
      });
      rememberRecentFolder(rootPath);
    } catch (error) {
      setFolderView({
        rootPath,
        rootName: getPathName(rootPath),
        origin,
        nodes: [createDirectoryRootNode(rootPath, [], true)],
        loadingPath: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const openFolderPicker = async () => {
    if (!isTauriRuntime()) {
      setFileError("Native folder opening is only available in the Tauri desktop app.");
      return;
    }

    try {
      const path = await invoke<string | null>("open_folder_dialog");

      if (path) {
        await openFolderView(path, "open-folder");
      }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
    }
  };

  const openContainingFolder = async () => {
    const parentPath = getParentPath(document.path);

    if (!parentPath) {
      setFileError("Unable to determine the containing folder for this file.");
      return;
    }

    await openFolderView(parentPath, "containing-folder");
  };

  const loadDirectoryChildren = async (
    node: FileTreeNode,
    applyLoadingState: (loadingPath: string | null, update: (nodes: FileTreeNode[]) => FileTreeNode[]) => void,
  ) => {
    if (node.kind !== "directory") {
      return;
    }

    if (node.childrenLoaded) {
      applyLoadingState(null, (nodes) =>
        updateTreeNode(nodes, node.path, (currentNode) => ({
          ...currentNode,
          expanded: !currentNode.expanded,
        })),
      );
      return;
    }

    applyLoadingState(node.path, (nodes) =>
      updateTreeNode(nodes, node.path, (currentNode) => ({
        ...currentNode,
        expanded: true,
        error: undefined,
      })),
    );

    try {
      const children = await readFolderEntries(node.path);

      applyLoadingState(null, (nodes) =>
        updateTreeNode(nodes, node.path, (currentNode) => ({
          ...currentNode,
          children,
          childrenLoaded: true,
          expanded: true,
          error: undefined,
        })),
      );
    } catch (error) {
      applyLoadingState(null, (nodes) =>
        updateTreeNode(nodes, node.path, (currentNode) => ({
          ...currentNode,
          childrenLoaded: true,
          expanded: true,
          error: error instanceof Error ? error.message : String(error),
        })),
      );
    }
  };

  const toggleDirectory = async (node: FileTreeNode) => {
    if (!folderView) {
      return;
    }

    await loadDirectoryChildren(node, (loadingPath, updateNodes) => {
      setFolderView((currentView) =>
        currentView
          ? {
              ...currentView,
              loadingPath,
              nodes: updateNodes(currentView.nodes),
            }
          : currentView,
      );
    });
  };

  const toggleScratchDirectory = async (node: FileTreeNode) => {
    if (!scratchView) {
      return;
    }

    await loadDirectoryChildren(node, (loadingPath, updateNodes) => {
      setScratchView((currentView) =>
        currentView
          ? {
              ...currentView,
              loadingPath,
              nodes: updateNodes(currentView.nodes),
            }
          : currentView,
      );
    });
  };

  const openTreeFile = async (node: FileTreeNode) => {
    if (node.kind !== "file") {
      return;
    }

    requestFileOpen({ kind: "path", path: node.path, size: node.size });
  };

  const updateDocumentContent = (content: string) => {
    setDocument((currentDocument) =>
      currentDocument.content === content ? currentDocument : { ...currentDocument, content },
    );
    setSaveState((currentState) => (currentState === "saving" ? currentState : "idle"));
  };

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    listen<string>(nativeMenuEvent, (event) => {
      if (event.payload === nativeMenuCommands.newFile) {
        createFile();
      }

      if (event.payload === nativeMenuCommands.openFile) {
        openFilePicker();
      }

      if (event.payload === nativeMenuCommands.openFolder) {
        openFolderPicker();
      }

      if (event.payload === nativeMenuCommands.saveFile) {
        void saveDocument();
      }

      if (event.payload === nativeMenuCommands.saveFileAs) {
        void saveDocumentAs();
      }

      if (event.payload === nativeMenuCommands.showExplorer) {
        toggleFilesTool();
      }

      if (event.payload === nativeMenuCommands.find) {
        openSearchTool();
      }

      if (event.payload === nativeMenuCommands.toggleGitPanel) {
        setRightPanelOpen((value) => !value);
      }
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }

        unlisten = cleanup;
      })
      .catch(() => {
        unlisten = undefined;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [document.content, document.savedContent, document.path, document.lastModified, document.mode, document.isUntitled, saveState]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isSaveShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";

      if (!isSaveShortcut) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        void saveDocumentAs();
        return;
      }

      void saveDocument();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [document.content, document.savedContent, document.path, document.lastModified, document.mode, document.isUntitled, saveState]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className={cn("h-full bg-transparent text-[12px] text-foreground", showMacTitlebar && "mac-titlebar-overlay-layout")}>
        <div className="flex h-full min-w-0 flex-col">
          {showWindowsTitlebar ? (
            <WindowsTitleBar
              leftPanelOpen={leftPanelOpen}
              onCreateFile={createFile}
              onToggleLeftPanel={toggleFilesTool}
              onOpenFile={openFilePicker}
              onOpenFolder={openFolderPicker}
              onSaveFile={() => void saveDocument()}
              onSaveFileAs={() => void saveDocumentAs()}
              onOpenSearch={openSearchTool}
              onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
              rightPanelOpen={rightPanelOpen}
              searchOpen={searchOpen}
              onCloseSearch={closeSearchTool}
            />
          ) : null}
          {showMacTitlebar ? (
            <MacTitlebar
              leftPanelOpen={leftPanelOpen}
              onCloseSearch={closeSearchTool}
              onOpenSearch={openSearchTool}
              onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
              rightPanelOpen={rightPanelOpen}
              onToggleLeftPanel={toggleFilesTool}
              searchOpen={searchOpen}
            />
          ) : null}
          <main
            className={cn("workbench-layout grid min-h-0 flex-1 bg-transparent", resizingPanel && "workbench-layout-resizing")}
            style={{
              gridTemplateColumns: `${leftPanelOpen ? `${leftPanelWidth}px` : "0px"} ${leftPanelOpen ? "1px" : "0px"} minmax(0,1fr) ${
                rightPanelOpen ? "1px" : "0px"
              } ${rightPanelOpen ? `${rightPanelWidth}px` : "0px"}`,
            }}
          >
            <div
              className={cn("workbench-side-panel workbench-left-panel", !leftPanelOpen && "workbench-side-panel-closed")}
              aria-hidden={!leftPanelOpen}
            >
              <ProjectPanel
                activePath={document.path}
                folderView={folderView}
                leftPanelWidth={leftPanelWidth}
                onOpenFolder={openFolderPicker}
                onOpenSettings={openSettingsTool}
                onOpenRecentFolder={(path) => void openFolderView(path, "open-folder")}
                onOpenTreeFile={openTreeFile}
                recentFolders={recentFolders}
                scratchView={scratchView}
                onOpenScratchFile={(node) => requestFileOpen({ kind: "path", path: node.path, size: node.size })}
                onRefreshScratch={() => void loadScratchView()}
                onResizeScratch={startScratchResize}
                onToggleScratchDirectory={(node) => void toggleScratchDirectory(node)}
                onToggleDirectory={toggleDirectory}
                scratchPanelHeight={scratchPanelHeight}
              />
            </div>
            <PanelResizeHandle
              max={leftPanelMaxWidth}
              min={leftPanelMinWidth}
              onKeyDown={(event) => resizePanelWithKeyboard("left", event)}
              onPointerDown={(event) => startPanelResize("left", event)}
              open={leftPanelOpen}
              side="left"
              value={leftPanelWidth}
            />
            <EditorSurface
              document={document}
              error={fileError}
              isDirty={isDirty}
              onChange={updateDocumentContent}
              onCreateFile={createFile}
            />
            <PanelResizeHandle
              max={rightPanelMaxWidth}
              min={rightPanelMinWidth}
              onKeyDown={(event) => resizePanelWithKeyboard("right", event)}
              onPointerDown={(event) => startPanelResize("right", event)}
              open={rightPanelOpen}
              side="right"
              value={rightPanelWidth}
            />
            <div
              className={cn("workbench-side-panel workbench-right-panel", !rightPanelOpen && "workbench-side-panel-closed")}
              aria-hidden={!rightPanelOpen}
            >
              <GitPanel />
            </div>
          </main>
          <StatusBar
            document={document}
            isDirty={isDirty}
            onOpenSettings={openSettingsTool}
            saveState={saveState}
          />
          <SettingsDialog open={settingsOpen} onOpenChange={updateSettingsOpen} />
          <DiscardChangesDialog
            open={Boolean(pendingFileOpen)}
            onCancel={() => setPendingFileOpen(null)}
            onDiscard={() => {
              const pendingOpen = pendingFileOpen;
              setPendingFileOpen(null);

              if (pendingOpen) {
                void continueFileOpen(pendingOpen);
              }
            }}
          />
          <SaveConflictDialog
            open={Boolean(saveConflict)}
            message={saveConflict?.message}
            onCancel={() => setSaveConflict(null)}
            onOverwrite={() => {
              setSaveConflict(null);
              void saveDocument({ force: true });
            }}
            onReload={() => {
              void reloadConflictedDocument();
            }}
            onSaveAs={() => {
              const content = saveConflict?.content;
              setSaveConflict(null);
              void saveDocumentAs(content);
            }}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function WindowsTitleBar({
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
    <header className="windows-titlebar frosted-surface frosted-surface-raised" onDoubleClick={handleTitlebarDoubleClick}>
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
              <div className="windows-titlebar-parent-menu" key={item.id} onPointerEnter={(event) => activateMenu(item.id, event.currentTarget)}>
                <button
                  className={cn("windows-titlebar-parent-menu-button", activeMenu === item.id && "windows-titlebar-parent-menu-button-active")}
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
                    className={cn("windows-titlebar-submenu-item", child === "Close" && "windows-titlebar-submenu-item-danger")}
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
                  <button className="windows-titlebar-folder-menu-item" type="button" onClick={() => setProjectMenuOpen(false)}>
                    Add Folder
                  </button>
                  <div className="windows-titlebar-folder-menu-section">
                    {recentProjects.map((project) => (
                      <button className="windows-titlebar-recent-project" key={project.path} type="button" onClick={() => selectProject(project.name)}>
                        <span className="windows-titlebar-recent-project-icon" style={getProjectAccentStyle(project.name)}>
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
        <button className="windows-window-button" type="button" aria-label="Minimize" onClick={() => appWindow.minimize()}>
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
        <button className="windows-window-button windows-window-button-close" type="button" aria-label="Close" onClick={() => appWindow.close()}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function MacTitlebar({
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

function PanelToggleButton({
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
  const Icon = side === "left" ? PanelLeft : PanelRight;

  return (
    <button
      className={cn("panel-toggle-button", className, open && "panel-toggle-button-active")}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={open}
      onClick={onClick}
    >
      {useLocalSidebarIcon ? <SidebarPanelIcon side={side} /> : <Icon className="h-3 w-3" />}
      {showBadge ? <span className="panel-toggle-badge">4</span> : null}
    </button>
  );
}

function SidebarPanelIcon({ side }: { side: "left" | "right" }) {
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

function PanelResizeHandle({
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

function TopSearchButton({ className, onClick }: { className: string; onClick: () => void }) {
  return (
    <button className={className} type="button" onClick={onClick}>
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Search files, commands, symbols</span>
    </button>
  );
}

function QuickSearch({ onClose, open }: { onClose: () => void; open: boolean }) {
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

function ProjectPanel({
  activePath,
  folderView,
  leftPanelWidth,
  onOpenFolder,
  onOpenRecentFolder,
  onOpenSettings,
  onOpenScratchFile,
  onOpenTreeFile,
  onRefreshScratch,
  onResizeScratch,
  onToggleScratchDirectory,
  recentFolders,
  scratchView,
  scratchPanelHeight,
  onToggleDirectory,
}: {
  activePath: string;
  folderView: FolderView | null;
  leftPanelWidth: number;
  onOpenFolder: () => void;
  onOpenRecentFolder: (path: string) => void;
  onOpenSettings: () => void;
  onOpenScratchFile: (node: FileTreeNode) => void;
  onOpenTreeFile: (node: FileTreeNode) => void;
  onRefreshScratch: () => void;
  onResizeScratch: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleScratchDirectory: (node: FileTreeNode) => void;
  recentFolders: RecentFolder[];
  scratchPanelHeight: number;
  scratchView: ScratchView | null;
  onToggleDirectory: (node: FileTreeNode) => void;
}) {
  const [focusedPanel, setFocusedPanel] = useState<"scratch" | "workspace" | null>(null);
  const effectiveScratchHeight =
    focusedPanel === "scratch" ? "60%" : focusedPanel === "workspace" ? scratchPanelMinHeight : scratchPanelHeight;
  const focusWorkspace = () => {
    if (leftPanelWidth <= 280) {
      setFocusedPanel("workspace");
    }
  };

  const focusScratch = () => {
    if (scratchPanelHeight <= scratchPanelFocusThreshold) {
      setFocusedPanel("scratch");
    }
  };

  return (
    <aside
      className={cn(
        "project-panel frosted-surface frosted-surface-subtle",
        focusedPanel === "workspace" && "project-panel-focus-workspace",
        focusedPanel === "scratch" && "project-panel-focus-scratch",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setFocusedPanel(null);
        }
      }}
    >
      <ProjectPanelStart
        focused={focusedPanel === "workspace"}
        folderView={folderView}
        leftPanelWidth={leftPanelWidth}
        onFocusWorkspace={focusWorkspace}
        onOpenFolder={onOpenFolder}
        onOpenRecentFolder={onOpenRecentFolder}
        recentFolders={recentFolders}
      />
      {folderView ? <div className="project-panel-tree-divider" aria-hidden="true" /> : null}
      <FolderTreePanel
        activePath={activePath}
        folderView={folderView}
        onClearFocus={() => setFocusedPanel(null)}
        onOpenFile={onOpenTreeFile}
        onToggleDirectory={onToggleDirectory}
      />
      <ScratchPanel
        activePath={activePath}
        focused={focusedPanel === "scratch"}
        height={effectiveScratchHeight}
        onOpenFile={onOpenScratchFile}
        onFocus={focusScratch}
        onRefresh={onRefreshScratch}
        onResize={(event) => {
          setFocusedPanel(null);
          onResizeScratch(event);
        }}
        scratchView={scratchView}
        subdued={focusedPanel === "workspace"}
        onToggleDirectory={onToggleScratchDirectory}
      />
      <ProjectPanelFooter onOpenSettings={onOpenSettings} />
    </aside>
  );
}

function ProjectPanelStart({
  focused,
  folderView,
  leftPanelWidth,
  onFocusWorkspace,
  onOpenFolder,
  onOpenRecentFolder,
  recentFolders,
}: {
  focused: boolean;
  folderView: FolderView | null;
  leftPanelWidth: number;
  onFocusWorkspace: () => void;
  onOpenFolder: () => void;
  onOpenRecentFolder: (path: string) => void;
  recentFolders: RecentFolder[];
}) {
  const activeFolderPath = folderView?.rootPath ?? null;
  const activeRecentFolder = recentFolders.find((folder) => folder.path === activeFolderPath);
  const activeFolderName = activeRecentFolder?.name ?? (folderView ? getPathName(folderView.rootPath) : "Recent folders");
  const activePathMaxLength = Math.max(18, Math.floor((leftPanelWidth - 96) / 6.2));
  const activeFolderPathLabel = folderView ? getTailPath(folderView.rootPath, activePathMaxLength) : "";
  const activeFolderAccentStyle = getProjectAccentStyle(activeFolderName);
  const currentFolder = folderView ? { name: activeFolderName, path: folderView.rootPath } : null;
  const inactiveRecentFolders = recentFolders.filter((folder) => folder.path !== activeFolderPath);

  const renderRecentFolderItem = (project: RecentFolder, selected: boolean) => (
    <DropdownMenuItem
      aria-selected={selected}
      className={cn("project-panel-recent-menu-item", selected && "project-panel-recent-menu-item-selected")}
      key={project.path}
      onSelect={() => onOpenRecentFolder(project.path)}
    >
      <span className="project-panel-recent-menu-avatar" style={getProjectAccentStyle(project.name)}>
        {getProjectInitials(project.name)}
      </span>
      <span className="project-panel-recent-text">
        <span className="project-panel-recent-name">{project.name}</span>
        <span className="project-panel-recent-path" title={project.path}>
          {getCompactPath(project.path, 5)}
        </span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <div className="project-panel-start">
      <button className="project-panel-action-button" type="button" onClick={onOpenFolder}>
        <FolderOpen className="h-[18px] w-[18px] shrink-0" />
        Open New Folder
      </button>
      <div className="project-panel-divider" aria-hidden="true" />
      {folderView ? (
        <div className={cn("project-panel-recent-switcher", focused && "project-panel-recent-switcher-focused")}>
          <div className="project-panel-recent-heading">Recent folders</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn("project-panel-recent-select", focused && "project-panel-recent-select-focused")}
                type="button"
                onClick={onFocusWorkspace}
              >
                <span className="project-panel-recent-select-avatar" style={activeFolderAccentStyle}>
                  {getProjectInitials(activeFolderName)}
                </span>
                <span className="project-panel-recent-select-text">
                  <span className="project-panel-recent-select-name">{activeFolderName}</span>
                  {activeFolderPathLabel ? (
                    <span className="project-panel-recent-select-path" title={folderView?.rootPath}>
                      {activeFolderPathLabel}
                    </span>
                  ) : null}
                </span>
                <span className="project-panel-recent-select-chevron">
                  <ChevronDown className="h-3.5 w-3.5" />
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="project-panel-recent-menu" sideOffset={6}>
              {currentFolder ? renderRecentFolderItem(currentFolder, true) : null}
              {currentFolder && inactiveRecentFolders.length > 0 ? (
                <DropdownMenuSeparator className="project-panel-recent-menu-separator" />
              ) : null}
              {inactiveRecentFolders.length > 0 ? (
                inactiveRecentFolders.slice(0, currentFolder ? 7 : 8).map((project) => renderRecentFolderItem(project, false))
              ) : currentFolder ? null : (
                <DropdownMenuItem className="project-panel-recent-menu-item" disabled>
                  No recent folders yet
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <div className="project-panel-recent">
          <div className="project-panel-recent-label">Recent folders</div>
          {recentFolders.length > 0 ? (
            recentFolders.slice(0, 5).map((project) => (
              <button
                className="project-panel-recent-item"
                key={project.path}
                type="button"
                onClick={() => onOpenRecentFolder(project.path)}
              >
                <span className="project-panel-recent-text">
                  <span className="project-panel-recent-name">{project.name}</span>
                  <span className="project-panel-recent-path">{project.path}</span>
                </span>
              </button>
            ))
          ) : (
            <div className="project-panel-recent-empty">No recent folders yet</div>
          )}
        </div>
      )}
    </div>
  );
}

function FolderTreePanel({
  activePath,
  folderView,
  onClearFocus,
  onOpenFile,
  onToggleDirectory,
}: {
  activePath: string;
  folderView: FolderView | null;
  onClearFocus: () => void;
  onOpenFile: (node: FileTreeNode) => void;
  onToggleDirectory: (node: FileTreeNode) => void;
}) {
  const treeScrollContentRef = useRef<HTMLDivElement>(null);
  const [treeScrollOverflowing, setTreeScrollOverflowing] = useState(false);

  useEffect(() => {
    const content = treeScrollContentRef.current;

    if (!content) {
      setTreeScrollOverflowing(false);
      return;
    }

    const viewport = content.closest("[data-radix-scroll-area-viewport]");

    if (!viewport) {
      setTreeScrollOverflowing(false);
      return;
    }

    const updateOverflow = () => {
      setTreeScrollOverflowing(viewport.scrollHeight > viewport.clientHeight + 1);
    };

    const scheduleUpdateOverflow = () => {
      window.requestAnimationFrame(updateOverflow);
    };

    scheduleUpdateOverflow();

    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);
    window.addEventListener("resize", scheduleUpdateOverflow);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdateOverflow);
    };
  }, [folderView?.rootPath, folderView?.nodes, folderView?.loadingPath]);

  if (!folderView) {
    return <div className="min-h-0 flex-1" />;
  }

  const rootNode = folderView.nodes[0];
  const rootChildren = rootNode?.children ?? [];
  const rootExpanded = Boolean(rootNode?.expanded);
  const hasRootChildren = rootChildren.length > 0;
  const showRootEmptyMessage = rootExpanded && !hasRootChildren && folderView.loadingPath !== folderView.rootPath && !folderView.error;

  return (
    <>
      {folderView.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {folderView.error}
        </div>
      ) : null}
      {rootNode ? (
        <FileTreeRootHeader
          loadingPath={folderView.loadingPath}
          node={rootNode}
          onToggleDirectory={onToggleDirectory}
        />
      ) : null}
      <ScrollArea className="file-tree-scroll min-h-0 flex-1" type="auto" onPointerDown={onClearFocus}>
        <div
          className={cn(
            "file-tree-list",
            treeScrollOverflowing && "file-tree-list-scroll-overflowing",
          )}
          ref={treeScrollContentRef}
          role="tree"
          aria-label={folderView.rootName}
        >
          {folderView.loadingPath === folderView.rootPath && folderView.nodes.length === 0 ? (
            <div className="px-2 py-2 text-[12px] text-muted-foreground">Loading folder...</div>
          ) : null}
          {rootExpanded ? rootChildren.map((node) => (
            <FileTreeRow
              activePath={activePath}
              depth={1}
              key={node.path}
              loadingPath={folderView.loadingPath}
              node={node}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
            />
          )) : null}
          {showRootEmptyMessage ? <div className="file-tree-empty-message">No files in this folder.</div> : null}
        </div>
      </ScrollArea>
    </>
  );
}

function ScratchPanel({
  activePath,
  focused,
  height,
  onOpenFile,
  onFocus,
  onRefresh,
  onResize,
  onToggleDirectory,
  scratchView,
  subdued,
}: {
  activePath: string;
  focused: boolean;
  height: CSSProperties["height"];
  onOpenFile: (node: FileTreeNode) => void;
  onFocus: () => void;
  onRefresh: () => void;
  onResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToggleDirectory: (node: FileTreeNode) => void;
  scratchView: ScratchView | null;
  subdued: boolean;
}) {
  const nodes = scratchView?.nodes ?? [];
  const rootNode = nodes[0];
  const rootChildren = rootNode?.children ?? [];
  const rootExpanded = Boolean(rootNode?.expanded);
  const hasScratchContent = rootChildren.length > 0;
  const showScratchEmptyMessage = rootExpanded && !scratchView?.loading && !scratchView?.error && !hasScratchContent;

  return (
    <section
      className={cn("scratch-panel", focused && "scratch-panel-focused", subdued && "scratch-panel-subdued")}
      style={{ height }}
      onFocus={onFocus}
    >
      <div className="scratch-panel-resize-handle" role="separator" aria-orientation="horizontal" onPointerDown={onResize} />
      <button className="scratch-panel-heading" type="button" onClick={onFocus}>
        <div className="min-w-0">
          <div className="scratch-panel-title">Scratch folder</div>
          <div className="scratch-panel-path" title={scratchView?.rootPath}>
            {scratchView?.rootPath ? getTailPath(scratchView.rootPath, 28) : "temp/norn-scratch"}
          </div>
        </div>
      </button>
      <div className="scratch-panel-toolbar">
        <button className="scratch-panel-refresh" type="button" onClick={onRefresh} aria-label="Refresh scratch folder">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {rootNode ? (
        <FileTreeRootHeader
          className="scratch-panel-root-header"
          loadingPath={scratchView?.loadingPath ?? null}
          node={rootNode}
          onToggleDirectory={onToggleDirectory}
        />
      ) : null}
      <div className="scratch-panel-list" role="tree" aria-label="Scratch files">
        {scratchView?.loading ? <div className="scratch-panel-message">Loading scratch files...</div> : null}
        {scratchView?.error ? <div className="scratch-panel-error">{scratchView.error}</div> : null}
        {rootExpanded ? rootChildren.map((node) => (
          <FileTreeRow
            activePath={activePath}
            depth={1}
            key={node.path}
            loadingPath={scratchView?.loadingPath ?? null}
            node={node}
            onOpenFile={onOpenFile}
            onToggleDirectory={onToggleDirectory}
          />
        )) : null}
        {showScratchEmptyMessage ? <div className="scratch-panel-message">No scratch files yet.</div> : null}
      </div>
    </section>
  );
}

function ProjectPanelFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="project-panel-footer">
      <button
        className="project-panel-action-button"
        type="button"
        onClick={onOpenSettings}
      >
        <Settings className="h-[18px] w-[18px] shrink-0" />
        <span className="truncate">Settings</span>
      </button>
    </div>
  );
}

function FileTreeRootHeader({
  className,
  loadingPath,
  node,
  onToggleDirectory,
}: {
  className?: string;
  loadingPath: string | null;
  node: FileTreeNode;
  onToggleDirectory: (node: FileTreeNode) => void;
}) {
  const isLoading = loadingPath === node.path;
  const { className: iconClassName, Icon } = getFileTreeIcon(node);

  return (
    <button
      aria-expanded={Boolean(node.expanded)}
      className={cn("file-tree-root-header", className)}
      role="treeitem"
      title={node.path}
      type="button"
      onClick={() => onToggleDirectory(node)}
    >
      <span className="tree-row-toggle">
        {node.expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </span>
      <span className="tree-row-main">
        <Icon className={cn("tree-row-icon", iconClassName)} />
        <span className="tree-row-name">{node.name}</span>
      </span>
      <span className="tree-row-size">{isLoading ? "..." : ""}</span>
    </button>
  );
}

function FileTreeRow({
  activePath,
  depth = 0,
  emptyDirectoryMessage,
  emptyDirectoryPath,
  loadingPath,
  node,
  onOpenFile,
  onToggleDirectory,
}: {
  activePath: string;
  depth?: number;
  emptyDirectoryMessage?: string;
  emptyDirectoryPath?: string;
  loadingPath: string | null;
  node: FileTreeNode;
  onOpenFile: (node: FileTreeNode) => void;
  onToggleDirectory: (node: FileTreeNode) => void;
}) {
  const isDirectory = node.kind === "directory";
  const isActive = node.path === activePath;
  const isLoading = loadingPath === node.path;
  const showEmptyDirectoryMessage =
    Boolean(emptyDirectoryMessage) &&
    node.path === emptyDirectoryPath &&
    Boolean(node.expanded) &&
    Boolean(node.childrenLoaded) &&
    node.children?.length === 0 &&
    !isLoading;
  const { className: iconClassName, Icon } = getFileTreeIcon(node);

  return (
    <div className={cn("file-tree-node", depth === 0 && isDirectory && "file-tree-root-node")} role="none">
      <button
        aria-expanded={isDirectory ? Boolean(node.expanded) : undefined}
        aria-selected={isActive}
        className={cn(
          "tree-row w-full text-left",
          depth === 0 && isDirectory && "tree-row-root",
          isActive && "tree-row-active",
          node.error && "tree-row-muted",
        )}
        role="treeitem"
        style={{ "--tree-depth": depth } as CSSProperties}
        type="button"
        title={node.path}
        onClick={() => (isDirectory ? onToggleDirectory(node) : onOpenFile(node))}
      >
        <span className="tree-row-toggle">
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
        </span>
        <span className="tree-row-size">
          {isLoading ? "..." : isDirectory ? "" : formatFileSize(node.size)}
        </span>
      </button>
      {node.error ? <div className="px-2 py-1 text-[11px] text-destructive">{node.error}</div> : null}
      {showEmptyDirectoryMessage ? (
        <div
          className="file-tree-empty-message"
          style={{ "--tree-empty-depth": `${depth + 1}` } as CSSProperties}
        >
          {emptyDirectoryMessage}
        </div>
      ) : null}
      {node.expanded && node.children ? (
        <div
          className="file-tree-children"
          role="group"
          style={{ "--tree-depth-line": `${(depth + 1) * 14}px` } as CSSProperties}
        >
          {node.children.map((child) => (
            <FileTreeRow
              activePath={activePath}
              depth={depth + 1}
              emptyDirectoryMessage={emptyDirectoryMessage}
              emptyDirectoryPath={emptyDirectoryPath}
              key={child.path}
              loadingPath={loadingPath}
              node={child}
              onOpenFile={onOpenFile}
              onToggleDirectory={onToggleDirectory}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DiscardChangesDialog({
  onCancel,
  onDiscard,
  open,
}: {
  onCancel: () => void;
  onDiscard: () => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>
            Current changes are not saved. Discard them and open another file?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDiscard}>
            Discard and Open
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaveConflictDialog({
  message,
  onCancel,
  onOverwrite,
  onReload,
  onSaveAs,
  open,
}: {
  message?: string;
  onCancel: () => void;
  onOverwrite: () => void;
  onReload: () => void;
  onSaveAs: () => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File changed on disk</DialogTitle>
          <DialogDescription>
            {message ?? "This file was changed outside Norn. Choose how to handle your unsaved edits."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={onSaveAs}>
            Save As
          </Button>
          <Button variant="ghost" onClick={onReload}>
            Reload
          </Button>
          <Button variant="destructive" onClick={onOverwrite}>
            Overwrite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditorSurface({
  document,
  error,
  isDirty,
  onChange,
  onCreateFile,
}: {
  document: WorkbenchDocument;
  error: string | null;
  isDirty: boolean;
  onChange: (content: string) => void;
  onCreateFile: () => WorkbenchDocument;
}) {
  const editorFrameRef = useRef<HTMLDivElement>(null);
  const editorElementRef = useRef<HTMLDivElement>(null);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabScrollLeftRef = useRef(0);
  const tabLayoutFrameRef = useRef<number | null>(null);
  const tabScrollAnimationFrameRef = useRef<number | null>(null);
  const scrollDOMRef = useRef<HTMLElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const languageCompartmentRef = useRef(new Compartment());
  const dragRef = useRef<{
    maxScroll: number;
    orientation: EditorScrollbarOrientation;
    pointerStart: number;
    scrollStart: number;
    thumbSize: number;
    trackSize: number;
  } | null>(null);
  const [activePreviewTabId, setActivePreviewTabId] = useState(document.id);
  const [editingPreviewTabId, setEditingPreviewTabId] = useState<string | null>(null);
  const [editingPreviewTabName, setEditingPreviewTabName] = useState("");
  const [hiddenCloseTabIds, setHiddenCloseTabIds] = useState<Set<string>>(() => new Set());
  const [tabLayouts, setTabLayouts] = useState<Record<string, EditorTabLayout>>({});
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  const [previewTabs, setPreviewTabs] = useState<EditorTabPreview[]>(() =>
    editorTabPreviewNames.map((name, index) => {
      const id = index === 0 ? document.id : `preview-tab-${index}`;
      const tabName = index === 0 ? document.name : name;
      const accent = getTabAccent(id);

      return {
        accent,
        borderAccent: getTabBorderAccent(tabName, accent),
        id,
        name: tabName,
        path: index === 0 ? document.path : `src/mock-tabs/${tabName}`,
        dirty: index === 0 ? isDirty || document.isUntitled : index % 4 === 1,
      };
    }),
  );

  const commitPreviewTabName = () => {
    if (!editingPreviewTabId) {
      return;
    }

    const nextName = editingPreviewTabName.trim();

    if (nextName) {
      setPreviewTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === editingPreviewTabId
            ? {
                ...tab,
                borderAccent: getTabBorderAccent(nextName, tab.accent),
                name: nextName,
                path: replacePathName(tab.path, nextName),
              }
            : tab,
        ),
      );
    }

    setEditingPreviewTabId(null);
  };

  const addPreviewTab = () => {
    const nextDocument = onCreateFile();

    setEditingPreviewTabId(null);
    setActivePreviewTabId(nextDocument.id);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const tabScroll = tabScrollRef.current;

        if (!tabScroll) {
          return;
        }

        animateTabScrollTo(Math.max(0, tabScroll.scrollWidth - tabScroll.clientWidth));
      });
    });
  };

  const closePreviewTab = (tabId: string) => {
    setEditingPreviewTabId((currentId) => (currentId === tabId ? null : currentId));
    setPreviewTabs((currentTabs) => {
      if (currentTabs.length <= 1) {
        return currentTabs;
      }

      const closingIndex = currentTabs.findIndex((tab) => tab.id === tabId);
      const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);

      if (activePreviewTabId === tabId) {
        const nextActiveTab = nextTabs[Math.min(Math.max(closingIndex, 0), nextTabs.length - 1)];

        if (nextActiveTab) {
          setActivePreviewTabId(nextActiveTab.id);
          window.requestAnimationFrame(() => {
            scrollPreviewTabIntoView(nextActiveTab.id);
          });
        }
      }

      return nextTabs;
    });
  };

  const updateTabLayout = () => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      setTabOverflow({ left: false, right: false });
      setTabLayouts({});
      return;
    }

    const tabElements = previewTabs.map((tab) => tabButtonRefs.current[tab.id]).filter(Boolean) as HTMLDivElement[];

    if (tabElements.length !== previewTabs.length) {
      return;
    }

    const style = window.getComputedStyle(tabScroll);
    const railPadding = Number.parseFloat(style.paddingLeft) || 0;
    const leftStackStep = Number.parseFloat(style.getPropertyValue("--tab-left-stack-step")) || 30;
    const rightStackStep = Number.parseFloat(style.getPropertyValue("--tab-stack-step")) || 20;
    const leftVisibleStackLimit = 4;
    const rightVisibleStackLimit = 6;
    const hideBuffer = 50;
    const widths = tabElements.map((element) => element.offsetWidth);
    const scrollLeft = tabScroll.scrollLeft;
    const scrollMax = Math.max(0, tabScroll.scrollWidth - tabScroll.clientWidth);

    const getStackOverflow = (orderedWidths: number[], scrollOffset: number, stackStep: number, visibleStackLimit: number) => {
      let cursor = railPadding;
      let overflow = 0;

      orderedWidths.forEach((width, index) => {
        if (index >= visibleStackLimit) {
          const triggerScroll = cursor - index * stackStep;
          const rawProgress = (scrollOffset - triggerScroll) / stackStep;

          if (rawProgress > 0) {
            overflow = Math.max(overflow, index - visibleStackLimit + clamp(rawProgress, 0, 1));
          }
        }

        cursor += width;
      });

      return Math.max(0, overflow);
    };

    const leftStackOverflow = getStackOverflow(widths, scrollLeft, leftStackStep, leftVisibleStackLimit);
    const reversedWidths = [...widths].reverse();
    const rightStackOverflow = getStackOverflow(reversedWidths, scrollMax - scrollLeft, rightStackStep, rightVisibleStackLimit);
    const viewportWidth = tabScroll.clientWidth;
    let reverseCursor = railPadding;
    const rightSlots: Array<{ right: number; stickyRight: number }> = [];

    reversedWidths.forEach((width, reversedIndex) => {
      const originalIndex = widths.length - 1 - reversedIndex;
      const naturalLeft = reverseCursor - (scrollMax - scrollLeft);
      const stickyRight = (reversedIndex - rightStackOverflow) * rightStackStep;

      rightSlots[originalIndex] = {
        right: Math.max(naturalLeft, stickyRight),
        stickyRight,
      };
      reverseCursor += width;
    });

    let cursor = railPadding;
    const positions = widths.map((width, index) => {
      const naturalLeft = cursor - scrollLeft;
      const naturalRight = naturalLeft + width;
      const stickyLeft = (index - leftStackOverflow) * leftStackStep;
      const rightSlot = rightSlots[index];
      const isLeftPinned = naturalLeft <= stickyLeft;
      const isRightPinned = naturalRight >= viewportWidth - rightSlot.stickyRight;
      let side: EditorTabLayout["side"] = "normal";
      let left = naturalLeft;

      if (isLeftPinned && isRightPinned) {
        side = naturalLeft + width / 2 < viewportWidth / 2 ? "left" : "right";
      } else if (isLeftPinned) {
        side = "left";
      } else if (isRightPinned) {
        side = "right";
      }

      if (side === "left") {
        left = Math.max(naturalLeft, stickyLeft);
      } else if (side === "right") {
        left = viewportWidth - width - rightSlot.right;
      }

      cursor += width;

      return {
        left,
        side,
        stickyLeft,
        stickyRight: rightSlot.stickyRight,
        width,
      };
    });

    const centerLine = viewportWidth / 2;
    const crossingCenterIndex = positions.findIndex(
      (position) => position.left <= centerLine && position.left + position.width >= centerLine,
    );
    const visualCenterIndex =
      crossingCenterIndex >= 0
        ? crossingCenterIndex
        : positions.reduce((bestIndex, position, index) => {
            const currentCenter = position.left + position.width / 2;
            const best = positions[bestIndex];
            const bestCenter = best.left + best.width / 2;

            return Math.abs(currentCenter - centerLine) < Math.abs(bestCenter - centerLine) ? index : bestIndex;
          }, 0);
    const zIndexes = positions.map((_, index) => {
      if (index === visualCenterIndex) {
        return 10000;
      }

      return index < visualCenterIndex ? 1000 + index : 1000 + positions.length - index;
    });

    const getCoveredEdges = (index: number) => {
      const position = positions[index];
      const left = position.left;
      const right = position.left + position.width;
      const coveredRanges: Array<[number, number]> = [];

      positions.forEach((other, otherIndex) => {
        if (otherIndex === index || zIndexes[otherIndex] <= zIndexes[index]) {
          return;
        }

        const overlapLeft = Math.max(left, other.left);
        const overlapRight = Math.min(right, other.left + other.width);

        if (overlapRight - overlapLeft > 0) {
          coveredRanges.push([overlapLeft - left, overlapRight - left]);
        }
      });

      if (!coveredRanges.length) {
        return { left: 0, right: 0 };
      }

      coveredRanges.sort((a, b) => a[0] - b[0]);

      const merged: Array<[number, number]> = [];

      coveredRanges.forEach((range) => {
        const last = merged[merged.length - 1];

        if (!last || range[0] > last[1]) {
          merged.push([...range]);
          return;
        }

        last[1] = Math.max(last[1], range[1]);
      });

      let coveredLeft = 0;
      let cursorLeft = 0;

      merged.forEach((range) => {
        if (range[0] <= cursorLeft) {
          coveredLeft = Math.max(coveredLeft, range[1]);
          cursorLeft = coveredLeft;
        }
      });

      let coveredRight = 0;
      let cursorRight = position.width;

      for (let index = merged.length - 1; index >= 0; index -= 1) {
        const range = merged[index];

        if (range[1] >= cursorRight) {
          coveredRight = Math.max(coveredRight, cursorRight - range[0]);
          cursorRight = range[0];
        }
      }

      return {
        left: clamp(coveredLeft, 0, position.width),
        right: clamp(coveredRight, 0, position.width),
      };
    };

    const nextLayouts = previewTabs.reduce<Record<string, EditorTabLayout>>((layouts, tab, index) => {
      const position = positions[index];
      const coveredEdges = getCoveredEdges(index);

      layouts[tab.id] = {
        coveredLeft: clamp((coveredEdges.left / position.width) * 100, 0, 100),
        coveredRight: clamp((coveredEdges.right / position.width) * 100, 0, 100),
        hideLeft: clamp(((coveredEdges.left - hideBuffer) / position.width) * 100, 0, 100),
        hideRight: clamp(((coveredEdges.right - hideBuffer) / position.width) * 100, 0, 100),
        side: position.side,
        stickyLeft: position.stickyLeft,
        stickyRight: position.stickyRight,
        zIndex: zIndexes[index],
      };

      return layouts;
    }, {});

    setTabOverflow({
      left: scrollLeft > 2,
      right: scrollLeft < scrollMax - 2,
    });
    setTabLayouts(nextLayouts);
    setHiddenCloseTabIds((currentIds) => {
      const nextIds = new Set(currentIds);

      previewTabs.forEach((tab) => {
        const layout = nextLayouts[tab.id];

        if (!layout) {
          nextIds.delete(tab.id);
          return;
        }

        if (layout.coveredLeft >= 60) {
          nextIds.add(tab.id);
          return;
        }

        if (layout.coveredLeft <= 20) {
          nextIds.delete(tab.id);
        }
      });

      if (nextIds.size === currentIds.size && [...nextIds].every((id) => currentIds.has(id))) {
        return currentIds;
      }

      return nextIds;
    });
  };

  const cancelTabScrollAnimation = () => {
    if (tabScrollAnimationFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(tabScrollAnimationFrameRef.current);
    tabScrollAnimationFrameRef.current = null;
  };

  const animateTabScrollTo = (target: number, onDone: (() => void) | null = null) => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      return;
    }

    cancelTabScrollAnimation();

    const start = tabScroll.scrollLeft;
    const distance = target - start;
    const duration = 420;
    const startedAt = window.performance.now();

    if (Math.abs(distance) < 1) {
      tabScroll.scrollLeft = target;
      updateTabLayout();
      onDone?.();
      return;
    }

    const tick = (now: number) => {
      const progress = clamp((now - startedAt) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      tabScroll.scrollLeft = start + distance * eased;
      updateTabLayout();

      if (progress < 1) {
        tabScrollAnimationFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }

      tabScrollAnimationFrameRef.current = null;
      onDone?.();
    };

    tabScrollAnimationFrameRef.current = window.requestAnimationFrame(tick);
  };

  const getCoveredEdgesForPositions = (
    index: number,
    positions: EditorTabPosition[],
    zIndexes: number[],
  ) => {
    const position = positions[index];
    const left = position.left;
    const right = position.left + position.width;
    const coveredRanges: Array<[number, number]> = [];

    positions.forEach((other, otherIndex) => {
      if (otherIndex === index || zIndexes[otherIndex] <= zIndexes[index]) {
        return;
      }

      const overlapLeft = Math.max(left, other.left);
      const overlapRight = Math.min(right, other.left + other.width);

      if (overlapRight - overlapLeft > 0) {
        coveredRanges.push([overlapLeft - left, overlapRight - left]);
      }
    });

    if (!coveredRanges.length) {
      return { left: 0, right: 0 };
    }

    coveredRanges.sort((a, b) => a[0] - b[0]);

    const merged: Array<[number, number]> = [];

    coveredRanges.forEach((range) => {
      const last = merged[merged.length - 1];

      if (!last || range[0] > last[1]) {
        merged.push([...range]);
        return;
      }

      last[1] = Math.max(last[1], range[1]);
    });

    let coveredLeft = 0;
    let cursorLeft = 0;

    merged.forEach((range) => {
      if (range[0] <= cursorLeft) {
        coveredLeft = Math.max(coveredLeft, range[1]);
        cursorLeft = coveredLeft;
      }
    });

    let coveredRight = 0;
    let cursorRight = position.width;

    for (let index = merged.length - 1; index >= 0; index -= 1) {
      const range = merged[index];

      if (range[1] >= cursorRight) {
        coveredRight = Math.max(coveredRight, cursorRight - range[0]);
        cursorRight = range[0];
      }
    }

    return {
      left: clamp(coveredLeft, 0, position.width),
      right: clamp(coveredRight, 0, position.width),
    };
  };

  const getTabPositionsForScroll = (widths: number[], scrollLeft: number) => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      return [];
    }

    const style = window.getComputedStyle(tabScroll);
    const railPadding = Number.parseFloat(style.paddingLeft) || 0;
    const leftStackStep = Number.parseFloat(style.getPropertyValue("--tab-left-stack-step")) || 30;
    const rightStackStep = Number.parseFloat(style.getPropertyValue("--tab-stack-step")) || 20;
    const leftVisibleStackLimit = 4;
    const rightVisibleStackLimit = 6;
    const scrollMax = Math.max(0, tabScroll.scrollWidth - tabScroll.clientWidth);

    const getStackOverflow = (orderedWidths: number[], scrollOffset: number, stackStep: number, visibleStackLimit: number) => {
      let cursor = railPadding;
      let overflow = 0;

      orderedWidths.forEach((width, index) => {
        if (index >= visibleStackLimit) {
          const triggerScroll = cursor - index * stackStep;
          const rawProgress = (scrollOffset - triggerScroll) / stackStep;

          if (rawProgress > 0) {
            overflow = Math.max(overflow, index - visibleStackLimit + clamp(rawProgress, 0, 1));
          }
        }

        cursor += width;
      });

      return Math.max(0, overflow);
    };

    const reversedWidths = [...widths].reverse();
    const leftStackOverflow = getStackOverflow(widths, scrollLeft, leftStackStep, leftVisibleStackLimit);
    const rightStackOverflow = getStackOverflow(reversedWidths, scrollMax - scrollLeft, rightStackStep, rightVisibleStackLimit);
    const viewportWidth = tabScroll.clientWidth;
    let reverseCursor = railPadding;
    const rightSlots: Array<{ right: number; stickyRight: number }> = [];

    reversedWidths.forEach((width, reversedIndex) => {
      const originalIndex = widths.length - 1 - reversedIndex;
      const naturalLeft = reverseCursor - (scrollMax - scrollLeft);
      const stickyRight = (reversedIndex - rightStackOverflow) * rightStackStep;

      rightSlots[originalIndex] = {
        right: Math.max(naturalLeft, stickyRight),
        stickyRight,
      };
      reverseCursor += width;
    });

    let cursor = railPadding;

    return widths.map<EditorTabPosition>((width, index) => {
      const naturalLeft = cursor - scrollLeft;
      const naturalRight = naturalLeft + width;
      const stickyLeft = (index - leftStackOverflow) * leftStackStep;
      const rightSlot = rightSlots[index];
      const isLeftPinned = naturalLeft <= stickyLeft;
      const isRightPinned = naturalRight >= viewportWidth - rightSlot.stickyRight;
      let side: EditorTabLayout["side"] = "normal";
      let left = naturalLeft;

      if (isLeftPinned && isRightPinned) {
        side = naturalLeft + width / 2 < viewportWidth / 2 ? "left" : "right";
      } else if (isLeftPinned) {
        side = "left";
      } else if (isRightPinned) {
        side = "right";
      }

      if (side === "left") {
        left = Math.max(naturalLeft, stickyLeft);
      } else if (side === "right") {
        left = viewportWidth - width - rightSlot.right;
      }

      cursor += width;

      return { left, naturalLeft, side, stickyLeft, stickyRight: rightSlot.stickyRight, width };
    });
  };

  const getVisualCenterIndexForPositions = (positions: EditorTabPosition[]) => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      return 0;
    }

    const centerLine = tabScroll.clientWidth / 2;
    const crossingIndex = positions.findIndex(
      (position) => position.left <= centerLine && position.left + position.width >= centerLine,
    );

    if (crossingIndex >= 0) {
      return crossingIndex;
    }

    return positions.reduce((bestIndex, position, index) => {
      const center = position.left + position.width / 2;
      const best = positions[bestIndex];
      const bestCenter = best.left + best.width / 2;

      return Math.abs(center - centerLine) < Math.abs(bestCenter - centerLine) ? index : bestIndex;
    }, 0);
  };

  const getZIndexesForPositions = (positions: EditorTabPosition[]) => {
    const visualCenterIndex = getVisualCenterIndexForPositions(positions);

    return positions.map((_, index) => {
      if (index === visualCenterIndex) {
        return 10000;
      }

      if (index < visualCenterIndex) {
        return 1000 + index;
      }

      return 1000 + positions.length - index;
    });
  };

  const getTabVisibilityForPositions = (
    index: number,
    positions: EditorTabPosition[],
    railPadding: number,
    zIndexes: number[],
  ) => {
    const tabScroll = tabScrollRef.current;
    const position = positions[index];
    const previous = positions[index - 1];
    const next = positions[index + 1];
    const tolerance = 2;
    const left = position.left;
    const right = position.left + position.width;
    const visibleStart = railPadding;
    const visibleEnd = (tabScroll?.clientWidth ?? 0) - railPadding;
    const previousOverlap = previous ? Math.max(0, previous.left + previous.width - left) : 0;
    const nextOverlap = next ? Math.max(0, right - next.left) : 0;
    const coveredByPrevious = position.side === "right" ? previousOverlap : 0;
    const coveredByNext = position.side === "left" ? nextOverlap : 0;
    const coveredEdges = getCoveredEdgesForPositions(index, positions, zIndexes);

    return {
      coveredByNext,
      coveredByPrevious,
      fullyExpanded: coveredEdges.left <= tolerance && coveredEdges.right <= tolerance,
      insideContainer: left >= visibleStart - tolerance && right <= visibleEnd + tolerance,
      position,
    };
  };

  const scheduleTabLayout = () => {
    if (tabLayoutFrameRef.current !== null) {
      return;
    }

    tabLayoutFrameRef.current = window.requestAnimationFrame(() => {
      tabLayoutFrameRef.current = null;
      updateTabLayout();
    });
  };

  const scrollPreviewTabIntoView = (tabId: string) => {
    const tabScroll = tabScrollRef.current;
    const tabButton = tabButtonRefs.current[tabId];

    if (!tabScroll || !tabButton) {
      return;
    }

    const activeIndex = previewTabs.findIndex((tab) => tab.id === tabId);

    if (activeIndex < 0) {
      return;
    }

    const style = window.getComputedStyle(tabScroll);
    const railPadding = Number.parseFloat(style.paddingLeft) || 0;
    const widths = previewTabs.map((tab) => tabButtonRefs.current[tab.id]?.offsetWidth ?? 0);
    const scrollMax = Math.max(0, tabScroll.scrollWidth - tabScroll.clientWidth);
    let cursor = railPadding;
    let activeStart = railPadding;
    let activeEnd = railPadding;
    let target = tabScroll.scrollLeft;

    widths.forEach((width, index) => {
      if (index === activeIndex) {
        activeStart = cursor;
      }

      cursor += width;

      if (index === activeIndex) {
        activeEnd = cursor;
      }
    });

    const getFocusStepTarget = (scrollLeft: number) => {
      const positions = getTabPositionsForScroll(widths, scrollLeft);
      const zIndexes = getZIndexesForPositions(positions);
      const visibility = getTabVisibilityForPositions(activeIndex, positions, railPadding, zIndexes);

      if (visibility.insideContainer && visibility.fullyExpanded) {
        return scrollLeft;
      }

      if (activeStart < scrollLeft + railPadding) {
        return activeStart - railPadding;
      }

      if (activeEnd > scrollLeft + tabScroll.clientWidth - railPadding) {
        return activeEnd - tabScroll.clientWidth + railPadding;
      }

      if (visibility.coveredByNext > 2 || visibility.position.side === "left") {
        return scrollLeft - Math.max(20, visibility.coveredByNext);
      }

      if (visibility.coveredByPrevious > 2 || visibility.position.side === "right") {
        return scrollLeft + Math.max(20, visibility.coveredByPrevious);
      }

      return scrollLeft;
    };

    for (let index = 0; index < 24; index += 1) {
      const nextTarget = clamp(getFocusStepTarget(target), 0, scrollMax);

      if (Math.abs(nextTarget - target) < 0.5) {
        break;
      }

      target = nextTarget;

      const positions = getTabPositionsForScroll(widths, target);
      const zIndexes = getZIndexesForPositions(positions);
      const visibility = getTabVisibilityForPositions(activeIndex, positions, railPadding, zIndexes);

      if (visibility.insideContainer && visibility.fullyExpanded) {
        break;
      }
    }

    animateTabScrollTo(clamp(target, 0, scrollMax));
  };

  const activatePreviewTab = (tabId: string) => {
    setActivePreviewTabId(tabId);
    window.requestAnimationFrame(() => {
      scrollPreviewTabIntoView(tabId);
    });
  };

  useEffect(() => {
    setPreviewTabs((currentTabs) => {
      const existingDocumentTab = currentTabs.find((tab) => tab.id === document.id);
      const accent = existingDocumentTab?.accent ?? getTabAccent(document.id);
      const documentTab: EditorTabPreview = {
        accent,
        borderAccent: getTabBorderAccent(document.name, accent),
        id: document.id,
        name: document.name,
        path: document.path,
        dirty: isDirty || document.isUntitled,
      };

      if (!currentTabs.some((tab) => tab.id === document.id)) {
        return [...currentTabs, documentTab];
      }

      return currentTabs.map((tab) => (tab.id === document.id ? { ...tab, ...documentTab } : tab));
    });
  }, [document.id, document.isUntitled, document.name, isDirty]);

  useEffect(() => {
    setActivePreviewTabId(document.id);

    window.requestAnimationFrame(() => {
      scrollPreviewTabIntoView(document.id);
      updateTabLayout();

      viewRef.current?.focus();
    });
  }, [document.id]);

  useEffect(() => {
    const tabIds = new Set(previewTabs.map((tab) => tab.id));

    setHiddenCloseTabIds((currentIds) => {
      const nextIds = new Set([...currentIds].filter((id) => tabIds.has(id)));

      if (nextIds.size === currentIds.size) {
        return currentIds;
      }

      return nextIds;
    });
  }, [previewTabs]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      scrollPreviewTabIntoView(activePreviewTabId);
      updateTabLayout();
    });
  }, [activePreviewTabId, previewTabs]);

  useEffect(() => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      return;
    }

    updateTabLayout();
    tabScrollLeftRef.current = tabScroll.scrollLeft;

    const handleTabScroll = () => {
      const currentScrollLeft = tabScroll.scrollLeft;

      scheduleTabLayout();

      tabScrollLeftRef.current = currentScrollLeft;
    };

    tabScroll.addEventListener("scroll", handleTabScroll, { passive: true });
    window.addEventListener("resize", scheduleTabLayout);

    return () => {
      tabScroll.removeEventListener("scroll", handleTabScroll);
      window.removeEventListener("resize", scheduleTabLayout);

      if (tabLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(tabLayoutFrameRef.current);
        tabLayoutFrameRef.current = null;
      }

      cancelTabScrollAnimation();
    };
  }, [previewTabs]);

  useEffect(() => {
    if (!editingPreviewTabId) {
      return;
    }

    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [editingPreviewTabId]);
  const [scrollMetrics, setScrollMetrics] = useState<EditorScrollMetrics>(emptyEditorScrollMetrics);
  const [highlightWarning, setHighlightWarning] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const parent = editorElementRef.current;
    const frame = editorFrameRef.current;

    if (!parent || !frame) {
      return;
    }

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: document.content,
        extensions: createCodeMirrorExtensions(
          languageCompartmentRef.current,
          document,
          (content) => onChangeRef.current(content),
        ),
      }),
    });

    viewRef.current = view;
    scrollDOMRef.current = view.scrollDOM;
    setHighlightWarning(null);

    let isCurrentDocument = true;

    const mode =
      document.mode === "large-readonly" ||
      (typeof document.size === "number" && document.size > FULL_LANGUAGE_PARSER_SIZE_LIMIT_BYTES)
        ? ({ kind: "plain-text", label: "Plain Text", reason: "large-file" } as const)
        : resolveHighlightMode(document);

    loadHighlightExtensions(mode)
      .then((extensions) => {
        if (!isCurrentDocument || viewRef.current !== view) {
          return;
        }

        setHighlightWarning(null);
        view.dispatch({
          effects: languageCompartmentRef.current.reconfigure(extensions),
        });
      })
      .catch((highlightError) => {
        if (!isCurrentDocument || viewRef.current !== view) {
          return;
        }

        setHighlightWarning(
          `Syntax highlighting for ${mode.label} could not be loaded. Showing plain text instead.`,
        );
        view.dispatch({
          effects: languageCompartmentRef.current.reconfigure([]),
        });
        console.warn("Failed to load editor highlighting", highlightError);
      });

    let animationFrame: number | null = null;

    const readScrollMetrics = () => {
      const gutterElement = view.scrollDOM.querySelector(".cm-gutters") as HTMLElement | null;
      const frameRect = frame.getBoundingClientRect();

      return {
        clientHeight: view.scrollDOM.clientHeight,
        clientWidth: view.scrollDOM.clientWidth,
        gutterWidth: gutterElement?.getBoundingClientRect().width ?? emptyEditorScrollMetrics.gutterWidth,
        scrollHeight: view.scrollDOM.scrollHeight,
        scrollLeft: view.scrollDOM.scrollLeft,
        scrollTop: view.scrollDOM.scrollTop,
        scrollWidth: view.scrollDOM.scrollWidth,
        shellHeight: frameRect.height,
        shellWidth: frameRect.width,
      };
    };

    const updateScrollMetrics = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        setScrollMetrics(readScrollMetrics());
      });
    };

    view.dispatch({
      effects: StateEffect.appendConfig.of(EditorView.updateListener.of(updateScrollMetrics)),
    });

    const resizeObserver = new ResizeObserver(updateScrollMetrics);
    resizeObserver.observe(frame);
    resizeObserver.observe(view.scrollDOM);
    resizeObserver.observe(view.contentDOM);

    const gutterElement = view.scrollDOM.querySelector(".cm-gutters");

    if (gutterElement) {
      resizeObserver.observe(gutterElement);
    }

    const mutationObserver = new MutationObserver(updateScrollMetrics);
    mutationObserver.observe(parent, { childList: true, characterData: true, subtree: true });

    view.scrollDOM.addEventListener("scroll", updateScrollMetrics, { passive: true });
    updateScrollMetrics();

    return () => {
      isCurrentDocument = false;

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }

      resizeObserver.disconnect();
      mutationObserver.disconnect();
      view.scrollDOM.removeEventListener("scroll", updateScrollMetrics);
      view.destroy();
      viewRef.current = null;
      scrollDOMRef.current = null;
    };
  }, [document.id, document.name]);

  const setScrollPosition = (orientation: EditorScrollbarOrientation, value: number) => {
    const scrollDOM = scrollDOMRef.current;

    if (!scrollDOM) {
      return;
    }

    if (orientation === "horizontal") {
      scrollDOM.scrollLeft = value;
      return;
    }

    scrollDOM.scrollTop = value;
  };

  const handleScrollbarTrackPointerDown = (
    orientation: EditorScrollbarOrientation,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    const geometry = getEditorScrollbarGeometry(orientation, scrollMetrics);

    if (!geometry) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerPosition = orientation === "horizontal" ? event.clientX - rect.left : event.clientY - rect.top;
    const pageSize =
      orientation === "horizontal"
        ? Math.max(1, scrollMetrics.clientWidth - scrollMetrics.gutterWidth)
        : Math.max(1, scrollMetrics.clientHeight);
    const direction = pointerPosition < geometry.thumbOffset ? -1 : 1;

    event.preventDefault();
    setScrollPosition(orientation, clamp(geometry.scrollPosition + direction * pageSize, 0, geometry.maxScroll));
  };

  const handleScrollbarThumbPointerDown = (
    orientation: EditorScrollbarOrientation,
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    const geometry = getEditorScrollbarGeometry(orientation, scrollMetrics);

    if (!geometry) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    dragRef.current = {
      maxScroll: geometry.maxScroll,
      orientation,
      pointerStart: orientation === "horizontal" ? event.clientX : event.clientY,
      scrollStart: geometry.scrollPosition,
      thumbSize: geometry.thumbSize,
      trackSize: geometry.trackSize,
    };

    const handlePointerMove = (pointerEvent: globalThis.PointerEvent) => {
      const drag = dragRef.current;

      if (!drag) {
        return;
      }

      const pointerPosition = drag.orientation === "horizontal" ? pointerEvent.clientX : pointerEvent.clientY;
      const draggableSize = Math.max(1, drag.trackSize - drag.thumbSize);
      const scrollDelta = ((pointerPosition - drag.pointerStart) / draggableSize) * drag.maxScroll;

      setScrollPosition(drag.orientation, clamp(drag.scrollStart + scrollDelta, 0, drag.maxScroll));
    };

    const handlePointerUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <section className="editor-surface-panel flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-[hsl(var(--editor-background))]">
      <div
        className={cn(
          "editor-file-tabs",
          tabOverflow.left && "editor-file-tabs-has-left",
          tabOverflow.right && "editor-file-tabs-has-right",
        )}
        role="tablist"
        aria-label="Open files"
      >
        <div className="editor-file-tabs-scroll" ref={tabScrollRef}>
          {previewTabs.map((tab) => {
            const active = tab.id === activePreviewTabId;
            const editing = tab.id === editingPreviewTabId;
            const layout = tabLayouts[tab.id];
            const isLeftStacked = (layout?.hideRight ?? 0) > 0;
            const hideCloseButton = isLeftStacked || hiddenCloseTabIds.has(tab.id);
            const { className: tabIconClassName, Icon: TabIcon } = getFileTreeIcon({
              kind: "file",
              name: tab.name,
              path: tab.name,
              relativePath: tab.name,
            });
            const tabStyle = {
              "--editor-tab-accent": tab.accent,
              "--editor-tab-border-accent": tab.borderAccent,
              "--hide-left": `${layout?.hideLeft ?? 0}%`,
              "--hide-right": `${layout?.hideRight ?? 0}%`,
              "--sticky-left": `${layout?.stickyLeft ?? 0}px`,
              "--sticky-right": `${layout?.stickyRight ?? 0}px`,
              zIndex: layout?.zIndex,
            } as CSSProperties;

            return (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "editor-file-tab",
                      active && "editor-file-tab-active",
                      layout?.side !== "right" && "editor-file-tab-left-sticky",
                      layout?.side === "right" && "editor-file-tab-right-sticky",
                      (layout?.hideLeft ?? 0) > 0 && "editor-file-tab-right-stacked",
                      (layout?.hideRight ?? 0) > 0 && "editor-file-tab-left-stacked",
                    )}
                    ref={(element) => {
                      tabButtonRefs.current[tab.id] = element;
                    }}
                    style={tabStyle}
                    role="tab"
                    aria-selected={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => activatePreviewTab(tab.id)}
                    onDoubleClick={() => {
                      activatePreviewTab(tab.id);
                      setEditingPreviewTabId(tab.id);
                      setEditingPreviewTabName(tab.name);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activatePreviewTab(tab.id);
                      }
                    }}
                  >
                    <TabIcon className={cn("editor-file-tab-icon", tabIconClassName)} aria-hidden="true" />
                    {editing ? (
                      <input
                        ref={renameInputRef}
                        className="editor-file-tab-input"
                        value={editingPreviewTabName}
                        onChange={(event) => setEditingPreviewTabName(event.target.value)}
                        onBlur={commitPreviewTabName}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitPreviewTabName();
                          }

                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingPreviewTabId(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="truncate">{tab.name}</span>
                    )}
                    {!editing ? (
                      <span className={cn("editor-file-tab-trailing", hideCloseButton && "editor-file-tab-trailing-hidden")}>
                        <span className="editor-file-tab-dirty" aria-hidden={!tab.dirty}>
                          {tab.dirty ? "•" : ""}
                        </span>
                        <button
                          className="editor-file-tab-close"
                          aria-label={`Close ${tab.name}`}
                          title={`Close ${tab.name}`}
                          type="button"
                          tabIndex={hideCloseButton ? -1 : 0}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();

                            if (!hideCloseButton) {
                              closePreviewTab(tab.id);
                            }
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ) : null}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="editor-file-tab-tooltip" side="bottom" align="start" sideOffset={8}>
                  <div className="editor-file-tab-tooltip-path">{tab.path}</div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <button className="editor-file-tab-add" type="button" aria-label="Add test tab" title="Add test tab" onClick={addPreviewTab}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive">
          {error}
        </div>
      ) : null}
      {highlightWarning ? (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-700 dark:text-amber-300">
          {highlightWarning}
        </div>
      ) : null}
      {document.mode === "large-readonly" ? (
        <div className="border-b border-border bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground">
          Large file browsing mode{document.size ? ` (${formatFileSize(document.size)})` : ""}. This view is read-only and shows a loaded text range.
        </div>
      ) : null}
      <div className="codemirror-shell-frame min-h-0 flex-1" ref={editorFrameRef}>
        <div className="codemirror-shell min-h-0 flex-1" ref={editorElementRef} />
        <EditorScrollbar
          metrics={scrollMetrics}
          orientation="vertical"
          onThumbPointerDown={handleScrollbarThumbPointerDown}
          onTrackPointerDown={handleScrollbarTrackPointerDown}
        />
        <EditorScrollbar
          metrics={scrollMetrics}
          orientation="horizontal"
          onThumbPointerDown={handleScrollbarThumbPointerDown}
          onTrackPointerDown={handleScrollbarTrackPointerDown}
        />
      </div>
    </section>
  );
}

function EditorScrollbar({
  metrics,
  orientation,
  onThumbPointerDown,
  onTrackPointerDown,
}: {
  metrics: EditorScrollMetrics;
  orientation: EditorScrollbarOrientation;
  onThumbPointerDown: (orientation: EditorScrollbarOrientation, event: ReactPointerEvent<HTMLSpanElement>) => void;
  onTrackPointerDown: (orientation: EditorScrollbarOrientation, event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const geometry = getEditorScrollbarGeometry(orientation, metrics);
  const hasVerticalScrollbar = metrics.scrollHeight - metrics.clientHeight > 1;

  if (!geometry) {
    return null;
  }

  return (
    <div
      aria-orientation={orientation}
      aria-valuemax={Math.round(geometry.maxScroll)}
      aria-valuemin={0}
      aria-valuenow={Math.round(geometry.scrollPosition)}
      className={cn("editor-scrollbar", `editor-scrollbar-${orientation}`)}
      role="scrollbar"
      style={
        orientation === "horizontal"
          ? {
              bottom: 0,
              height: EDITOR_SCROLLBAR_SIZE,
              left: metrics.gutterWidth,
              right: hasVerticalScrollbar ? EDITOR_SCROLLBAR_SIZE : 0,
            }
          : {
              bottom: 0,
              right: 0,
              top: 0,
              width: EDITOR_SCROLLBAR_SIZE,
            }
      }
      tabIndex={-1}
      onPointerDown={(event) => onTrackPointerDown(orientation, event)}
    >
      <span
        className="editor-scrollbar-thumb"
        style={
          orientation === "horizontal"
            ? { left: geometry.thumbOffset, width: geometry.thumbSize }
            : { height: geometry.thumbSize, top: geometry.thumbOffset }
        }
        onPointerDown={(event) => onThumbPointerDown(orientation, event)}
      />
    </div>
  );
}

function GitPanel() {
  return (
    <aside className="git-surface-panel frosted-surface frosted-surface-raised min-h-0 min-w-0 overflow-hidden shadow-[-10px_0_18px_-18px_rgba(15,23,42,0.75)]">
      <div className="flex h-full w-full min-h-0 flex-col">
        <div className="panel-heading">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Git</div>
            <div className="font-semibold">Changes</div>
          </div>
          <Badge tone="warning">ahead 1</Badge>
        </div>
        <div className="grid grid-cols-3 gap-1 border-b border-border/80 p-2">
          <Summary label="Working" value="4" />
          <Summary label="Staged" value="1" />
          <Summary label="Remote" value="+1" />
        </div>
        <div className="border-b border-border/80 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <GitBranch className="h-4 w-4 text-primary" />
              <div className="min-w-0">
                <div className="truncate font-medium">main</div>
                <div className="truncate text-[11px] text-muted-foreground">origin/main - 1 commit ready to push</div>
              </div>
            </div>
            <Button size="sm" variant="ghost">
              Switch
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-2">
            {changes.map((change) => (
              <div
                className="grid grid-cols-[20px_minmax(0,1fr)_52px] items-center gap-2 rounded-sm border border-border/75 bg-white/20 p-2 dark:bg-black/10"
                key={change.path}
              >
                {change.staged ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <CircleDot className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px]">{change.path}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {change.status} - {change.description}
                  </div>
                </div>
                <Button size="sm" variant={change.staged ? "ghost" : "default"}>
                  {change.staged ? "Unstage" : "Stage"}
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t border-border/80 bg-white/14 p-2 dark:bg-black/5">
          <Textarea placeholder="Commit message, for example: wire up file open" />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Review staged files before committing.</span>
            <Button size="sm" variant="primary">
              Commit staged
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-border/75 bg-white/16 px-2 py-1.5 dark:bg-black/5">
      <div className="font-mono text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function StatusBar({
  document,
  isDirty,
  onOpenSettings,
  saveState,
}: {
  document: WorkbenchDocument;
  isDirty: boolean;
  onOpenSettings: () => void;
  saveState: SaveState;
}) {
  const lineCount = getDocumentLines(document).length;
  const saveLabel =
    document.mode === "large-readonly"
      ? "Read-only"
      : saveState === "saving"
        ? "Saving..."
        : saveState === "error"
          ? "Save failed"
          : isDirty || document.isUntitled
            ? "Unsaved"
            : "Saved";

  return (
    <footer className="frosted-surface flex h-6 shrink-0 items-center justify-between border-t border-border px-2">
      <div className="flex min-w-0 items-center gap-3">
        <span className="status-token truncate">{document.path}</span>
        <span className="status-token">{lineCount} lines</span>
        {document.size ? <span className="status-token">{formatFileSize(document.size)}</span> : null}
        <span className="status-token">UTF-8</span>
        <span className="status-token">LF</span>
        {document.mode === "large-readonly" ? <span className="status-token">Read-only range</span> : null}
        <span className="status-token">{saveLabel}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="status-token">
          <GitPullRequest className="h-3 w-3" />
          main
        </span>
        <span className="status-token">4 modified</span>
        <span className="status-token">
          <Terminal className="h-3 w-3" />
          Tauri 2
        </span>
        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onOpenSettings}>
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </footer>
  );
}

function SettingsDialog({ onOpenChange, open }: { onOpenChange: (open: boolean) => void; open: boolean }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置 mock</DialogTitle>
          <DialogDescription>
            这里先固定技术栈与 UI 约束，后续再接入真实配置读写。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-[12px]">
          <label className="grid gap-1">
            <span className="text-muted-foreground">Keymap</span>
            <Input value="JetBrains compatible" readOnly />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Editor</span>
            <Input value="CodeMirror 6" readOnly />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">Workspace Rail</span>
            <Input value="Light edge rail" readOnly />
          </label>
        </div>
        <DialogFooter>
          <Button variant="primary">完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
