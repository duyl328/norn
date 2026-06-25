export type ProjectAccentStyle = {
  "--project-color": string;
  "--project-color-foreground": string;
};

export type RecentFolder = {
  name: string;
  path: string;
};

export type ScratchFolder = {
  name: string;
  path: string;
};

export type ScratchFolderView = {
  nodes: FileTreeNode[];
  expanded: boolean;
  loading: boolean;
  loadingPath: string | null;
  error: string | null;
};

export type TauriRuntimeWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

export type NativeTextFile = {
  name: string;
  path: string;
  content: string;
  size: number;
  lastModified?: number | null;
};

export type NativeTextFileInspection = {
  name: string;
  path: string;
  size: number;
  lastModified?: number | null;
  isBinary: boolean;
  isUtf8: boolean;
  sample: string;
};

export type NativeTextFileRange = {
  path: string;
  content: string;
  size: number;
  requestedOffset: number;
  startOffset: number;
  endOffset: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
};

export type NativeSavedTextFile = {
  name: string;
  path: string;
  size: number;
  lastModified?: number | null;
};

export type NativeSaveErrorKind = "deleted" | "invalid-path" | "io" | "modified" | "permission";

export type NativeSaveError = {
  kind?: NativeSaveErrorKind;
  message?: string;
};

export type NativeDirectoryEntry = {
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

export type GitWorkspaceInspection = {
  workspacePath: string;
  gitAvailable: boolean;
  gitVersion?: string | null;
  isRepository: boolean;
  gitRoot?: string | null;
  hasDotGit: boolean;
  branch?: string | null;
  message: string;
};

export type GitWorkspaceState =
  | { kind: "idle" }
  | { kind: "loading"; workspacePath: string }
  | { kind: "ready"; inspection: GitWorkspaceInspection }
  | { kind: "error"; message: string; workspacePath: string };

export type FolderView = {
  rootPath: string;
  rootName: string;
  origin: "open-folder" | "containing-folder";
  nodes: FileTreeNode[];
  rootExpanded: boolean;
  loadingPath: string | null;
  error: string | null;
};

export type FileTreeNode = {
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

export type FileTreeClipboard = {
  action: "copy" | "cut";
  nodes: FileTreeNode[];
};

// 文件树多选状态(单一作用域)。anchorPath 是 Shift 区间锚点,leadPath 是方向键光标(也用于定位滚动),
// paths 是当前高亮的全部路径。与编辑区打开的文件解耦。
export type TreeSelection = {
  scope: "main" | "scratch";
  anchorPath: string;
  leadPath: string;
  paths: string[];
};

// 鼠标点击/键盘移动时的修饰键意图。
export type TreeSelectionModifiers = {
  toggle: boolean; // Ctrl / Cmd:切换单项
  range: boolean; // Shift:区间选择
};

// 文件树「即输即搜」(类 IDEA speed search):在某棵树内直接键入即开始,只匹配当前可见行的名字。
export type TreeSearch = {
  scope: "main" | "scratch";
  query: string;
};

export type FileTreeNameDialog =
  | { kind: "create-file"; parentPath: string; scope?: "main" | "scratch" }
  | { kind: "create-directory"; parentPath: string; scope?: "main" | "scratch" }
  | { kind: "rename"; node: FileTreeNode; scope?: "main" | "scratch" };

export type FileTreeContextMenuState = {
  node: FileTreeNode | null;
  scope: "main" | "scratch";
  x: number;
  y: number;
};

export type FileTreeTrashTarget = {
  node: FileTreeNode;
  scope: "main" | "scratch";
};

export type TreeDropTarget = {
  path: string;
  scope: "main" | "scratch";
};

export type TreePanelView = {
  error: string | null;
  loadingPath: string | null;
  nodes: FileTreeNode[];
  rootExpanded: boolean;
  rootName: string;
  rootPath: string;
};

export type VisibleTreeRow = {
  depth: number;
  ancestorCanonicalPaths: string[];
  node: FileTreeNode;
};

export type NativeFileOperationError = {
  kind?: string;
  message?: string;
};

export type NativeDragDropPayload = {
  paths?: string[];
  position?: { x: number; y: number };
  type: "enter" | "over" | "drop" | "leave" | "cancel";
};

export type PendingFileOpen =
  | { kind: "file-dialog" }
  | { kind: "path"; clearFolderView?: boolean; path: string; size?: number };

export type EditorScrollMetrics = {
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

export type EditorScrollbarOrientation = "horizontal" | "vertical";

export type EditorScrollbarGeometry = {
  maxScroll: number;
  scrollPosition: number;
  thumbOffset: number;
  thumbSize: number;
  trackSize: number;
};

export type SaveState = "idle" | "saving" | "saved" | "error";

export type SaveConflict = {
  content: string;
  lastModified?: number;
  message: string;
  path: string;
};

export type WorkbenchDocument = {
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

export type EditorTabPreview = {
  accent: string;
  closable?: boolean;
  id: string;
  name: string;
  dirty?: boolean;
};

export type EditorTabLayout = {
  coveredLeft: number;
  coveredRight: number;
  hideLeft: number;
  hideRight: number;
  side: "left" | "normal" | "right";
  stickyLeft: number;
  stickyRight: number;
  zIndex: number;
};

export type EditorTabPosition = {
  left: number;
  naturalLeft: number;
  side: EditorTabLayout["side"];
  stickyLeft: number;
  stickyRight: number;
  width: number;
};

export type TabFoldStacks = {
  left: EditorTabPreview[];
  right: EditorTabPreview[];
};
