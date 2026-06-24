import type { LucideIcon } from "lucide-react";
import { Braces, Code2, FileCode2, FileText, Folder, FolderOpen, GitBranch, Settings } from "lucide-react";

export type TreeNode = {
  name: string;
  detail?: string;
  icon: LucideIcon;
  status?: "M" | "A" | "U";
  active?: boolean;
  muted?: boolean;
  depth?: number;
};

export const treeNodes: TreeNode[] = [
  { name: "norn", icon: FolderOpen, detail: "workspace" },
  { name: "src", icon: FolderOpen, depth: 1 },
  { name: "features/workbench", icon: Folder, depth: 2 },
  { name: "workbench-page.tsx", icon: FileCode2, depth: 3, active: true, status: "M" },
  { name: "components/ui", icon: Folder, depth: 2 },
  { name: "button.tsx", icon: Braces, depth: 3 },
  { name: "src-tauri", icon: FolderOpen, depth: 1 },
  { name: "lib.rs", icon: Code2, depth: 2, status: "A" },
  { name: "doc", icon: Folder, depth: 1 },
  { name: "需求文档.md", icon: FileText, depth: 2 },
  { name: "target", icon: Folder, depth: 1, muted: true },
];

export type GitChangeStatus = "added" | "conflict" | "deleted" | "modified" | "renamed" | "untracked";

export type GitChangeItem = {
  additions: number;
  deletions: number;
  id: string;
  path: string;
  previousPath?: string;
  status: GitChangeStatus;
};

/**
 * 变更列表：扁平地列出本次工作区的改动文件。
 * 设计上不区分「已暂存 / 未暂存」、不提供逐文件勾选，
 * 用户点击行即可查看具体文件，提交即提交全部改动。
 */
export const gitChanges: GitChangeItem[] = [
  {
    id: "workbench-page",
    path: "src/features/workbench/workbench-page.tsx",
    status: "modified",
    additions: 126,
    deletions: 48,
  },
  {
    id: "git-panel",
    path: "src/features/workbench/components/git-panel.tsx",
    status: "modified",
    additions: 88,
    deletions: 64,
  },
  {
    id: "branch-menu",
    path: "src/features/workbench/components/git-branch-menu.tsx",
    status: "added",
    additions: 132,
    deletions: 0,
  },
  {
    id: "mock-data",
    path: "src/features/workbench/mock-data.ts",
    status: "modified",
    additions: 74,
    deletions: 96,
  },
  {
    id: "styles",
    path: "src/styles.css",
    status: "modified",
    additions: 61,
    deletions: 4,
  },
  {
    id: "readme",
    path: "README.md",
    status: "modified",
    additions: 9,
    deletions: 2,
  },
  {
    id: "old-prototype",
    path: "temp/fan-stack-tabs.html",
    status: "deleted",
    additions: 0,
    deletions: 41,
  },
  {
    id: "design-doc",
    path: "doc/产品设计定位与边界.md",
    status: "untracked",
    additions: 168,
    deletions: 0,
  },
];

export const gitChangeSummary = {
  files: gitChanges.length,
  additions: gitChanges.reduce((total, change) => total + change.additions, 0),
  deletions: gitChanges.reduce((total, change) => total + change.deletions, 0),
};

export const gitRepositoryMock = {
  name: "norn",
  branch: "main",
  upstream: "origin/main",
  ahead: 2,
  behind: 0,
};

export type GitCommitRef = {
  hash: string;
  relativeTime: string;
  subject: string;
};

export type GitBranchItem = {
  ahead?: number; // 相对上游
  aheadOfBase?: number; // 相对基线分支(如 main)领先
  base?: string; // 基线分支
  baseNewCommits?: GitCommitRef[]; // 基线在分叉点之后新增的提交(我落后的)
  behind?: number; // 相对上游
  behindBase?: number; // 相对基线分支落后
  current?: boolean;
  forkPoint?: GitCommitRef; // 与基线的分叉点
  kind: "local" | "remote";
  lastCommit?: string;
  name: string;
  ownCommits?: GitCommitRef[]; // 本分支领先基线的提交(我独有的)
  upstream?: string;
};

