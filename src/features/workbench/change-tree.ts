import type { GitChange } from "./types";

/** 变更文件树节点:文件夹（按 "/" 分段）或文件叶子。 */
export type ChangeTreeNode =
  | { kind: "folder"; name: string; path: string; children: ChangeTreeNode[] }
  | { kind: "file"; name: string; change: GitChange };

/** 把扁平的变更列表按 "/" 折叠成文件树。 */
export function buildChangeTree(changes: GitChange[]): ChangeTreeNode[] {
  const roots: ChangeTreeNode[] = [];

  for (const change of changes) {
    const segments = change.path.split("/");
    let level = roots;
    let prefix = "";

    segments.forEach((segment, index) => {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      if (index === segments.length - 1) {
        level.push({ kind: "file", name: segment, change });
        return;
      }
      let folder = level.find(
        (node): node is Extract<ChangeTreeNode, { kind: "folder" }> => node.kind === "folder" && node.name === segment,
      );
      if (!folder) {
        folder = { kind: "folder", name: segment, path: prefix, children: [] };
        level.push(folder);
      }
      level = folder.children;
    });
  }

  return roots;
}
