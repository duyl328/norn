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

export type GitChangeStatus = "added" | "conflict" | "deleted" | "modified" | "renamed" | "untracked";

export type GitChange = {
  path: string;
  status: GitChangeStatus;
  additions: number;
  deletions: number;
  previousPath?: string;
};

export type GitStatus = {
  branch?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
};

export type GitBranch = {
  name: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  lastCommit?: string | null;
  current: boolean;
  kind: "local" | "remote";
};

export type GitBranches = {
  current?: string | null;
  local: GitBranch[];
  remote: GitBranch[];
};

export type GitCommit = {
  hash: string;
  subject: string;
  author: string;
  relativeTime: string;
  refs: string[];
  isMerge: boolean;
};

export type GitLogCommit = {
  hash: string;
  parents: string[];
  subject: string;
  body: string;
  author: string;
  date: string;
  relativeTime: string;
  refs: string[];
  isMerge: boolean;
};

/** git_log 提交 + 前端计算出的泳道列号，用于画图谱。 */
export type GitGraphCommit = GitLogCommit & { column: number };

export type GitCommitFile = {
  path: string;
  status: GitChangeStatus;
};

export type GitCommitRef = {
  hash: string;
  subject: string;
  relativeTime: string;
};

export type GitDivergence = {
  base?: string | null;
  forkPoint?: GitCommitRef | null;
  ownCommits: GitCommitRef[];
  baseNewCommits: GitCommitRef[];
  aheadOfBase: number;
  behindBase: number;
};

/** 右侧 Git 面板的三个模式:提交（变更+提交）/ 分支（分支树+关系）/ 历史（提交列表）。竖向 tab 纵向滑动切换。 */
export type GitPanelMode = "commit" | "branch" | "history";

export type GitErrorKind =
  | "git-not-found"
  | "not-repository"
  | "identity-missing"
  | "hook-failed"
  | "nothing-to-commit"
  | "no-upstream"
  | "auth-failed"
  | "conflict"
  | "io";

export type GitError = {
  kind?: GitErrorKind;
  message?: string;
};

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
  node: FileTreeNode;
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
  mode?: "editable" | "large-readonly" | "diff";
  // diff 模式:并排对照的两个完整版本(原始 HEAD / 修改后工作区)。
  diff?: { original: string; modified: string };
  // diff 模式且文件存在冲突标记时为 true,改用冲突解决视图。
  conflict?: boolean;
  range?: {
    endOffset: number;
    hasMoreAfter: boolean;
    hasMoreBefore: boolean;
    startOffset: number;
  };
};

export type GitFileVersions = {
  original: string;
  modified: string;
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
