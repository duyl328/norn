import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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
  ClipboardPaste,
  Copy,
  Database,
  FileArchive,
  FileCode,
  FileCog,
  FilePlus,
  FileJson,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  FolderPlus,
  FolderOpen,
  Image,
  Link2,
  Menu,
  Minus,
  Pencil,
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
  Scissors,
  Terminal,
  Trash2,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

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
import { TooltipProvider } from "@/components/ui/tooltip";
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

type ScratchFolder = {
  name: string;
  path: string;
};

type ScratchFolderView = {
  nodes: FileTreeNode[];
  expanded: boolean;
  loading: boolean;
  loadingPath: string | null;
  error: string | null;
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
  isHidden?: boolean;
  isSymlink?: boolean;
  targetKind?: "file" | "directory" | null;
  canonicalPath?: string | null;
  isReadonly?: boolean;
  error?: string | null;
};

type FolderView = {
  rootPath: string;
  rootName: string;
  origin: "open-folder" | "containing-folder";
  nodes: FileTreeNode[];
  rootExpanded: boolean;
  loadingPath: string | null;
  error: string | null;
};

type FileTreeNode = {
  name: string;
  path: string;
  relativePath: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
  isHidden?: boolean;
  isSymlink?: boolean;
  targetKind?: "file" | "directory" | null;
  canonicalPath?: string | null;
  isReadonly?: boolean;
  children?: FileTreeNode[];
  childrenLoaded?: boolean;
  expanded?: boolean;
  error?: string;
};

type FileTreeClipboard = {
  action: "copy" | "cut";
  node: FileTreeNode;
};

type FileTreeNameDialog =
  | { kind: "create-file"; parentPath: string; scope?: "main" | "scratch" }
  | { kind: "create-directory"; parentPath: string; scope?: "main" | "scratch" }
  | { kind: "rename"; node: FileTreeNode; scope?: "main" | "scratch" };

type FileTreeContextMenuState = {
  node: FileTreeNode | null;
  scope: "main" | "scratch";
  x: number;
  y: number;
};

type FileTreeTrashTarget = {
  node: FileTreeNode;
  scope: "main" | "scratch";
};

type TreeDropTarget = {
  path: string;
  scope: "main" | "scratch";
};

type TreePanelView = {
  error: string | null;
  loadingPath: string | null;
  nodes: FileTreeNode[];
  rootExpanded: boolean;
  rootName: string;
  rootPath: string;
};

type VisibleTreeRow = {
  depth: number;
  ancestorCanonicalPaths: string[];
  node: FileTreeNode;
};

type NativeFileOperationError = {
  kind?: string;
  message?: string;
};

type NativeDragDropPayload = {
  paths?: string[];
  position?: { x: number; y: number };
  type: "enter" | "over" | "drop" | "leave" | "cancel";
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
  isHidden: Boolean(entry.isHidden),
  isSymlink: Boolean(entry.isSymlink),
  targetKind: entry.targetKind ?? null,
  canonicalPath: entry.canonicalPath ?? null,
  isReadonly: Boolean(entry.isReadonly),
  children: entry.kind === "directory" ? [] : undefined,
  childrenLoaded: false,
  expanded: false,
  error: entry.error ?? undefined,
});

const collapseTreeNodeDeep = (node: FileTreeNode): FileTreeNode => ({
  ...node,
  expanded: false,
  children: node.children?.map(collapseTreeNodeDeep),
});

const collapseTreeNodesDeep = (nodes: FileTreeNode[]) => nodes.map(collapseTreeNodeDeep);

const mergeTreeNodeState = (node: FileTreeNode, previousNode?: FileTreeNode): FileTreeNode => {
  if (!previousNode || node.kind !== "directory") {
    return node;
  }

  return {
    ...node,
    children: previousNode.childrenLoaded ? previousNode.children : node.children,
    childrenLoaded: previousNode.childrenLoaded,
    expanded: previousNode.expanded,
    error: node.error,
  };
};

const mergeTreeNodesState = (nodes: FileTreeNode[], previousNodes: FileTreeNode[]) =>
  nodes.map((node) => mergeTreeNodeState(node, previousNodes.find((previousNode) => previousNode.path === node.path)));

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

const flattenVisibleTreeRows = (
  nodes: FileTreeNode[],
  depth = 0,
  ancestorCanonicalPaths: string[] = [],
): VisibleTreeRow[] =>
  nodes.flatMap((node) => {
    const row: VisibleTreeRow = { depth, ancestorCanonicalPaths, node };
    const nodeCanonicalPath = node.canonicalPath ?? node.path;
    const nextAncestors =
      node.kind === "directory" ? [...ancestorCanonicalPaths, nodeCanonicalPath] : ancestorCanonicalPaths;

    if (node.kind !== "directory" || !node.expanded || !node.children) {
      return [row];
    }

    return [row, ...flattenVisibleTreeRows(node.children, depth + 1, nextAncestors)];
  });

const isPathInsideOrEqual = (path: string, possibleParent: string) => {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedParent = possibleParent.replace(/\\/g, "/").replace(/\/+$/, "");

  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
};

const getNativeFileOperationError = (error: unknown): NativeFileOperationError => {
  if (error && typeof error === "object") {
    return error as NativeFileOperationError;
  }

  return { message: error instanceof Error ? error.message : String(error) };
};

const getTreeDropTargetFromPoint = (position?: { x: number; y: number }): TreeDropTarget | null => {
  if (!position) {
    return null;
  }

  const element = globalThis.document.elementFromPoint(position.x, position.y);
  const dropTarget = element?.closest<HTMLElement>("[data-tree-drop-path]");
  const path = dropTarget?.dataset.treeDropPath;
  const scope = dropTarget?.dataset.treeDropScope;

  if (!path || (scope !== "main" && scope !== "scratch")) {
    return null;
  }

  return { path, scope };
};

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
  closable?: boolean;
  id: string;
  name: string;
  dirty?: boolean;
};

type TabFoldStacks = {
  left: EditorTabPreview[];
  right: EditorTabPreview[];
};

const initialDocument: WorkbenchDocument = {
  id: "mock-workbench-page",
  name: "workbench-page.tsx",
  path: "src/features/workbench/workbench-page.tsx",
  content: editorLines.join("\n"),
  savedContent: editorLines.join("\n"),
  mode: "editable",
};

const createUntitledDocument = (): WorkbenchDocument => ({
  id: createDocumentId("untitled"),
  name: "Untitled.txt",
  path: "Untitled.txt",
  content: "",
  savedContent: "",
  isUntitled: true,
  mode: "editable",
});

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

const isDocumentDirty = (document: WorkbenchDocument) => document.content !== document.savedContent;

const upsertOpenDocument = (documents: WorkbenchDocument[], nextDocument: WorkbenchDocument) => {
  const existingIndex = documents.findIndex((document) => document.id === nextDocument.id);

  if (existingIndex === -1) {
    return [...documents, nextDocument];
  }

  return documents.map((document, index) => (index === existingIndex ? nextDocument : document));
};