export const gitBranches: GitBranchItem[] = [
  {
    name: "main",
    kind: "local",
    current: true,
    upstream: "origin/main",
    ahead: 2,
    behind: 0,
    lastCommit: "支持文件树全部展开折叠",
    ownCommits: [
      { hash: "8d10277", subject: "支持文件树全部展开折叠", relativeTime: "2 小时前" },
      { hash: "4d33bdb", subject: "修正编辑区顶栏搜索定位", relativeTime: "5 小时前" },
      { hash: "de82d58", subject: "合并分支 feat/git-panel", relativeTime: "1 天前" },
    ],
  },
  {
    name: "feat/git-panel",
    kind: "local",
    upstream: "origin/feat/git-panel",
    ahead: 1,
    behind: 0,
    lastCommit: "新增分支预览与提交面板",
    base: "main",
    aheadOfBase: 2,
    behindBase: 1,
    forkPoint: { hash: "3f5b9a2", subject: "优化 macOS 工作区面板层次", relativeTime: "2 天前" },
    ownCommits: [
      { hash: "a04d33b", subject: "新增分支预览与提交面板", relativeTime: "1 天前" },
      { hash: "91ab2cd", subject: "重做右侧变更面板壳层", relativeTime: "1 天前" },
    ],
    baseNewCommits: [{ hash: "4d33bdb", subject: "修正编辑区顶栏搜索定位", relativeTime: "5 小时前" }],
  },
  {
    name: "fix/titlebar",
    kind: "local",
    lastCommit: "简化 Windows 标题栏布局",
    base: "main",
    aheadOfBase: 1,
    behindBase: 3,
    forkPoint: { hash: "7b8c9d0", subject: "初始化工作台骨架", relativeTime: "5 天前" },
    ownCommits: [{ hash: "d4e5f6a", subject: "简化 Windows 标题栏布局", relativeTime: "3 天前" }],
    baseNewCommits: [
      { hash: "8d10277", subject: "支持文件树全部展开折叠", relativeTime: "2 小时前" },
      { hash: "3f5b9a2", subject: "优化 macOS 工作区面板层次", relativeTime: "2 天前" },
      { hash: "1a2b3c4", subject: "合并分支 fix/titlebar", relativeTime: "3 天前" },
    ],
  },
  { name: "origin/main", kind: "remote", lastCommit: "支持文件树全部展开折叠" },
  { name: "origin/feat/git-panel", kind: "remote", lastCommit: "新增分支预览与提交面板" },
];

export type GitCommitItem = {
  author: string;
  hash: string;
  isMerge?: boolean;
  refs?: string[];
  relativeTime: string;
  subject: string;
};

/** 轻量血缘：最近若干条提交，用于分支菜单里查看分支关系（ref 徽章表达谁指向哪）。 */
export const gitRecentCommits: GitCommitItem[] = [
  { hash: "8d10277", subject: "支持文件树全部展开折叠", author: "你", relativeTime: "2 小时前", refs: ["HEAD → main"] },
  { hash: "4d33bdb", subject: "修正编辑区顶栏搜索定位", author: "你", relativeTime: "5 小时前", refs: ["origin/main"] },
  { hash: "def2be3", subject: "优化 macOS 工作区面板层次", author: "你", relativeTime: "1 天前" },
  { hash: "de82d58", subject: "合并 feat/git-panel", author: "你", relativeTime: "1 天前", isMerge: true },
  { hash: "a04d33b", subject: "修复右侧面板边界样式", author: "Lin", relativeTime: "2 天前", refs: ["feat/git-panel"] },
  { hash: "a04d352", subject: "简化 Windows 标题栏布局", author: "Lin", relativeTime: "2 天前" },
];

export type GitGraphCommit = {
  author: string;
  body?: string;
  column: number;
  date: string;
  files?: { path: string; status: GitChangeStatus }[];
  hash: string;
  isMerge?: boolean;
  parents: string[];
  refs?: string[];
  relativeTime: string;
  subject: string;
};

/**
 * 多分支提交图（假数据）：包含 3 条分支（main / feat/git-panel / fix/titlebar）、
 * 2 次合并与 2 个分叉点。column 是泳道下标，parents 用于画分叉/合并连线。
 */
