/** 通用文件树节点:文件夹（按 "/" 分段）或带任意载荷 T 的文件叶子。 */
export type FileTreeNode<T> =
  | { kind: "folder"; name: string; path: string; children: FileTreeNode<T>[] }
  | { kind: "file"; name: string; item: T };

/** 把任意带 path 的扁平列表按 "/" 折叠成文件树(变更列表、提交改动列表通用)。 */
export function buildFileTree<T extends { path: string }>(items: T[]): FileTreeNode<T>[] {
  const roots: FileTreeNode<T>[] = [];

  for (const item of items) {
    const segments = item.path.split("/");
    let level = roots;
    let prefix = "";

    segments.forEach((segment, index) => {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      if (index === segments.length - 1) {
        level.push({ kind: "file", name: segment, item });
        return;
      }
      let folder = level.find(
        (node): node is Extract<FileTreeNode<T>, { kind: "folder" }> =>
          node.kind === "folder" && node.name === segment,
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
