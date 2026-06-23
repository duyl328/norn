import { describe, expect, it } from "vitest";

import type {
  EditorScrollMetrics,
  FileTreeNode,
  NativeDirectoryEntry,
  WorkbenchDocument,
} from "@/features/workbench/types";
import {
  arePathsEqual,
  clamp,
  collapseTreeNodeDeep,
  collapseTreeNodesDeep,
  createUntitledDocument,
  findTreeNode,
  flattenVisibleTreeRows,
  formatFileSize,
  getCompactPath,
  getDocumentLines,
  getEditorScrollbarGeometry,
  getFileExtension,
  getFileOpenId,
  getFileTreeIcon,
  getNativeFileOperationError,
  getNativeSaveError,
  getParentPath,
  getPathName,
  getProjectAccentStyle,
  getProjectInitials,
  getTabAccent,
  getTabBorderAccent,
  getTailPath,
  getTreeAncestorDirectoryPaths,
  isAbsolutePath,
  isDocumentDirty,
  isPathInsideOrEqual,
  mergeTreeNodesState,
  mergeTreeNodeState,
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

  it("arePathsEqual 归一化分隔符与尾斜杠", () => {
    expect(arePathsEqual("/a/b", "/a/b/")).toBe(true);
    expect(arePathsEqual("C:\\a\\b", "C:/a/b")).toBe(true);
    expect(arePathsEqual("/a/b", "/a/c")).toBe(false);
  });

  it("getTreeAncestorDirectoryPaths 返回根(不含)到文件父目录(含)的自浅到深链", () => {
    expect(getTreeAncestorDirectoryPaths("/root/a/b/file.ts", "/root")).toEqual(["/root/a", "/root/a/b"]);
  });

  it("getTreeAncestorDirectoryPaths 文件直接位于根下时返回空数组", () => {
    expect(getTreeAncestorDirectoryPaths("/root/file.ts", "/root")).toEqual([]);
  });

  it("getTreeAncestorDirectoryPaths 文件不在根内时返回空数组", () => {
    expect(getTreeAncestorDirectoryPaths("/other/a/file.ts", "/root")).toEqual([]);
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

  it("findTreeNode 深度查找匹配节点,未命中返回 undefined", () => {
    const tree = [dir("src", "/p/src", [dir("sub", "/p/src/sub", [file("a.ts", "/p/src/sub/a.ts")], true)], true)];
    expect(findTreeNode(tree, "/p/src/sub/a.ts")?.name).toBe("a.ts");
    expect(findTreeNode(tree, "/p/src/sub")?.kind).toBe("directory");
    expect(findTreeNode(tree, "/p/missing")).toBeUndefined();
  });
});

describe("getTabBorderAccent", () => {
  it("按扩展名给配色，未知回退", () => {
    expect(getTabBorderAccent("a.ts")).toBe("#2563eb");
    expect(getTabBorderAccent("a.rs")).toBe("#b45309");
    expect(getTabBorderAccent("a.unknownext")).toBe("#94a3b8");
  });

  it("覆盖更多扩展名分支", () => {
    expect(getTabBorderAccent("a.py")).toBe("#0369a1");
    expect(getTabBorderAccent("a.json")).toBe("#8b5cf6");
    expect(getTabBorderAccent("a.css")).toBe("#0d9488");
    expect(getTabBorderAccent("a.md")).toBe("#4338ca");
    expect(getTabBorderAccent("a.png")).toBe("#db2777");
    expect(getTabBorderAccent("a.sh")).toBe("#475569");
  });
});

describe("getCompactPath / getTailPath", () => {
  it("getCompactPath 段数不超过阈值时原样返回", () => {
    expect(getCompactPath("/a/b")).toBe("/a/b");
  });

  it("getCompactPath 超过阈值保留尾部若干段", () => {
    expect(getCompactPath("/a/b/c/d/e/f", 2)).toBe(".../e/f");
  });

  it("getTailPath 不超长原样返回", () => {
    expect(getTailPath("/a/b", 50)).toBe("/a/b");
  });

  it("getTailPath 超长时截断为尾部", () => {
    const result = getTailPath("/very/long/path/segment/here/more", 16);
    expect(result.startsWith(".../")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(16 + 4);
  });
});

describe("getFileTreeIcon", () => {
  it("目录按展开状态选择图标", () => {
    expect(getFileTreeIcon(dir("src", "/p/src", [], true)).className).toBe("tree-row-icon-directory");
    expect(getFileTreeIcon(dir("src", "/p/src", [], false)).className).toBe("tree-row-icon-directory");
  });

  it("文件按扩展名分类", () => {
    expect(getFileTreeIcon(file("a.ts", "/a.ts")).className).toBe("tree-row-icon-code");
    expect(getFileTreeIcon(file("a.json", "/a.json")).className).toBe("tree-row-icon-json");
    expect(getFileTreeIcon(file("a.css", "/a.css")).className).toBe("tree-row-icon-markup");
    expect(getFileTreeIcon(file("a.toml", "/a.toml")).className).toBe("tree-row-icon-config");
    expect(getFileTreeIcon(file("a.png", "/a.png")).className).toBe("tree-row-icon-image");
    expect(getFileTreeIcon(file("a.zip", "/a.zip")).className).toBe("tree-row-icon-archive");
    expect(getFileTreeIcon(file("a.csv", "/a.csv")).className).toBe("tree-row-icon-sheet");
    expect(getFileTreeIcon(file("a.sql", "/a.sql")).className).toBe("tree-row-icon-data");
    expect(getFileTreeIcon(file("a.sh", "/a.sh")).className).toBe("tree-row-icon-terminal");
    expect(getFileTreeIcon(file("a.vue", "/a.vue")).className).toBe("tree-row-icon-component");
    expect(getFileTreeIcon(file("a.unknown", "/a.unknown")).className).toBe("tree-row-icon-file");
  });
});

describe("原生错误归一化", () => {
  it("getNativeSaveError 透传任意对象(含 Error)、包裹非对象", () => {
    const obj = { kind: "permission", message: "denied" };
    expect(getNativeSaveError(obj)).toBe(obj);
    const err = new Error("boom");
    expect(getNativeSaveError(err)).toBe(err);
    expect(getNativeSaveError("plain")).toEqual({ kind: "io", message: "plain" });
  });

  it("getNativeFileOperationError 透传任意对象(含 Error)、包裹非对象", () => {
    const obj = { message: "x" };
    expect(getNativeFileOperationError(obj)).toBe(obj);
    const err = new Error("bad");
    expect(getNativeFileOperationError(err)).toBe(err);
    expect(getNativeFileOperationError(42)).toEqual({ message: "42" });
  });
});

describe("项目配色 / 缩写", () => {
  it("getProjectInitials 取首字母大写", () => {
    expect(getProjectInitials("my-cool-project")).toBe("MC");
    expect(getProjectInitials("workbench")).toBe("W");
    expect(getProjectInitials("CamelCaseName")).toBe("CC");
  });

  it("getProjectAccentStyle / getTabAccent 稳定且取自调色板", () => {
    const style = getProjectAccentStyle("norn");
    expect(style["--project-color"]).toBeTruthy();
    expect(getProjectAccentStyle("norn")["--project-color"]).toBe(style["--project-color"]);
    expect(getTabAccent("doc-1")).toBeTruthy();
  });
});

describe("getEditorScrollbarGeometry", () => {
  const metrics = (overrides: Partial<EditorScrollMetrics> = {}): EditorScrollMetrics => ({
    scrollWidth: 1000,
    clientWidth: 400,
    scrollHeight: 2000,
    clientHeight: 500,
    scrollLeft: 100,
    scrollTop: 200,
    shellWidth: 400,
    shellHeight: 500,
    gutterWidth: 40,
    ...overrides,
  });

  it("无溢出时返回 null", () => {
    expect(
      getEditorScrollbarGeometry("horizontal", metrics({ scrollWidth: 400, clientWidth: 400 })),
    ).toBeNull();
    expect(
      getEditorScrollbarGeometry("vertical", metrics({ scrollHeight: 500, clientHeight: 500 })),
    ).toBeNull();
  });

  it("有溢出时返回滑块几何", () => {
    const horizontal = getEditorScrollbarGeometry("horizontal", metrics());
    expect(horizontal).not.toBeNull();
    expect(horizontal!.thumbSize).toBeGreaterThan(0);
    expect(horizontal!.maxScroll).toBeGreaterThan(0);

    const vertical = getEditorScrollbarGeometry("vertical", metrics());
    expect(vertical).not.toBeNull();
    expect(vertical!.thumbSize).toBeGreaterThan(0);
  });
});

describe("tree 节点状态合并 / 折叠", () => {
  it("mergeTreeNodeState 无 previous 或节点为文件时原样返回", () => {
    const node = file("a.ts", "/a.ts");
    expect(mergeTreeNodeState(node)).toBe(node);
    expect(mergeTreeNodeState(node, dir("a.ts", "/a.ts"))).toBe(node);
  });

  it("mergeTreeNodeState 目录节点继承 previous 的展开/加载状态", () => {
    const previous = dir("src", "/src", [file("x", "/src/x")], true);
    const fresh = dir("src", "/src", [], false);
    const merged = mergeTreeNodeState(fresh, previous);
    expect(merged.expanded).toBe(true);
    expect(merged.childrenLoaded).toBe(true);
    expect(merged.children).toHaveLength(1);
  });

  it("collapseTreeNodesDeep 批量折叠", () => {
    const nodes = [dir("src", "/src", [dir("sub", "/src/sub", [], true)], true)];
    const collapsed = collapseTreeNodesDeep(nodes);
    expect(collapsed[0].expanded).toBe(false);
    expect((collapsed[0].children ?? [])[0].expanded).toBe(false);
  });
});

describe("文档创建工具", () => {
  it("createUntitledDocument 生成空白未命名文档", () => {
    const document = createUntitledDocument();
    expect(document.isUntitled).toBe(true);
    expect(document.content).toBe("");
    expect(document.id).toMatch(/^untitled-/);
  });

  it("getFileOpenId 拼接路径与时间戳", () => {
    expect(getFileOpenId("/a/b.ts", 123)).toBe("/a/b.ts-123");
  });
});