export const gitGraphCommits: GitGraphCommit[] = [
  {
    hash: "8d10277",
    column: 0,
    parents: ["4d33bdb"],
    subject: "支持文件树全部展开折叠",
    author: "你",
    date: "06-24 14:20",
    relativeTime: "2 小时前",
    refs: ["HEAD → main", "origin/main"],
    files: [
      { path: "src/features/workbench/components/file-tree.tsx", status: "modified" },
      { path: "src/styles.css", status: "modified" },
    ],
  },
  {
    hash: "4d33bdb",
    column: 0,
    parents: ["de82d58"],
    subject: "修正编辑区顶栏搜索定位",
    author: "你",
    date: "06-24 11:05",
    relativeTime: "5 小时前",
    files: [{ path: "src/features/workbench/components/editor-surface.tsx", status: "modified" }],
  },
  {
    hash: "de82d58",
    column: 0,
    parents: ["7c2f0e1", "a04d33b"],
    isMerge: true,
    subject: "合并分支 feat/git-panel",
    author: "你",
    date: "06-23 18:40",
    relativeTime: "1 天前",
    body: "将 feat/git-panel 的变更面板与分支预览合入 main。",
  },
  {
    hash: "a04d33b",
    column: 1,
    parents: ["91ab2cd"],
    subject: "新增分支预览与提交面板",
    author: "Lin",
    date: "06-23 17:10",
    relativeTime: "1 天前",
    refs: ["feat/git-panel"],
    files: [
      { path: "src/features/workbench/components/git-preview.tsx", status: "added" },
      { path: "src/features/workbench/mock-data.ts", status: "modified" },
    ],
  },
  {
    hash: "91ab2cd",
    column: 1,
    parents: ["7c2f0e1"],
    subject: "重做右侧变更面板壳层",
    author: "Lin",
    date: "06-23 15:30",
    relativeTime: "1 天前",
    files: [
      { path: "src/features/workbench/components/git-panel.tsx", status: "modified" },
      { path: "src/styles.css", status: "modified" },
    ],
  },
  {
    hash: "7c2f0e1",
    column: 0,
    parents: ["3f5b9a2"],
    subject: "修复右侧面板边界样式",
    author: "你",
    date: "06-22 20:15",
    relativeTime: "2 天前",
    files: [{ path: "src/features/workbench/workbench-page.tsx", status: "modified" }],
  },
  {
    hash: "3f5b9a2",
    column: 0,
    parents: ["1a2b3c4"],
    subject: "优化 macOS 工作区面板层次",
    author: "你",
    date: "06-22 16:00",
    relativeTime: "2 天前",
    files: [{ path: "src/styles.css", status: "modified" }],
  },
  {
    hash: "1a2b3c4",
    column: 0,
    parents: ["7b8c9d0", "d4e5f6a"],
    isMerge: true,
    subject: "合并分支 fix/titlebar",
    author: "你",
    date: "06-21 19:25",
    relativeTime: "3 天前",
    body: "合入 Windows 标题栏布局修复。",
  },
  {
    hash: "d4e5f6a",
    column: 2,
    parents: ["7b8c9d0"],
    subject: "简化 Windows 标题栏布局",
    author: "Wang",
    date: "06-21 14:50",
    relativeTime: "3 天前",
    refs: ["fix/titlebar"],
    files: [
      { path: "src/features/workbench/components/titlebar.tsx", status: "modified" },
      { path: "src/styles.windows.css", status: "modified" },
    ],
  },
  {
    hash: "7b8c9d0",
    column: 0,
    parents: [],
    subject: "初始化工作台骨架",
    author: "你",
    date: "06-19 09:30",
    relativeTime: "5 天前",
    files: [{ path: "src/app.tsx", status: "added" }],
  },
];

export const editorLines = [
  'import { WorkbenchShell } from "@/features/workbench/workbench-shell";',
  "",
  "export function WorkbenchPage() {",
  "  return (",
  '    <WorkbenchShell keymap="jetbrains-compatible">',
  '      <EditorSurface engine="codemirror-6" />',
  '      <GitPanel provider="system-git-cli" />',
  "    </WorkbenchShell>",
  "  );",
  "}",
];

export type ActionGroup = {
  label: string;
  shortcut: string;
  icon: LucideIcon;
};

export const actionGroups: ActionGroup[] = [
  { label: "Open Project", shortcut: "Ctrl+Shift+O", icon: FolderOpen },
  { label: "Search Everywhere", shortcut: "Double Shift", icon: Settings },
  { label: "Current Branch", shortcut: "main", icon: GitBranch },
];