export function WorkbenchPage() {
  const [document, setDocument] = useState<WorkbenchDocument>(initialDocument);
  const [openDocuments, setOpenDocuments] = useState<WorkbenchDocument[]>([initialDocument]);
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(leftPanelDefaultWidth);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(rightPanelDefaultWidth);
  const [resizingPanel, setResizingPanel] = useState<"left" | "right" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [folderView, setFolderView] = useState<FolderView | null>(null);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>(() => loadRecentFolders());
  const [scratchFolder, setScratchFolder] = useState<ScratchFolder | null>(null);
  const [scratchFolderView, setScratchFolderView] = useState<ScratchFolderView>({
    nodes: [],
    expanded: true,
    loading: false,
    loadingPath: null,
    error: null,
  });
  const [pendingCloseDocument, setPendingCloseDocument] = useState<WorkbenchDocument | null>(null);
  const [saveConflict, setSaveConflict] = useState<SaveConflict | null>(null);
  const [fileTreeClipboard, setFileTreeClipboard] = useState<FileTreeClipboard | null>(null);
  const [fileTreeContextMenu, setFileTreeContextMenu] = useState<FileTreeContextMenuState | null>(null);
  const [fileTreeNameDialog, setFileTreeNameDialog] = useState<FileTreeNameDialog | null>(null);
  const [fileTreeNameValue, setFileTreeNameValue] = useState("");
  const [fileTreeTrashTarget, setFileTreeTrashTarget] = useState<FileTreeTrashTarget | null>(null);
  const [draggedTreeNode, setDraggedTreeNode] = useState<FileTreeNode | null>(null);
  const [dropTarget, setDropTarget] = useState<TreeDropTarget | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [searchOpen, setSearchOpen] = useState(false);
  const dropTargetRef = useRef<TreeDropTarget | null>(null);
  const diskChangePromptRef = useRef<string | null>(null);
  const showWindowsTitlebar = useMemo(() => navigator.userAgent.includes("Windows") && isTauriRuntime(), []);
  const showMacTitlebar = useMemo(() => navigator.userAgent.includes("Mac") && isTauriRuntime(), []);
  const isDirty = isDocumentDirty(document);

  const activateDocument = (nextDocument: WorkbenchDocument) => {
    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));
    setSaveConflict(null);
    setSaveState("saved");
  };

  const closeDocument = (targetDocument: WorkbenchDocument) => {
    const nextDocuments = openDocuments.filter((openDocument) => openDocument.id !== targetDocument.id);

    if (nextDocuments.length === 0) {
      const nextDocument = createUntitledDocument();
      setOpenDocuments([nextDocument]);
      setDocument(nextDocument);
      setSaveConflict(null);
      setSaveState("idle");
      return;
    }

    setOpenDocuments(nextDocuments);

    if (targetDocument.id === document.id) {
      const closedIndex = openDocuments.findIndex((openDocument) => openDocument.id === targetDocument.id);
      const nextDocument = nextDocuments[Math.max(0, Math.min(closedIndex, nextDocuments.length - 1))];
      setDocument(nextDocument);
      setSaveConflict(null);
      setSaveState("saved");
    }
  };

  const requestCloseDocument = (targetDocument: WorkbenchDocument) => {
    if (isDocumentDirty(targetDocument) || targetDocument.isUntitled) {
      setPendingCloseDocument(targetDocument);
      return;
    }

    closeDocument(targetDocument);
  };

  const saveAndClosePendingDocument = async () => {
    const targetDocument = pendingCloseDocument;

    if (!targetDocument) {
      return;
    }

    activateDocument(targetDocument);
    const savedDocument = await saveDocument();

    if (!savedDocument) {
      return;
    }

    setPendingCloseDocument(null);
    closeDocument(savedDocument);
  };

  const saveAsAndClosePendingDocument = async () => {
    const targetDocument = pendingCloseDocument;

    if (!targetDocument) {
      return;
    }

    activateDocument(targetDocument);
    const savedDocument = await saveDocumentAs(targetDocument.content);

    if (!savedDocument) {
      return;
    }

    setPendingCloseDocument(null);
    closeDocument(savedDocument);
  };

  const createFile = () => {
    setFileError(null);
    setLeftPanelOpen(false);
    setFolderView(null);
    setSaveConflict(null);
    setSaveState("idle");
    activateDocument(createUntitledDocument());
  };

  const applySavedDocument = (savedFile: NativeSavedTextFile, content: string): WorkbenchDocument => {
    const nextDocument = {
      ...document,
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
    } satisfies WorkbenchDocument;

    setDocument(nextDocument);
    setOpenDocuments((currentDocuments) => {
      const withoutPreviousDocument = currentDocuments.filter((openDocument) => openDocument.id !== document.id);

      return upsertOpenDocument(withoutPreviousDocument, nextDocument);
    });
    setSaveConflict(null);
    setSaveState("saved");
    setFileError(null);

    return nextDocument;
  };

  const saveDocumentAs = async (contentOverride?: string): Promise<WorkbenchDocument | null> => {
    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError("Large files are opened in read-only browsing mode and cannot be saved yet.");
      return null;
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError("Native saving is only available in the Tauri desktop app.");
      return null;
    }

    try {
      const path = await invoke<string | null>("open_save_dialog", { defaultName: document.name });

      if (!path) {
        setSaveState(document.content !== document.savedContent ? "idle" : "saved");
        return null;
      }

      const content = contentOverride ?? document.content;
      setSaveState("saving");
      setFileError(null);

      const savedFile = await invoke<NativeSavedTextFile>("save_text_file_as", {
        path,
        content,
      });

      return applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);
      setSaveState("error");
      setFileError(saveError.message ?? "Unable to save this file.");
      return null;
    }
  };

  const saveDocument = async (options: { force?: boolean } = {}): Promise<WorkbenchDocument | null> => {
    if (saveState === "saving") {
      return null;
    }

    if (document.mode === "large-readonly") {
      setSaveState("error");
      setFileError("Large files are opened in read-only browsing mode and cannot be saved yet.");
      return null;
    }

    if (document.isUntitled || !isAbsolutePath(document.path)) {
      return await saveDocumentAs();
    }

    if (!isTauriRuntime()) {
      setSaveState("error");
      setFileError("Native saving is only available in the Tauri desktop app.");
      return null;
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

      return applySavedDocument(savedFile, content);
    } catch (error) {
      const saveError = getNativeSaveError(error);

      if (saveError.kind === "deleted") {
        setSaveState("idle");
        setFileError(saveError.message ?? "The original file was deleted. Choose a new location to save it.");
        return await saveDocumentAs(content);
      }

      if (saveError.kind === "modified") {
        setSaveState("idle");
        setSaveConflict({
          content,
          lastModified: document.lastModified,
          message: saveError.message ?? "This file was changed outside Norn.",
          path: document.path,
        });
        return null;
      }

      setSaveState("error");
      setFileError(saveError.message ?? "Unable to save this file.");
      return null;
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

  const checkCurrentDocumentOnDisk = async () => {
    if (
      !isTauriRuntime() ||
      saveConflict ||
      saveState === "saving" ||
      document.isUntitled ||
      document.mode !== "editable" ||
      !isAbsolutePath(document.path)
    ) {
      return;
    }

    try {
      const inspection = await invoke<NativeTextFileInspection>("inspect_text_file", { path: document.path });
      const diskLastModified = inspection.lastModified ?? undefined;

      if (!diskLastModified || !document.lastModified || diskLastModified === document.lastModified) {
        diskChangePromptRef.current = null;
        return;
      }

      const promptKey = `${document.path}-${diskLastModified}-${document.lastModified}`;

      if (diskChangePromptRef.current === promptKey) {
        return;
      }

      diskChangePromptRef.current = promptKey;
      setSaveState("idle");
      setSaveConflict({
        content: document.content,
        lastModified: document.lastModified,
        message: isDirty
          ? "This file changed on disk while you also have local edits. Choose which version to keep."
          : "This file changed on disk. Reload to use the latest disk version, or keep the current editor version.",
        path: document.path,
      });
    } catch {
      // The next explicit save/open action will surface deleted or unreadable files with a targeted error.
    }
  };

  const readFolderEntries = async (path: string) => {
    const entries = await invoke<NativeDirectoryEntry[]>("list_directory", { path });

    return entries.map(toFileTreeNode);
  };

  const setFileTreeError = (error: unknown, fallback: string) => {
    const operationError = getNativeFileOperationError(error);
    setFileError(operationError.message ?? fallback);
  };

  const refreshFolderPath = async (
    path: string,
    options: { collapseChildren?: boolean; preserveExpansion?: boolean; silent?: boolean } = {},
  ) => {
    if (!folderView) {
      return;
    }

    const collapseChildren = options.collapseChildren ?? true;
    const preserveExpansion = options.preserveExpansion ?? false;

    if (!options.silent) {
      setFolderView((currentView) => (currentView ? { ...currentView, loadingPath: path, error: null } : currentView));
    }

    try {
      const children = await readFolderEntries(path);
      const nextChildren = collapseChildren ? collapseTreeNodesDeep(children) : children;

      setFolderView((currentView) => {
        if (!currentView) {
          return currentView;
        }

        if (path === currentView.rootPath) {
          return {
            ...currentView,
            nodes: preserveExpansion ? mergeTreeNodesState(nextChildren, currentView.nodes) : nextChildren,
            loadingPath: null,
            error: null,
          };
        }

        return {
          ...currentView,
          loadingPath: null,
          error: null,
          nodes: updateTreeNode(currentView.nodes, path, (currentNode) => ({
            ...currentNode,
            children: preserveExpansion ? mergeTreeNodesState(nextChildren, currentNode.children ?? []) : nextChildren,
            childrenLoaded: true,
            expanded: preserveExpansion ? currentNode.expanded : true,
            error: undefined,
          })),
        };
      });
    } catch (error) {
      setFolderView((currentView) => {
        if (!currentView) {
          return currentView;
        }

        if (path === currentView.rootPath) {
          return {
            ...currentView,
            loadingPath: null,
            error: error instanceof Error ? error.message : String(error),
          };
        }

        return {
          ...currentView,
          loadingPath: null,
          nodes: updateTreeNode(currentView.nodes, path, (currentNode) => ({
            ...currentNode,
            childrenLoaded: true,
            expanded: true,
            error: error instanceof Error ? error.message : String(error),
          })),
        };
      });
    }
  };

  const refreshNodeParent = async (node: FileTreeNode, scope: "main" | "scratch" = "main") => {
    if (scope === "scratch") {
      await refreshScratchFolder();
      return;
    }

    if (folderView) {
      await refreshFolderPath(getParentPath(node.path) ?? folderView.rootPath);
    }
  };

  const openNativeFile = async (path: string, options: { clearFolderView?: boolean; size?: number } = {}) => {
    const { clearFolderView = false, size } = options;

    setFileError(null);
    setSaveConflict(null);

    try {
      const openDocument = openDocuments.find((currentDocument) => currentDocument.path === path);

      if (openDocument) {
        activateDocument(openDocument);

        if (clearFolderView) {
          setFolderView(null);
          setLeftPanelOpen(false);
        }

        return;
      }

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

        activateDocument({
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

      activateDocument({
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
    void continueFileOpen(pendingOpen);
  };

  const openFilePicker = () => {
    requestFileOpen({ kind: "file-dialog" });
  };

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

  const loadScratchFolderEntries = async (
    folder: ScratchFolder,
    options: { collapseChildren?: boolean; expand?: boolean; path?: string } = {},
  ) => {
    const path = options.path ?? folder.path;
    const expand = options.expand ?? true;
    const collapseChildren = options.collapseChildren ?? true;

    setScratchFolderView((currentView) => ({
      ...currentView,
      expanded: path === folder.path ? expand : currentView.expanded,
      loading: true,
      loadingPath: path,
      error: null,
    }));

    try {
      const children = await readFolderEntries(path);
      const nextChildren = collapseChildren ? collapseTreeNodesDeep(children) : children;
      setScratchFolderView((currentView) => ({
        ...currentView,
        nodes:
          path === folder.path
            ? nextChildren
            : updateTreeNode(currentView.nodes, path, (currentNode) => ({
                ...currentNode,
                children: nextChildren,
                childrenLoaded: true,
                expanded: true,
                error: undefined,
              })),
        expanded: path === folder.path ? expand : currentView.expanded,
        loading: false,
        loadingPath: null,
        error: null,
      }));
    } catch (error) {
      setScratchFolderView((currentView) => ({
        ...currentView,
        loading: false,
        loadingPath: null,
        nodes:
          path === folder.path
            ? currentView.nodes
            : updateTreeNode(currentView.nodes, path, (currentNode) => ({
                ...currentNode,
                childrenLoaded: true,
                expanded: true,
                error: error instanceof Error ? error.message : String(error),
              })),
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const ensureScratchFolder = async () => {
    if (!isTauriRuntime()) {
      setFileError("Scratch folders are only available in the Tauri desktop app.");
      return null;
    }

    try {
      const folder = scratchFolder ?? (await invoke<ScratchFolder>("scratch_folder"));
      setScratchFolder(folder);
      return folder;
    } catch (error) {
      setFileError(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const refreshScratchFolder = async () => {
    const folder = await ensureScratchFolder();

    if (folder) {
      await loadScratchFolderEntries(folder);
    }
  };

  const refreshTreePath = async (scope: "main" | "scratch", path: string) => {
    if (scope === "scratch") {
      const folder = await ensureScratchFolder();

      if (folder) {
        await loadScratchFolderEntries(folder, { path });
      }
      return;
    }

    await refreshFolderPath(path);
  };

  const toggleScratchRootDirectory = () => {
    setScratchFolderView((currentView) => {
      if (currentView.expanded) {
        return {
          ...currentView,
          expanded: false,
          nodes: collapseTreeNodesDeep(currentView.nodes),
        };
      }

      return {
        ...currentView,
        expanded: true,
      };
    });
  };

  const toggleScratchDirectory = async (node: FileTreeNode) => {
    if (node.kind !== "directory") {
      return;
    }

    if (node.expanded) {
      setScratchFolderView((currentView) => ({
        ...currentView,
        nodes: updateTreeNode(currentView.nodes, node.path, (currentNode) => collapseTreeNodeDeep(currentNode)),
      }));
      return;
    }

    if (node.childrenLoaded) {
      setScratchFolderView((currentView) => ({
        ...currentView,
        nodes: updateTreeNode(currentView.nodes, node.path, (currentNode) => ({
          ...currentNode,
          expanded: true,
          children: collapseTreeNodesDeep(currentNode.children ?? []),
        })),
      }));
      return;
    }

    const folder = await ensureScratchFolder();

    if (folder) {
      await loadScratchFolderEntries(folder, { path: node.path });
    }
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
      nodes: [],
      rootExpanded: true,
      loadingPath: rootPath,
      error: null,
    });

    try {
      const nodes = await readFolderEntries(rootPath);

      setFolderView({
        rootPath,
        rootName: getPathName(rootPath),
        origin,
        nodes,
        rootExpanded: true,
        loadingPath: null,
        error: null,
      });
      rememberRecentFolder(rootPath);
    } catch (error) {
      setFolderView({
        rootPath,
        rootName: getPathName(rootPath),
        origin,
        nodes: [],
        rootExpanded: true,
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

  const toggleDirectory = async (node: FileTreeNode) => {
    if (!folderView || node.kind !== "directory") {
      return;
    }

    if (node.childrenLoaded) {
      setFolderView((currentView) =>
        currentView
          ? {
              ...currentView,
              nodes: updateTreeNode(currentView.nodes, node.path, (currentNode) => ({
                ...(currentNode.expanded ? collapseTreeNodeDeep(currentNode) : currentNode),
                expanded: !currentNode.expanded,
              })),
            }
          : currentView,
      );
      return;
    }

    setFolderView((currentView) =>
      currentView
        ? {
            ...currentView,
            loadingPath: node.path,
            nodes: updateTreeNode(currentView.nodes, node.path, (currentNode) => ({
              ...currentNode,
              expanded: true,
              error: undefined,
            })),
          }
        : currentView,
    );

    try {
      const children = await readFolderEntries(node.path);

      setFolderView((currentView) =>
        currentView
          ? {
              ...currentView,
              loadingPath: null,
              nodes: updateTreeNode(currentView.nodes, node.path, (currentNode) => ({
                ...currentNode,
                children,
                childrenLoaded: true,
                expanded: true,
                error: undefined,
              })),
            }
          : currentView,
      );
    } catch (error) {
      setFolderView((currentView) =>
        currentView
          ? {
              ...currentView,
              loadingPath: null,
              nodes: updateTreeNode(currentView.nodes, node.path, (currentNode) => ({
                ...currentNode,
                childrenLoaded: true,
                expanded: true,
                error: error instanceof Error ? error.message : String(error),
              })),
            }
          : currentView,
      );
    }
  };

  const toggleRootDirectory = () => {
    setFolderView((currentView) => {
      if (!currentView) {
        return currentView;
      }

      if (currentView.rootExpanded) {
        return {
          ...currentView,
          rootExpanded: false,
          nodes: collapseTreeNodesDeep(currentView.nodes),
        };
      }

      return {
        ...currentView,
        rootExpanded: true,
      };
    });
  };

  const openTreeFile = async (node: FileTreeNode) => {
    if (node.kind !== "file") {
      return;
    }

    requestFileOpen({ kind: "path", path: node.path, size: node.size });
  };

  const openFileTreeNameDialog = (dialog: FileTreeNameDialog) => {
    setFileTreeContextMenu(null);
    setFileTreeNameDialog(dialog);
    setFileTreeNameValue(dialog.kind === "rename" ? dialog.node.name : "");
  };

  const closeFileTreeNameDialog = () => {
    setFileTreeNameDialog(null);
    setFileTreeNameValue("");
  };

  const submitFileTreeNameDialog = async () => {
    if (!fileTreeNameDialog) {
      return;
    }

    const dialogScope = fileTreeNameDialog.scope ?? "main";
    const workspaceRoot = dialogScope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot) {
      setFileError("Unable to determine the active folder.");
      return;
    }

    const name = fileTreeNameValue.trim();

    if (!name) {
      setFileError("Enter a name.");
      return;
    }

    setFileError(null);

    try {
      if (fileTreeNameDialog.kind === "create-file") {
        const entry = await invoke<NativeDirectoryEntry>("create_file", {
          workspaceRoot,
          parentPath: fileTreeNameDialog.parentPath,
          name,
        });

        if (dialogScope === "scratch") {
          await refreshScratchFolder();
        } else {
          await refreshFolderPath(fileTreeNameDialog.parentPath);
        }
        closeFileTreeNameDialog();
        requestFileOpen({ kind: "path", path: entry.path, size: entry.size ?? undefined });
        return;
      }

      if (fileTreeNameDialog.kind === "create-directory") {
        await invoke<NativeDirectoryEntry>("create_directory", {
          workspaceRoot,
          parentPath: fileTreeNameDialog.parentPath,
          name,
        });

        if (dialogScope === "scratch") {
          await refreshScratchFolder();
        } else {
          await refreshFolderPath(fileTreeNameDialog.parentPath);
        }
        closeFileTreeNameDialog();
        return;
      }

      const node = fileTreeNameDialog.node;
      const renamedEntry = await invoke<NativeDirectoryEntry>("rename_path", {
        workspaceRoot,
        path: node.path,
        newName: name,
      });

      await refreshNodeParent(node, dialogScope);

      if (node.path === document.path) {
        setDocument((currentDocument) => ({
          ...currentDocument,
          id: getFileOpenId(renamedEntry.path, renamedEntry.lastModified),
          name: renamedEntry.name,
          path: renamedEntry.path,
          lastModified: renamedEntry.lastModified ?? currentDocument.lastModified,
        }));
      }

      closeFileTreeNameDialog();
    } catch (error) {
      setFileTreeError(error, "Unable to update the file tree.");
    }
  };

  const copyTreeNode = (node: FileTreeNode) => {
    setFileTreeClipboard({ action: "copy", node });
    setFileTreeContextMenu(null);
  };

  const cutTreeNode = (node: FileTreeNode) => {
    setFileTreeClipboard({ action: "cut", node });
    setFileTreeContextMenu(null);
  };

  const pasteTreeNode = async (targetDirectoryPath: string, scope: "main" | "scratch" = "main") => {
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot || !fileTreeClipboard) {
      return;
    }

    setFileTreeContextMenu(null);
    setFileError(null);

    try {
      if (fileTreeClipboard.action === "cut") {
        const movedEntry = await invoke<NativeDirectoryEntry>("move_path", {
          workspaceRoot,
          sourcePath: fileTreeClipboard.node.path,
          targetDirectory: targetDirectoryPath,
        });
        await refreshNodeParent(fileTreeClipboard.node, scope);
        await refreshTreePath(scope, targetDirectoryPath);
        setFileTreeClipboard(null);

        if (fileTreeClipboard.node.path === document.path) {
          setDocument((currentDocument) => ({
            ...currentDocument,
            id: getFileOpenId(movedEntry.path, movedEntry.lastModified),
            name: movedEntry.name,
            path: movedEntry.path,
            lastModified: movedEntry.lastModified ?? currentDocument.lastModified,
          }));
        }

        return;
      }

      await invoke<NativeDirectoryEntry>("copy_path", {
        workspaceRoot,
        sourcePath: fileTreeClipboard.node.path,
        targetDirectory: targetDirectoryPath,
      });
      await refreshTreePath(scope, targetDirectoryPath);
    } catch (error) {
      setFileTreeError(error, "Unable to paste into this folder.");
    }
  };

  const requestTrashTreeNode = (node: FileTreeNode, scope: "main" | "scratch" = "main") => {
    setFileTreeContextMenu(null);
    setFileTreeTrashTarget({ node, scope });
  };

  const confirmTrashTreeNode = async () => {
    if (!fileTreeTrashTarget) {
      return;
    }

    const { node: target, scope } = fileTreeTrashTarget;
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot) {
      return;
    }

    setFileTreeTrashTarget(null);
    setFileError(null);

    try {
      await invoke("trash_path", {
        workspaceRoot,
        path: target.path,
      });
      await refreshNodeParent(target, scope);

      if (isPathInsideOrEqual(document.path, target.path) && !isDirty) {
        setDocument(initialDocument);
        setSaveState("saved");
      }
    } catch (error) {
      setFileTreeError(error, "Unable to move this item to Trash.");
    }
  };

  const moveTreeNodeToDirectory = async (source: FileTreeNode, targetDirectoryPath: string, scope: "main" | "scratch" = "main") => {
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot || source.path === targetDirectoryPath || isPathInsideOrEqual(targetDirectoryPath, source.path)) {
      setDropTarget(null);
      return;
    }

    setFileError(null);

    try {
      const movedEntry = await invoke<NativeDirectoryEntry>("move_path", {
        workspaceRoot,
        sourcePath: source.path,
        targetDirectory: targetDirectoryPath,
      });
      await refreshNodeParent(source, scope);
      await refreshTreePath(scope, targetDirectoryPath);

      if (source.path === document.path) {
        setDocument((currentDocument) => ({
          ...currentDocument,
          id: getFileOpenId(movedEntry.path, movedEntry.lastModified),
          name: movedEntry.name,
          path: movedEntry.path,
          lastModified: movedEntry.lastModified ?? currentDocument.lastModified,
        }));
      }
    } catch (error) {
      setFileTreeError(error, "Unable to move this item.");
    } finally {
      setDraggedTreeNode(null);
      setDropTarget(null);
      dropTargetRef.current = null;
    }
  };

  const copyExternalPathsIntoTree = async (sourcePaths: string[], targetDirectoryPath: string, scope: "main" | "scratch" = "main") => {
    const workspaceRoot = scope === "scratch" ? scratchFolder?.path : folderView?.rootPath;

    if (!workspaceRoot || sourcePaths.length === 0) {
      return;
    }

    setFileError(null);

    try {
      await invoke<NativeDirectoryEntry[]>("copy_external_paths", {
        workspaceRoot,
        sourcePaths,
        targetDirectory: targetDirectoryPath,
      });
      await refreshTreePath(scope, targetDirectoryPath);
    } catch (error) {
      setFileTreeError(error, "Unable to copy dropped files.");
    } finally {
      setDropTarget(null);
      dropTargetRef.current = null;
    }
  };

  const openFileTreeContextMenu = (node: FileTreeNode | null, event: MouseEvent, scope: "main" | "scratch" = "main") => {
    event.preventDefault();
    setFileTreeContextMenu({ node, scope, x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    if (!folderView || !leftPanelOpen) {
      return;
    }

    let disposed = false;
    let intervalId: number | undefined;

    const refreshRootSilently = () => {
      if (disposed || globalThis.document.hidden) {
        return;
      }

      void refreshFolderPath(folderView.rootPath, {
        collapseChildren: false,
        preserveExpansion: true,
        silent: true,
      });
    };

    refreshRootSilently();
    intervalId = window.setInterval(refreshRootSilently, 12_000);

    const handleFocus = () => refreshRootSilently();
    const handleVisibilityChange = () => {
      if (!globalThis.document.hidden) {
        refreshRootSilently();
      }
    };

    window.addEventListener("focus", handleFocus);
    globalThis.document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener("focus", handleFocus);
      globalThis.document.removeEventListener("visibilitychange", handleVisibilityChange);

      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [folderView?.rootPath, leftPanelOpen]);

  const updateDocumentContent = (content: string) => {
    setDocument((currentDocument) => {
      if (currentDocument.content === content) {
        return currentDocument;
      }

      const nextDocument = { ...currentDocument, content };
      setOpenDocuments((currentDocuments) => upsertOpenDocument(currentDocuments, nextDocument));

      return nextDocument;
    });
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
    if (!isTauriRuntime()) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        const payload = event.payload as NativeDragDropPayload;
        const target = getTreeDropTargetFromPoint(payload.position);

        if (payload.type === "drop") {
          const fallbackTarget = scratchFolder
            ? ({ path: scratchFolder.path, scope: "scratch" } satisfies TreeDropTarget)
            : folderView
              ? ({ path: folderView.rootPath, scope: "main" } satisfies TreeDropTarget)
              : null;
          const destination = target ?? dropTargetRef.current ?? fallbackTarget;

          if (destination && payload.paths?.length) {
            void copyExternalPathsIntoTree(payload.paths, destination.path, destination.scope);
          }
          return;
        }

        if (payload.type === "leave" || payload.type === "cancel") {
          setDropTarget(null);
          dropTargetRef.current = null;
          return;
        }

        setDropTarget(target);
        dropTargetRef.current = target;
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
  }, [folderView?.rootPath, scratchFolder?.path]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    invoke<ScratchFolder>("scratch_folder")
      .then((folder) => {
        setScratchFolder(folder);
        void loadScratchFolderEntries(folder);
      })
      .catch(() => setScratchFolder(null));
  }, []);

  useEffect(() => {
    if (!fileTreeContextMenu) {
      return;
    }

    const closeContextMenu = () => setFileTreeContextMenu(null);
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", closeWithEscape);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [fileTreeContextMenu]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const handleFocus = () => {
      void checkCurrentDocumentOnDisk();
    };
    const handleVisibilityChange = () => {
      if (!globalThis.document.hidden) {
        void checkCurrentDocumentOnDisk();
      }
    };

    window.addEventListener("focus", handleFocus);
    globalThis.document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      globalThis.document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [document.path, document.lastModified, document.content, document.mode, document.isUntitled, isDirty, saveConflict, saveState]);

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
                clipboard={fileTreeClipboard}
                contextMenu={fileTreeContextMenu}
                draggedNode={draggedTreeNode}
                dropTarget={dropTarget}
                folderView={folderView}
                leftPanelWidth={leftPanelWidth}
                onContextMenu={openFileTreeContextMenu}
                onCopyNode={copyTreeNode}
                onCutNode={cutTreeNode}
                onDragEnd={() => {
                  setDraggedTreeNode(null);
                  setDropTarget(null);
                  dropTargetRef.current = null;
                }}
                onDragNode={setDraggedTreeNode}
                onDropNode={moveTreeNodeToDirectory}
                onDropTargetChange={(target) => {
                  setDropTarget(target);
                  dropTargetRef.current = target;
                }}
                onOpenFolder={openFolderPicker}
                onOpenSettings={openSettingsTool}
                onOpenRecentFolder={(path) => void openFolderView(path, "open-folder")}
                onOpenTreeFile={openTreeFile}
                onPasteNode={pasteTreeNode}
                onRefreshFolder={(path, scope = "main") => void refreshTreePath(scope, path)}
                onRequestCreateDirectory={(parentPath, scope = "main") =>
                  openFileTreeNameDialog({ kind: "create-directory", parentPath, scope })
                }
                onRequestCreateFile={(parentPath, scope = "main") => openFileTreeNameDialog({ kind: "create-file", parentPath, scope })}
                onRequestRenameNode={(node, scope = "main") => openFileTreeNameDialog({ kind: "rename", node, scope })}
                onRequestTrashNode={requestTrashTreeNode}
                recentFolders={recentFolders}
                scratchFolder={scratchFolder}
                scratchFolderView={scratchFolderView}
                onToggleScratchDirectory={(node) => void toggleScratchDirectory(node)}
                onToggleScratchRootDirectory={toggleScratchRootDirectory}
                onToggleDirectory={toggleDirectory}
                onToggleRootDirectory={toggleRootDirectory}
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
              openDocuments={openDocuments}
              onChange={updateDocumentContent}
              onCloseDocument={requestCloseDocument}
              onCreateFile={createFile}
              onSelectDocument={activateDocument}
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
          <UnsavedChangesDialog
            open={Boolean(pendingCloseDocument)}
            onCancel={() => setPendingCloseDocument(null)}
            onDiscard={() => {
              const targetDocument = pendingCloseDocument;
              setPendingCloseDocument(null);

              if (targetDocument) {
                closeDocument(targetDocument);
              }
            }}
            onSave={() => void saveAndClosePendingDocument()}
            onSaveAs={() => void saveAsAndClosePendingDocument()}
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
          <FileTreeNameDialogView
            dialog={fileTreeNameDialog}
            name={fileTreeNameValue}
            onCancel={closeFileTreeNameDialog}
            onNameChange={setFileTreeNameValue}
            onSubmit={() => void submitFileTreeNameDialog()}
          />
          <FileTreeTrashDialog
            node={fileTreeTrashTarget?.node ?? null}
            onCancel={() => setFileTreeTrashTarget(null)}
            onConfirm={() => void confirmTrashTreeNode()}
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

function TabFoldStack({ open, side, tabs }: { open: boolean; side: "left" | "right"; tabs: EditorTabPreview[] }) {
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
  clipboard,
  contextMenu,
  draggedNode,
  dropTarget,
  folderView,
  leftPanelWidth,
  onContextMenu,
  onCopyNode,
  onCutNode,
  onDragEnd,
  onDragNode,
  onDropNode,
  onDropTargetChange,
  onOpenFolder,
  onOpenRecentFolder,
  onOpenSettings,
  onOpenTreeFile,
  onPasteNode,
  onRefreshFolder,
  onRequestCreateDirectory,
  onRequestCreateFile,
  onRequestRenameNode,
  onRequestTrashNode,
  recentFolders,
  scratchFolder,
  scratchFolderView,
  onToggleScratchDirectory,
  onToggleScratchRootDirectory,
  onToggleDirectory,
  onToggleRootDirectory,
}: {
  activePath: string;
  clipboard: FileTreeClipboard | null;
  contextMenu: FileTreeContextMenuState | null;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  folderView: FolderView | null;
  leftPanelWidth: number;
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onCopyNode: (node: FileTreeNode) => void;
  onCutNode: (node: FileTreeNode) => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFolder: () => void;
  onOpenRecentFolder: (path: string) => void;
  onOpenSettings: () => void;
  onOpenTreeFile: (node: FileTreeNode) => void;
  onPasteNode: (targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onRefreshFolder: (path: string, scope?: "main" | "scratch") => void;
  onRequestCreateDirectory: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestCreateFile: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestRenameNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onRequestTrashNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  recentFolders: RecentFolder[];
  scratchFolder: ScratchFolder | null;
  scratchFolderView: ScratchFolderView;
  onToggleScratchDirectory: (node: FileTreeNode) => void;
  onToggleScratchRootDirectory: () => void;
  onToggleDirectory: (node: FileTreeNode) => void;
  onToggleRootDirectory: () => void;
}) {
  const scratchPanelMinRatio = 0.1;
  const scratchPanelMaxRatio = 0.6;
  const [scratchPanelRatio, setScratchPanelRatio] = useState(0.3);
  const panelStackRef = useRef<HTMLDivElement>(null);

  const startScratchPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const stack = panelStackRef.current;

    if (!stack) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    const stackRect = stack.getBoundingClientRect();
    const startY = event.clientY;
    const startRatio = scratchPanelRatio;

    const updateRatio = (clientY: number) => {
      const nextScratchHeight = stackRect.height * startRatio - (clientY - startY);
      const nextRatio = Math.min(scratchPanelMaxRatio, Math.max(scratchPanelMinRatio, nextScratchHeight / stackRect.height));
      setScratchPanelRatio(nextRatio);
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      updateRatio(pointerEvent.clientY);
    };

    const stopResize = () => {
      document.body.classList.remove("project-panel-splitter-resizing");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    document.body.classList.add("project-panel-splitter-resizing");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  };

  return (
    <aside className="project-panel frosted-surface frosted-surface-subtle">
      <div className="project-panel-resizable-stack" ref={panelStackRef}>
        <div className="project-panel-main-region" style={{ flexBasis: `${(1 - scratchPanelRatio) * 100}%` }}>
          <ProjectPanelStart
            folderView={folderView}
            leftPanelWidth={leftPanelWidth}
            onOpenFolder={onOpenFolder}
            onOpenRecentFolder={onOpenRecentFolder}
            recentFolders={recentFolders}
          />
          <FileTreePanel
            activePath={activePath}
            clipboard={clipboard}
            contextMenu={contextMenu}
            draggedNode={draggedNode}
            dropTarget={dropTarget}
            treeView={
              folderView
                ? {
                    error: folderView.error,
                    loadingPath: folderView.loadingPath,
                    nodes: folderView.nodes,
                    rootExpanded: folderView.rootExpanded,
                    rootName: folderView.rootName,
                    rootPath: folderView.rootPath,
                  }
                : null
            }
            scope="main"
            onContextMenu={onContextMenu}
            onCopyNode={onCopyNode}
            onCutNode={onCutNode}
            onDragEnd={onDragEnd}
            onDragNode={onDragNode}
            onDropNode={onDropNode}
            onDropTargetChange={onDropTargetChange}
            onOpenFile={onOpenTreeFile}
            onPasteNode={onPasteNode}
            onRefreshFolder={onRefreshFolder}
            onRequestCreateDirectory={onRequestCreateDirectory}
            onRequestCreateFile={onRequestCreateFile}
            onRequestRenameNode={onRequestRenameNode}
            onRequestTrashNode={onRequestTrashNode}
            onToggleDirectory={onToggleDirectory}
            onToggleRootDirectory={onToggleRootDirectory}
          />
        </div>
        <div
          aria-label="Resize temporary folder area"
          aria-orientation="horizontal"
          aria-valuemax={scratchPanelMaxRatio * 100}
          aria-valuemin={scratchPanelMinRatio * 100}
          aria-valuenow={Math.round(scratchPanelRatio * 100)}
          className="project-panel-splitter"
          role="separator"
          tabIndex={0}
          onPointerDown={startScratchPanelResize}
        >
          <span className="project-panel-splitter-line" />
        </div>
        <ProjectPanelScratchFolder
          activePath={activePath}
          clipboard={clipboard}
          contextMenu={contextMenu}
          draggedNode={draggedNode}
          dropTarget={dropTarget}
          scratchFolder={scratchFolder}
          scratchFolderView={scratchFolderView}
          style={{ flexBasis: `${scratchPanelRatio * 100}%` }}
          onContextMenu={onContextMenu}
          onCopyNode={onCopyNode}
          onCutNode={onCutNode}
          onDragEnd={onDragEnd}
          onDragNode={onDragNode}
          onDropNode={onDropNode}
          onDropTargetChange={onDropTargetChange}
          onOpenFile={onOpenTreeFile}
          onPasteNode={onPasteNode}
          onRefreshFolder={onRefreshFolder}
          onRequestCreateDirectory={onRequestCreateDirectory}
          onRequestCreateFile={onRequestCreateFile}
          onRequestRenameNode={onRequestRenameNode}
          onRequestTrashNode={onRequestTrashNode}
          onToggleDirectory={onToggleScratchDirectory}
          onToggleRootDirectory={onToggleScratchRootDirectory}
        />
      </div>
      <ProjectPanelFooter onOpenSettings={onOpenSettings} />
    </aside>
  );
}

function ProjectPanelStart({
  folderView,
  leftPanelWidth,
  onOpenFolder,
  onOpenRecentFolder,
  recentFolders,
}: {
  folderView: FolderView | null;
  leftPanelWidth: number;
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
        <div className="project-panel-recent-switcher">
          <div className="project-panel-recent-heading">Recent folders</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="project-panel-recent-select" type="button">
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

function ProjectPanelScratchFolder({
  activePath,
  clipboard,
  contextMenu,
  draggedNode,
  dropTarget,
  scratchFolder,
  scratchFolderView,
  style,
  onContextMenu,
  onCopyNode,
  onCutNode,
  onDragEnd,
  onDragNode,
  onDropNode,
  onDropTargetChange,
  onOpenFile,
  onPasteNode,
  onRefreshFolder,
  onRequestCreateDirectory,
  onRequestCreateFile,
  onRequestRenameNode,
  onRequestTrashNode,
  onToggleDirectory,
  onToggleRootDirectory,
}: {
  activePath: string;
  clipboard: FileTreeClipboard | null;
  contextMenu: FileTreeContextMenuState | null;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  scratchFolder: ScratchFolder | null;
  scratchFolderView: ScratchFolderView;
  style?: CSSProperties;
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onCopyNode: (node: FileTreeNode) => void;
  onCutNode: (node: FileTreeNode) => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onPasteNode: (targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onRefreshFolder: (path: string, scope?: "main" | "scratch") => void;
  onRequestCreateDirectory: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestCreateFile: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestRenameNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onRequestTrashNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onToggleDirectory: (node: FileTreeNode) => void;
  onToggleRootDirectory: () => void;
}) {
  const scratchTreeView: TreePanelView | null = scratchFolder
    ? {
        error: scratchFolderView.error,
        loadingPath: scratchFolderView.loadingPath,
        nodes: scratchFolderView.nodes,
        rootExpanded: scratchFolderView.expanded,
        rootName: "临时文件夹",
        rootPath: scratchFolder.path,
      }
    : null;

  return (
    <div className="project-panel-scratch" style={style}>
      <div className="project-panel-scratch-heading">临时文件夹</div>
      <FileTreePanel
        activePath={activePath}
        clipboard={clipboard}
        contextMenu={contextMenu}
        draggedNode={draggedNode}
        dropTarget={dropTarget}
        scope="scratch"
        treeView={scratchTreeView}
        onContextMenu={onContextMenu}
        onCopyNode={onCopyNode}
        onCutNode={onCutNode}
        onDragEnd={onDragEnd}
        onDragNode={onDragNode}
        onDropNode={onDropNode}
        onDropTargetChange={onDropTargetChange}
        onOpenFile={onOpenFile}
        onPasteNode={onPasteNode}
        onRefreshFolder={onRefreshFolder}
        onRequestCreateDirectory={onRequestCreateDirectory}
        onRequestCreateFile={onRequestCreateFile}
        onRequestRenameNode={onRequestRenameNode}
        onRequestTrashNode={onRequestTrashNode}
        onToggleDirectory={onToggleDirectory}
        onToggleRootDirectory={onToggleRootDirectory}
      />
    </div>
  );
}

function FileTreePanel({
  activePath,
  clipboard,
  contextMenu,
  draggedNode,
  dropTarget,
  scope,
  treeView,
  onContextMenu,
  onCopyNode,
  onCutNode,
  onDragEnd,
  onDragNode,
  onDropNode,
  onDropTargetChange,
  onOpenFile,
  onPasteNode,
  onRefreshFolder,
  onRequestCreateDirectory,
  onRequestCreateFile,
  onRequestRenameNode,
  onRequestTrashNode,
  onToggleDirectory,
  onToggleRootDirectory,
}: {
  activePath: string;
  clipboard: FileTreeClipboard | null;
  contextMenu: FileTreeContextMenuState | null;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  scope: "main" | "scratch";
  treeView: TreePanelView | null;
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onCopyNode: (node: FileTreeNode) => void;
  onCutNode: (node: FileTreeNode) => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onPasteNode: (targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onRefreshFolder: (path: string, scope?: "main" | "scratch") => void;
  onRequestCreateDirectory: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestCreateFile: (parentPath: string, scope?: "main" | "scratch") => void;
  onRequestRenameNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onRequestTrashNode: (node: FileTreeNode, scope?: "main" | "scratch") => void;
  onToggleDirectory: (node: FileTreeNode) => void;
  onToggleRootDirectory: () => void;
}) {
  const scrollParentRef = useRef<HTMLDivElement>(null);
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

  if (!treeView) {
    return <div className="min-h-0 flex-1" />;
  }

  const hasRootDirectories = treeView.nodes.some((node) => node.kind === "directory");
  const targetDirectory = contextMenu?.node?.kind === "directory" ? contextMenu.node.path : treeView.rootPath;
  const scopedContextMenu = contextMenu?.scope === scope ? contextMenu : null;

  return (
    <>
      {treeView.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
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
      />
      <div
        className="file-tree-scroll min-h-0 flex-1"
        ref={scrollParentRef}
        onContextMenu={(event) => onContextMenu(null, event, scope)}
      >
        <div
          className={cn(
            "file-tree-list",
            !hasRootDirectories && "file-tree-list-flat",
          )}
          role="tree"
          aria-label={treeView.rootName}
          data-tree-drop-path={treeView.rootPath}
          data-tree-drop-scope={scope}
        >
          {treeView.loadingPath === treeView.rootPath && treeView.nodes.length === 0 ? (
            <div className="px-2 py-2 text-[12px] text-muted-foreground">Loading folder...</div>
          ) : null}
          <div
            className="file-tree-virtual-inner"
            style={{ height: `${treeVirtualizer.getTotalSize()}px` }}
          >
            {treeVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];

              return (
                <div
                  className="file-tree-virtual-row"
                  key={row.node.path}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <FileTreeRow
                    activePath={activePath}
                    ancestorCanonicalPaths={row.ancestorCanonicalPaths}
                    depth={row.depth}
                    draggedNode={draggedNode}
                    dropTarget={dropTarget}
                    loadingPath={treeView.loadingPath}
                    node={row.node}
                    scope={scope}
                    onContextMenu={onContextMenu}
                    onDragEnd={onDragEnd}
                    onDragNode={onDragNode}
                    onDropNode={onDropNode}
                    onDropTargetChange={onDropTargetChange}
                    onOpenFile={onOpenFile}
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
            <div className="px-2 py-2 text-[12px] text-muted-foreground">No files in this folder.</div>
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
          onRefresh={() => onRefreshFolder(scopedContextMenu.node?.kind === "directory" ? scopedContextMenu.node.path : treeView.rootPath, scope)}
          onRequestCreateDirectory={() => onRequestCreateDirectory(targetDirectory, scope)}
          onRequestCreateFile={() => onRequestCreateFile(targetDirectory, scope)}
          onRequestRenameNode={(node) => onRequestRenameNode(node, scope)}
          onRequestTrashNode={(node) => onRequestTrashNode(node, scope)}
          x={scopedContextMenu.x}
          y={scopedContextMenu.y}
        />
      ) : null}
    </>
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

function FileTreeRootRow({
  dropTarget,
  scope,
  treeView,
  onContextMenu,
  onDropTargetChange,
  onToggle,
}: {
  dropTarget: TreeDropTarget | null;
  scope: "main" | "scratch";
  treeView: TreePanelView;
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onToggle: () => void;
}) {
  const isDropTarget = dropTarget?.scope === scope && dropTarget.path === treeView.rootPath;

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
        onContextMenu={(event) => onContextMenu(null, event, scope)}
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
    </div>
  );
}

function FileTreeRow({
  activePath,
  ancestorCanonicalPaths,
  depth = 0,
  draggedNode,
  dropTarget,
  loadingPath,
  node,
  scope,
  onContextMenu,
  onDragEnd,
  onDragNode,
  onDropNode,
  onDropTargetChange,
  onOpenFile,
  onToggleDirectory,
}: {
  activePath: string;
  ancestorCanonicalPaths: string[];
  depth?: number;
  draggedNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  loadingPath: string | null;
  node: FileTreeNode;
  scope: "main" | "scratch";
  onContextMenu: (node: FileTreeNode | null, event: MouseEvent, scope?: "main" | "scratch") => void;
  onDragEnd: () => void;
  onDragNode: (node: FileTreeNode) => void;
  onDropNode: (source: FileTreeNode, targetDirectoryPath: string, scope?: "main" | "scratch") => void;
  onDropTargetChange: (target: TreeDropTarget | null) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onToggleDirectory: (node: FileTreeNode) => void;
}) {
  const isDirectory = node.kind === "directory";
  const isActive = node.path === activePath;
  const isLoading = loadingPath === node.path;
  const isDropTarget = isDirectory && dropTarget?.scope === scope && dropTarget.path === node.path;
  const canonicalPath = node.canonicalPath ?? node.path;
  const wouldCycle = isDirectory && node.isSymlink && ancestorCanonicalPaths.includes(canonicalPath);
  const { className: iconClassName, Icon } = getFileTreeIcon(node);

  const handleOpen = () => {
    if (!isDirectory) {
      onOpenFile(node);
      return;
    }

    if (wouldCycle) {
      return;
    }

    onToggleDirectory(node);
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.path);
    onDragNode(node);
  };

  const handleDragOver = (event: DragEvent<HTMLButtonElement>) => {
    if (!isDirectory || !draggedNode || draggedNode.path === node.path || isPathInsideOrEqual(node.path, draggedNode.path)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    onDropTargetChange({ path: node.path, scope });
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    if (!isDirectory || !draggedNode) {
      return;
    }

    event.preventDefault();
    onDropNode(draggedNode, node.path, scope);
  };

  return (
    <div className="file-tree-node" role="none">
      <button
        aria-expanded={isDirectory ? Boolean(node.expanded) : undefined}
        aria-selected={isActive}
        className={cn(
          "tree-row w-full text-left",
          isActive && "tree-row-active",
          (node.error || wouldCycle) && "tree-row-muted",
          node.isHidden && "tree-row-hidden",
          node.isReadonly && "tree-row-readonly",
          isDropTarget && "tree-row-drop-target",
        )}
        data-tree-drop-path={isDirectory ? node.path : undefined}
        data-tree-drop-scope={isDirectory ? scope : undefined}
        draggable
        role="treeitem"
        style={{ "--tree-depth": depth } as CSSProperties}
        type="button"
        title={wouldCycle ? `${node.path}\nSymlink loop blocked.` : node.path}
        onClick={handleOpen}
        onContextMenu={(event) => onContextMenu(node, event, scope)}
        onDragEnd={onDragEnd}
        onDragLeave={() => (isDropTarget ? onDropTargetChange(null) : undefined)}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
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
          {node.isSymlink ? <Link2 className="tree-row-badge-icon" /> : null}
        </span>
        <span className="tree-row-size">
          {isLoading ? "..." : wouldCycle ? "loop" : isDirectory ? "" : formatFileSize(node.size)}
        </span>
      </button>
      {node.error || wouldCycle ? (
        <div className="tree-row-error" style={{ "--tree-depth": depth } as CSSProperties}>
          {wouldCycle ? "Symlink loop blocked." : node.error}
        </div>
      ) : null}
    </div>
  );
}

function FileTreeContextMenu({
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
  x: number;
  y: number;
}) {
  const menuStyle = {
    left: Math.min(x, window.innerWidth - 216),
    top: Math.min(y, window.innerHeight - 260),
  } satisfies CSSProperties;

  const menu = (
    <div className="file-tree-context-menu" role="menu" style={menuStyle} onClick={(event) => event.stopPropagation()}>
      <button className="file-tree-context-item" type="button" onClick={onRequestCreateFile}>
        <FilePlus className="file-tree-context-icon" />
        New File
      </button>
      <button className="file-tree-context-item" type="button" onClick={onRequestCreateDirectory}>
        <FolderPlus className="file-tree-context-icon" />
        New Folder
      </button>
      <button className="file-tree-context-item" type="button" onClick={onRefresh}>
        <RefreshCw className="file-tree-context-icon" />
        Refresh
      </button>
      <div className="file-tree-context-separator" />
      <button className="file-tree-context-item" disabled={!node} type="button" onClick={() => node && onRequestRenameNode(node)}>
        <Pencil className="file-tree-context-icon" />
        Rename
      </button>
      <button className="file-tree-context-item" disabled={!node} type="button" onClick={() => node && onCopyNode(node)}>
        <Copy className="file-tree-context-icon" />
        Copy
      </button>
      <button className="file-tree-context-item" disabled={!node} type="button" onClick={() => node && onCutNode(node)}>
        <Scissors className="file-tree-context-icon" />
        Cut
      </button>
      <button className="file-tree-context-item" disabled={!clipboard} type="button" onClick={onPasteNode}>
        <ClipboardPaste className="file-tree-context-icon" />
        Paste
      </button>
      <div className="file-tree-context-separator" />
      <button
        className="file-tree-context-item file-tree-context-item-danger"
        disabled={!node}
        type="button"
        onClick={() => node && onRequestTrashNode(node)}
      >
        <Trash2 className="file-tree-context-icon" />
        Move to Trash
      </button>
    </div>
  );

  return createPortal(menu, globalThis.document.body);
}

function FileTreeNameDialogView({
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
  const title =
    dialog?.kind === "create-file" ? "New File" : dialog?.kind === "create-directory" ? "New Folder" : "Rename";

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
            <DialogDescription>Enter a name for this file tree item.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            className="mt-4"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">{dialog?.kind === "rename" ? "Rename" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FileTreeTrashDialog({
  node,
  onCancel,
  onConfirm,
}: {
  node: FileTreeNode | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(node)} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to Trash?</DialogTitle>
          <DialogDescription>
            {node ? `${node.name} will be moved to the system Trash.` : "This item will be moved to the system Trash."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UnsavedChangesDialog({
  onCancel,
  onDiscard,
  onSave,
  onSaveAs,
  open,
}: {
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onCancel() : undefined)}>
      <DialogContent className="unsaved-close-dialog">
        <DialogHeader className="unsaved-close-dialog-header">
          <DialogTitle className="unsaved-close-dialog-title">Unsaved changes</DialogTitle>
          <DialogDescription className="unsaved-close-dialog-description">
            This tab has local edits that are not saved yet. Save them, keep a copy, or discard them before closing the tab.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="unsaved-close-dialog-actions">
          <Button className="unsaved-close-dialog-action" variant="ghost" onClick={onSave}>
            Save and Close
          </Button>
          <Button className="unsaved-close-dialog-action" variant="ghost" onClick={onSaveAs}>
            Save As...
          </Button>
          <Button className="unsaved-close-dialog-action unsaved-close-dialog-action-danger" variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
          <Button className="unsaved-close-dialog-action" variant="ghost" onClick={onCancel}>
            Cancel
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
  openDocuments,
  onChange,
  onCloseDocument,
  onCreateFile,
  onSelectDocument,
}: {
  document: WorkbenchDocument;
  error: string | null;
  isDirty: boolean;
  openDocuments: WorkbenchDocument[];
  onChange: (content: string) => void;
  onCloseDocument: (document: WorkbenchDocument) => void;
  onCreateFile: () => void;
  onSelectDocument: (document: WorkbenchDocument) => void;
}) {
  const editorFrameRef = useRef<HTMLDivElement>(null);
  const editorElementRef = useRef<HTMLDivElement>(null);
  const tabScrollRef = useRef<HTMLDivElement>(null);
  const tabButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabScrollLeftRef = useRef(0);
  const tabScrollSettleTimerRef = useRef<number | null>(null);
  const suppressTabBellowsUntilRef = useRef(0);
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
  const [tabBellows, setTabBellows] = useState<"left" | "right" | null>(null);
  const [tabFoldStacks, setTabFoldStacks] = useState<TabFoldStacks>({ left: [], right: [] });
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });
  const previewTabs = useMemo<EditorTabPreview[]>(
    () =>
      openDocuments.map((openDocument) => ({
        accent: getTabAccent(openDocument.id),
        closable: openDocuments.length > 1,
        id: openDocument.id,
        name: openDocument.name,
        dirty: isDocumentDirty(openDocument) || openDocument.isUntitled,
      })),
    [openDocuments],
  );

  const commitPreviewTabName = () => {
    if (!editingPreviewTabId) {
      return;
    }

    const nextName = editingPreviewTabName.trim();

    if (nextName) {
      // Tab renaming is visual-only for now; file rename stays in the file tree command.
    }

    setEditingPreviewTabId(null);
  };

  const addPreviewTab = () => {
    setEditingPreviewTabId(null);
    onCreateFile();
  };

  const updateTabOverflow = () => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      setTabOverflow({ left: false, right: false });
      setTabFoldStacks({ left: [], right: [] });
      return;
    }

    const maxScrollLeft = tabScroll.scrollWidth - tabScroll.clientWidth;
    const viewportStart = tabScroll.scrollLeft;
    const viewportEnd = viewportStart + tabScroll.clientWidth;
    const leftHiddenTabs: EditorTabPreview[] = [];
    const rightHiddenTabs: EditorTabPreview[] = [];

    previewTabs.forEach((tab) => {
      const tabButton = tabButtonRefs.current[tab.id];

      if (!tabButton) {
        return;
      }

      const tabStart = tabButton.offsetLeft;
      const tabEnd = tabStart + tabButton.offsetWidth;

      if (tabEnd < viewportStart + 6) {
        leftHiddenTabs.push(tab);
        return;
      }

      if (tabStart > viewportEnd - 6) {
        rightHiddenTabs.push(tab);
      }
    });

    setTabOverflow({
      left: tabScroll.scrollLeft > 2,
      right: tabScroll.scrollLeft < maxScrollLeft - 2,
    });
    setTabFoldStacks({
      left: leftHiddenTabs.slice(-3),
      right: rightHiddenTabs.slice(0, 3).reverse(),
    });
  };

  const scrollPreviewTabIntoView = (tabId: string) => {
    const tabButton = tabButtonRefs.current[tabId];

    if (!tabButton) {
      return;
    }

    suppressTabBellowsUntilRef.current = window.performance.now() + 420;

    tabButton.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  };

  useEffect(() => {
    setActivePreviewTabId(document.id);

    window.requestAnimationFrame(() => {
      scrollPreviewTabIntoView(document.id);
      updateTabOverflow();

      viewRef.current?.focus();
    });
  }, [document.id]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      scrollPreviewTabIntoView(activePreviewTabId);
      updateTabOverflow();
    });
  }, [activePreviewTabId, previewTabs.length]);

  useEffect(() => {
    const tabScroll = tabScrollRef.current;

    if (!tabScroll) {
      return;
    }

    updateTabOverflow();
    tabScrollLeftRef.current = tabScroll.scrollLeft;

    const handleTabScroll = () => {
      const currentScrollLeft = tabScroll.scrollLeft;
      const scrollDelta = currentScrollLeft - tabScrollLeftRef.current;

      updateTabOverflow();

      if (Math.abs(scrollDelta) > 1 && window.performance.now() > suppressTabBellowsUntilRef.current) {
        setTabBellows(scrollDelta > 0 ? "right" : "left");
      }

      tabScrollLeftRef.current = currentScrollLeft;

      if (tabScrollSettleTimerRef.current) {
        window.clearTimeout(tabScrollSettleTimerRef.current);
      }

      tabScrollSettleTimerRef.current = window.setTimeout(() => {
        setTabBellows(null);
      }, 180);
    };

    tabScroll.addEventListener("scroll", handleTabScroll, { passive: true });
    window.addEventListener("resize", updateTabOverflow);

    return () => {
      tabScroll.removeEventListener("scroll", handleTabScroll);
      window.removeEventListener("resize", updateTabOverflow);

      if (tabScrollSettleTimerRef.current) {
        window.clearTimeout(tabScrollSettleTimerRef.current);
      }
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
        <TabFoldStack open={tabBellows === "left"} side="left" tabs={tabFoldStacks.left} />
        <div className="editor-file-tabs-scroll" ref={tabScrollRef}>
          {previewTabs.map((tab) => {
            const active = tab.id === activePreviewTabId;
            const editing = tab.id === editingPreviewTabId;
            const tabDocument = openDocuments.find((openDocument) => openDocument.id === tab.id);

            return (
              <button
                className={cn("editor-file-tab", active && "editor-file-tab-active")}
                key={tab.id}
                ref={(element) => {
                  tabButtonRefs.current[tab.id] = element;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  if (tabDocument) {
                    onSelectDocument(tabDocument);
                  }
                }}
                onDoubleClick={() => {
                  if (tabDocument) {
                    onSelectDocument(tabDocument);
                  }
                  setEditingPreviewTabId(tab.id);
                  setEditingPreviewTabName(tab.name);
                }}
              >
                <span className={cn("editor-file-tab-dot", tab.dirty ? "bg-amber-500" : "bg-emerald-500")} />
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
                {tab.dirty && !editing ? <span className="text-muted-foreground">•</span> : null}
                {tab.closable && !editing ? (
                  <span
                    className="editor-file-tab-close"
                    role="button"
                    tabIndex={-1}
                    aria-label={`Close ${tab.name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();

                      if (tabDocument) {
                        onCloseDocument(tabDocument);
                      }
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <TabFoldStack open={tabBellows === "right"} side="right" tabs={tabFoldStacks.right} />
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
