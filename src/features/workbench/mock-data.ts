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
