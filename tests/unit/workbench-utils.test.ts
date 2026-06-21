import { describe, expect, it } from "vitest";

import type { FileTreeNode, NativeDirectoryEntry, WorkbenchDocument } from "@/features/workbench/types";
import {
  clamp,
  collapseTreeNodeDeep,
  flattenVisibleTreeRows,
  formatFileSize,
  getDocumentLines,
  getFileExtension,
  getParentPath,
  getPathName,
  getTabBorderAccent,
  isAbsolutePath,
  isDocumentDirty,
  isPathInsideOrEqual,
  mergeTreeNodesState,
  toFileTreeNode,
  updateTreeNode,
  upsertOpenDocument,
} from "@/features/workbench/workbench-utils";

const dir = (name: string, path: string, children: FileTreeNode[] = [], expanded = false): FileTreeNode => ({
  name,
  path,
  relativePath: path,
  kind: "directory",
  children,
  childrenLoaded: children.length > 0,
  expanded,
});

const file = (name: string, path: string): FileTreeNode => ({
  name,
  path,
  relativePath: path,
  kind: "file",
});

const doc = (overrides: Partial<WorkbenchDocument> = {}): WorkbenchDocument => ({
  id: "d1",
  name: "a.ts",
  path: "a.ts",
  content: "x",
  savedContent: "x",
  ...overrides,
});

describe("clamp", () => {
  it("约束到区间内", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("路径工具", () => {
  it("getPathName 取末段并去尾部分隔符", () => {
    expect(getPathName("/a/b/c")).toBe("c");
    expect(getPathName("/a/b/c/")).toBe("c");
    expect(getPathName("C:\\x\\y")).toBe("y");
  });

  it("getParentPath 处理普通路径与根", () => {
    expect(getParentPath("/a/b")).toBe("/a");
    expect(getParentPath("/a")).toBe("/");
    expect(getParentPath("noseparator")).toBeNull();
  });

  it("isAbsolutePath 识别绝对路径", () => {
    expect(isAbsolutePath("/a")).toBe(true);
    expect(isAbsolutePath("C:/a")).toBe(true);
    expect(isAbsolutePath("rel/path")).toBe(false);
  });

  it("isPathInsideOrEqual 不被前缀误判", () => {
    expect(isPathInsideOrEqual("/a/b", "/a")).toBe(true);
    expect(isPathInsideOrEqual("/a", "/a")).toBe(true);
    expect(isPathInsideOrEqual("/ab", "/a")).toBe(false);
  });
});

describe("getFileExtension", () => {
  it("小写、无扩展名、隐藏文件、点结尾", () => {
    expect(getFileExtension("File.TS")).toBe("ts");
    expect(getFileExtension("noext")).toBe("");
    expect(getFileExtension(".gitignore")).toBe("");
    expect(getFileExtension("a.")).toBe("");
  });
});

describe("formatFileSize", () => {
  it("分级格式化", () => {
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("文档工具", () => {
  it("isDocumentDirty 比较 content 与 savedContent", () => {
    expect(isDocumentDirty(doc({ content: "a", savedContent: "a" }))).toBe(false);
    expect(isDocumentDirty(doc({ content: "a", savedContent: "b" }))).toBe(true);
  });

  it("getDocumentLines 按换行拆分且至少一行", () => {
    expect(getDocumentLines(doc({ content: "a\nb\r\nc" }))).toEqual(["a", "b", "c"]);
    expect(getDocumentLines(doc({ content: "" }))).toEqual([""]);
  });

  it("upsertOpenDocument 存在则替换、不存在则追加", () => {
    const a = doc({ id: "a", content: "1" });
    const b = doc({ id: "b" });
    expect(upsertOpenDocument([a, b], doc({ id: "a", content: "2" }))).toEqual([
      doc({ id: "a", content: "2" }),
      b,
    ]);
    const c = doc({ id: "c" });
    expect(upsertOpenDocument([a, b], c)).toEqual([a, b, c]);
  });
});

describe("文件树工具", () => {
  it("toFileTreeNode 映射原生条目，目录初始化空 children", () => {
    const entry: NativeDirectoryEntry = {
      name: "src",
      path: "/p/src",
      relativePath: "src",
      kind: "directory",
    };
    const node = toFileTreeNode(entry);
    expect(node.kind).toBe("directory");
    expect(node.children).toEqual([]);
    expect(node.childrenLoaded).toBe(false);
    expect(node.expanded).toBe(false);
  });

  it("updateTreeNode 深度更新匹配节点", () => {
    const tree = [dir("src", "/p/src", [file("a.ts", "/p/src/a.ts")], true), file("r.md", "/p/r.md")];
    const next = updateTreeNode(tree, "/p/src/a.ts", (n) => ({ ...n, name: "renamed.ts" }));
    const child = (next[0].children ?? [])[0];
    expect(child.name).toBe("renamed.ts");
    // 未匹配节点保持引用不变
    expect(next[1]).toBe(tree[1]);
  });

  it("flattenVisibleTreeRows 仅展开 expanded 目录", () => {
    const collapsed = [dir("src", "/p/src", [file("a.ts", "/p/src/a.ts")], false)];
    expect(flattenVisibleTreeRows(collapsed)).toHaveLength(1);

    const expanded = [dir("src", "/p/src", [file("a.ts", "/p/src/a.ts")], true)];
    const rows = flattenVisibleTreeRows(expanded);
    expect(rows).toHaveLength(2);
    expect(rows[1].depth).toBe(1);
    expect(rows[1].node.name).toBe("a.ts");
  });

  it("collapseTreeNodeDeep 递归折叠", () => {
    const node = dir("src", "/p/src", [dir("sub", "/p/src/sub", [], true)], true);
    const collapsed = collapseTreeNodeDeep(node);
    expect(collapsed.expanded).toBe(false);
    expect((collapsed.children ?? [])[0].expanded).toBe(false);
  });

  it("mergeTreeNodesState 保留旧的展开/加载状态", () => {
    const previous = [dir("src", "/p/src", [file("a.ts", "/p/src/a.ts")], true)];
    const fresh = [dir("src", "/p/src", [], false)];
    const merged = mergeTreeNodesState(fresh, previous);
    expect(merged[0].expanded).toBe(true);
    expect(merged[0].childrenLoaded).toBe(true);
  });
});

describe("getTabBorderAccent", () => {
  it("按扩展名给配色，未知回退", () => {
    expect(getTabBorderAccent("a.ts")).toBe("#2563eb");
    expect(getTabBorderAccent("a.rs")).toBe("#b45309");
    expect(getTabBorderAccent("a.unknownext")).toBe("#94a3b8");
  });
});
