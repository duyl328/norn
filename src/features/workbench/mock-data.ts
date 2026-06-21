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
  description: string;
  id: string;
  path: string;
  previousPath?: string;
  status: GitChangeStatus;
};

export type GitChangeSection = {
  actionLabel?: string;
  count: number;
  emptyLabel: string;
  id: "conflicts" | "staged" | "unstaged" | "untracked";
  items: GitChangeItem[];
  title: string;
  tone?: "danger" | "default" | "success" | "warning";
};

export const gitRepositoryMock = {
  name: "norn-collab-notes",
  branch: "main",
  upstream: "origin/main",
  remoteState: "领先 1",
  remoteHint: "有 1 个提交待推送",
  stagedCount: 2,
  workingCount: 5,
  untrackedCount: 2,
};

export const gitPanelStatesMock = [
  {
    id: "empty",
    title: "尚未打开项目",
    description: "打开文件夹后即可查看仓库变更。",
  },
  {
    id: "clean",
    title: "工作区干净",
    description: "当前仓库没有本地变更。",
  },
  {
    id: "error",
    title: "无法读取 Git 状态",
    description: "可能未安装 Git，或当前文件夹不是仓库。",
  },
];

export const gitChangeSections: GitChangeSection[] = [
  {
    id: "conflicts",
    title: "冲突",
    count: 0,
    tone: "danger",
    emptyLabel: "没有合并冲突",
    actionLabel: "处理",
    items: [],
  },
  {
    id: "staged",
    title: "已暂存",
    count: 2,
    tone: "success",
    emptyLabel: "没有已暂存文件",
    actionLabel: "全部取消",
    items: [
      {
        id: "staged-workbench",
        path: "src/features/workbench/workbench-page.tsx",
        status: "modified",
        description: "重做右侧 Git 任务面板壳层",
        additions: 126,
        deletions: 48,
      },
      {
        id: "staged-styles",
        path: "src/styles.css",
        status: "modified",
        description: "补充紧凑面板分区与变更行样式",
        additions: 88,
        deletions: 12,
      },
    ],
  },
  {
    id: "unstaged",
    title: "未暂存",
    count: 3,
    tone: "warning",
    emptyLabel: "没有未暂存变更",
    actionLabel: "全部暂存",
    items: [
      {
        id: "unstaged-mock-data",
        path: "src/features/workbench/mock-data.ts",
        status: "modified",
        description: "扩展 Git 工作流模拟数据",
        additions: 74,
        deletions: 22,
      },
      {
        id: "unstaged-readme",
        path: "README.md",
        status: "modified",
        description: "记录当前 Git 面板设计方向",
        additions: 9,
        deletions: 2,
      },
      {
        id: "unstaged-old-prototype",
        path: "temp/fan-stack-tabs.html",
        status: "deleted",
        description: "移除过期视觉实验文件",
        additions: 0,
        deletions: 41,
      },
    ],
  },
  {
    id: "untracked",
    title: "未跟踪",
    count: 2,
    emptyLabel: "没有未跟踪文件",
    actionLabel: "全部暂存",
    items: [
      {
        id: "untracked-git-panel-note",
        path: "doc/git-panel-design-notes.md",
        status: "untracked",
        description: "草拟 Git 面板交互说明",
        additions: 38,
        deletions: 0,
      },
      {
        id: "untracked-panel-test",
        path: "src/features/workbench/git-panel.mock.ts",
        status: "added",
        description: "预留后续测试数据边界",
        additions: 21,
        deletions: 0,
      },
    ],
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
