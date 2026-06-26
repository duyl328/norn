import type { GitBranch } from "./types";

/** 分支树节点:文件夹（按 "/" 分段折叠）或叶子分支。 */
export type BranchTreeNode =
  | { kind: "folder"; name: string; path: string; children: BranchTreeNode[] }
  | { kind: "branch"; name: string; branch: GitBranch };

/**
 * 把扁平分支列表按 "/" 折叠成树:feature/login、feature/signup → "feature" 文件夹下两叶子。
 * stripPrefix 用于远程分支去掉 "origin/" 这层再分组。
 */
export function buildBranchTree(branches: GitBranch[], stripPrefix?: string): BranchTreeNode[] {
  const roots: BranchTreeNode[] = [];

  for (const branch of branches) {
    const display = stripPrefix && branch.name.startsWith(stripPrefix) ? branch.name.slice(stripPrefix.length) : branch.name;
    const segments = display.split("/");
    let level = roots;
    let prefix = "";

    segments.forEach((segment, index) => {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;

      if (isLeaf) {
        level.push({ kind: "branch", name: segment, branch });
        return;
      }

      let folder = level.find((node): node is Extract<BranchTreeNode, { kind: "folder" }> => node.kind === "folder" && node.name === segment);
      if (!folder) {
        folder = { kind: "folder", name: segment, path: prefix, children: [] };
        level.push(folder);
      }
      level = folder.children;
    });
  }

  return roots;
}
