// @vitest-environment jsdom

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
  loadEditorSearchHistory,
  loadQuickSearchHistory,
  mergeTreeNodesState,
  mergeTreeNodeState,
  normalizeEditorSearchHistory,
  normalizeQuickSearchHistory,
  remapDescendantPath,
  remapDocumentAfterMove,
  requiresDocumentCloseConfirmation,
  saveEditorSearchHistory,
  saveQuickSearchHistory,
  toFileTreeNode,
  updateTreeNode,
  upsertEditorSearchHistory,
  upsertOpenDocument,
  upsertQuickSearchHistory,
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
  it("bounds values to the given range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("path helpers", () => {
  it("getPathName returns the last path segment", () => {
    expect(getPathName("/a/b/c")).toBe("c");
    expect(getPathName("/a/b/c/")).toBe("c");
    expect(getPathName("C:\\x\\y")).toBe("y");
  });

  it("getParentPath handles regular paths and roots", () => {
    expect(getParentPath("/a/b")).toBe("/a");
    expect(getParentPath("/a")).toBe("/");
    expect(getParentPath("C:\\a\\b")).toBe("C:\\a");
    expect(getParentPath("C:\\a")).toBe("C:\\");
    expect(getParentPath("noseparator")).toBeNull();
  });

  it("isAbsolutePath detects absolute paths", () => {
    expect(isAbsolutePath("/a")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("C:/a")).toBe(true);
    expect(isAbsolutePath("rel/path")).toBe(false);
  });

  it("isPathInsideOrEqual does not match only by prefix", () => {
    expect(isPathInsideOrEqual("/a/b", "/a")).toBe(true);
    expect(isPathInsideOrEqual("/a", "/a")).toBe(true);
    expect(isPathInsideOrEqual("/ab", "/a")).toBe(false);
  });

  it("arePathsEqual normalizes separators and trailing slashes", () => {
    expect(arePathsEqual("/a/b", "/a/b/")).toBe(true);
    expect(arePathsEqual("C:\\a\\b", "C:/a/b")).toBe(true);
    expect(arePathsEqual("/a/b", "/a/c")).toBe(false);
  });

  it("remapDescendantPath rewrites self and descendants, ignores outsiders", () => {
    // 节点自身被重命名/移动
    expect(remapDescendantPath("/a/old", "/a/old", "/a/new")).toBe("/a/new");
    // 祖先目录被重命名 → 落在其下的文档跟随
    expect(remapDescendantPath("/a/old/sub/f.txt", "/a/old", "/a/new")).toBe("/a/new/sub/f.txt");
    // 移动到别处
    expect(remapDescendantPath("/a/dir/f.txt", "/a/dir", "/b/dir")).toBe("/b/dir/f.txt");
    // 不在被改节点之下 → null（仅前缀相同也不算）
    expect(remapDescendantPath("/a/other/f.txt", "/a/old", "/a/new")).toBeNull();
    expect(remapDescendantPath("/a/oldish/f.txt", "/a/old", "/a/new")).toBeNull();
  });

  it("remapDocumentAfterMove 同步自身与后代文档,无关文档保持同一引用", () => {
    const base = createUntitledDocument();
    const selfDoc = { ...base, path: "/ws/a/old.ts", name: "old.ts" };
    const childDoc = { ...base, path: "/ws/a/dir/f.ts", name: "f.ts" };
    const outsideDoc = { ...base, path: "/ws/b/g.ts", name: "g.ts" };

    // 文件本身被重命名:path + name + id 跟随
    const renamed = remapDocumentAfterMove(selfDoc, "/ws/a/old.ts", { path: "/ws/a/new.ts", name: "new.ts" });
    expect(renamed.path).toBe("/ws/a/new.ts");
    expect(renamed.name).toBe("new.ts");
    expect(renamed.id).not.toBe(selfDoc.id);

    // 祖先目录被移动:后代 path 跟随,name 不变
    const moved = remapDocumentAfterMove(childDoc, "/ws/a/dir", { path: "/ws/a/moved", name: "moved" });
    expect(moved.path).toBe("/ws/a/moved/f.ts");
    expect(moved.name).toBe("f.ts");

    // 不在受影响范围:原样返回同一引用(便于 React 跳过更新)
    expect(remapDocumentAfterMove(outsideDoc, "/ws/a/old.ts", { path: "/ws/a/new.ts", name: "new.ts" })).toBe(
      outsideDoc,
    );
  });

  it("getTreeAncestorDirectoryPaths returns ancestors from shallow to deep", () => {
    expect(getTreeAncestorDirectoryPaths("/root/a/b/file.ts", "/root")).toEqual(["/root/a", "/root/a/b"]);
    expect(getTreeAncestorDirectoryPaths("/root/file.ts", "/root")).toEqual([]);
    expect(getTreeAncestorDirectoryPaths("/other/a/file.ts", "/root")).toEqual([]);
  });
});

describe("getFileExtension", () => {
  it("handles casing, extensionless names, hidden files, and trailing dots", () => {
    expect(getFileExtension("File.TS")).toBe("ts");
    expect(getFileExtension("noext")).toBe("");
    expect(getFileExtension(".gitignore")).toBe("");
    expect(getFileExtension("a.")).toBe("");
  });
});

describe("formatFileSize", () => {
  it("formats byte, KB, and MB values", () => {
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("document helpers", () => {
  it("isDocumentDirty compares content with savedContent", () => {
    expect(isDocumentDirty(doc({ content: "a", savedContent: "a" }))).toBe(false);
    expect(isDocumentDirty(doc({ content: "a", savedContent: "b" }))).toBe(true);
  });

  it("requiresDocumentCloseConfirmation ignores blank untitled documents", () => {
    expect(
      requiresDocumentCloseConfirmation(doc({ content: "", savedContent: "", isUntitled: true })),
    ).toBe(false);
    expect(
      requiresDocumentCloseConfirmation(doc({ content: "", savedContent: undefined as never, isUntitled: true })),
    ).toBe(false);
  });

  it("requiresDocumentCloseConfirmation protects unsaved documents", () => {
    expect(requiresDocumentCloseConfirmation(doc({ content: "draft", savedContent: "", isUntitled: true }))).toBe(
      true,
    );
    expect(requiresDocumentCloseConfirmation(doc({ content: "a", savedContent: "b" }))).toBe(true);
  });

  it("getDocumentLines splits all newline forms and always returns at least one line", () => {
    expect(getDocumentLines(doc({ content: "a\nb\r\nc" }))).toEqual(["a", "b", "c"]);
    expect(getDocumentLines(doc({ content: "" }))).toEqual([""]);
  });

  it("upsertOpenDocument replaces existing documents and appends new ones", () => {
    const a = doc({ id: "a", content: "1" });
    const b = doc({ id: "b" });
    const c = doc({ id: "c" });

    expect(upsertOpenDocument([a, b], doc({ id: "a", content: "2" }))).toEqual([
      doc({ id: "a", content: "2" }),
      b,
    ]);
    expect(upsertOpenDocument([a, b], c)).toEqual([a, b, c]);
  });
});

describe("file tree helpers", () => {
  it("toFileTreeNode maps native directory entries to unloaded tree nodes", () => {
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

  it("updateTreeNode updates matching descendants", () => {
    const tree = [dir("src", "/p/src", [file("a.ts", "/p/src/a.ts")], true), file("r.md", "/p/r.md")];
    const next = updateTreeNode(tree, "/p/src/a.ts", (node) => ({ ...node, name: "renamed.ts" }));
    const child = (next[0].children ?? [])[0];

    expect(child.name).toBe("renamed.ts");
    expect(next[1]).toBe(tree[1]);
  });

  it("flattenVisibleTreeRows only includes expanded descendants", () => {
    const collapsed = [dir("src", "/p/src", [file("a.ts", "/p/src/a.ts")], false)];
    expect(flattenVisibleTreeRows(collapsed)).toHaveLength(1);

    const expanded = [dir("src", "/p/src", [file("a.ts", "/p/src/a.ts")], true)];
    const rows = flattenVisibleTreeRows(expanded);
    expect(rows).toHaveLength(2);
    expect(rows[1].depth).toBe(1);
    expect(rows[1].node.name).toBe("a.ts");
  });

  it("collapseTreeNodeDeep collapses nested directories", () => {
    const node = dir("src", "/p/src", [dir("sub", "/p/src/sub", [], true)], true);
    const collapsed = collapseTreeNodeDeep(node);

    expect(collapsed.expanded).toBe(false);
    expect((collapsed.children ?? [])[0].expanded).toBe(false);
  });

  it("mergeTreeNodesState keeps previous directory state", () => {
    const previous = [dir("src", "/p/src", [file("a.ts", "/p/src/a.ts")], true)];
    const fresh = [dir("src", "/p/src", [], false)];
    const merged = mergeTreeNodesState(fresh, previous);

    expect(merged[0].expanded).toBe(true);
    expect(merged[0].childrenLoaded).toBe(true);
  });

  it("findTreeNode returns matching descendants", () => {
    const tree = [dir("src", "/p/src", [dir("sub", "/p/src/sub", [file("a.ts", "/p/src/sub/a.ts")], true)], true)];

    expect(findTreeNode(tree, "/p/src/sub/a.ts")?.name).toBe("a.ts");
    expect(findTreeNode(tree, "/p/src/sub")?.kind).toBe("directory");
    expect(findTreeNode(tree, "/p/missing")).toBeUndefined();
  });
});

describe("getTabBorderAccent", () => {
  it("returns stable accents for known extension groups", () => {
    expect(getTabBorderAccent("a.ts")).toBe("#2563eb");
    expect(getTabBorderAccent("a.rs")).toBe("#b45309");
    expect(getTabBorderAccent("a.unknownext")).toBe("#94a3b8");
  });

  it("covers broad file extension branches", () => {
    expect(getTabBorderAccent("a.py")).toBe("#0369a1");
    expect(getTabBorderAccent("a.json")).toBe("#8b5cf6");
    expect(getTabBorderAccent("a.css")).toBe("#0d9488");
    expect(getTabBorderAccent("a.md")).toBe("#4338ca");
    expect(getTabBorderAccent("a.png")).toBe("#db2777");
    expect(getTabBorderAccent("a.sh")).toBe("#475569");
  });
});

describe("getCompactPath / getTailPath", () => {
  it("getCompactPath returns short paths unchanged", () => {
    expect(getCompactPath("/a/b")).toBe("/a/b");
  });

  it("getCompactPath keeps the requested number of tail segments", () => {
    expect(getCompactPath("/a/b/c/d/e/f", 2)).toBe(".../e/f");
  });

  it("getTailPath returns short paths unchanged", () => {
    expect(getTailPath("/a/b", 50)).toBe("/a/b");
  });

  it("getTailPath truncates long paths to a tail", () => {
    const result = getTailPath("/very/long/path/segment/here/more", 16);

    expect(result.startsWith(".../")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(20);
  });
});

describe("getFileTreeIcon", () => {
  it("uses folder icons based on expansion state", () => {
    expect(getFileTreeIcon(dir("src", "/p/src", [], true))).toMatchObject({
      iconName: "_folder_open",
      src: "/file-icons/catppuccin/_folder_open.svg",
    });
    expect(getFileTreeIcon(dir("src", "/p/src", [], false))).toMatchObject({
      iconName: "_folder",
      src: "/file-icons/catppuccin/_folder.svg",
    });
  });

  it("maps common text and source file extensions to Catppuccin icons", () => {
    expect(getFileTreeIcon(file("a.ts", "/a.ts")).iconName).toBe("typescript");
    expect(getFileTreeIcon(file("a.tsx", "/a.tsx")).iconName).toBe("typescript-react");
    expect(getFileTreeIcon(file("a.js", "/a.js")).iconName).toBe("javascript");
    expect(getFileTreeIcon(file("a.html", "/a.html")).iconName).toBe("html");
    expect(getFileTreeIcon(file("a.json", "/a.json")).iconName).toBe("json");
    expect(getFileTreeIcon(file("a.toml", "/a.toml")).iconName).toBe("toml");
    expect(getFileTreeIcon(file("a.xml", "/a.xml")).iconName).toBe("xml");
    expect(getFileTreeIcon(file("a.svg", "/a.svg")).iconName).toBe("svg");
    expect(getFileTreeIcon(file("a.java", "/a.java")).iconName).toBe("java");
    expect(getFileTreeIcon(file("a.vue", "/a.vue")).iconName).toBe("vue");
    expect(getFileTreeIcon(file("a.sh", "/a.sh")).iconName).toBe("bash");
    expect(getFileTreeIcon(file("a.csv", "/a.csv")).iconName).toBe("csv");
    expect(getFileTreeIcon(file("a.sql", "/a.sql")).iconName).toBe("database");
    expect(getFileTreeIcon(file("a.unknown", "/a.unknown")).iconName).toBe("_file");
  });

  it("maps media and archive extensions to available bundled icons", () => {
    expect(getFileTreeIcon(file("a.png", "/a.png")).iconName).toBe("image");
    expect(getFileTreeIcon(file("a.pdf", "/a.pdf")).iconName).toBe("pdf");
    expect(getFileTreeIcon(file("a.zip", "/a.zip")).iconName).toBe("zip");
  });

  it("prefers filename and composite suffix icons", () => {
    expect(getFileTreeIcon(file("package.json", "/package.json")).iconName).toBe("package-json");
    expect(getFileTreeIcon(file("component.test.tsx", "/component.test.tsx")).iconName).toBe("typescript-test");
    expect(getFileTreeIcon(file("schema.schema.json", "/schema.schema.json")).iconName).toBe("json-schema");
    expect(getFileTreeIcon(file(".gitignore", "/.gitignore")).iconName).toBe("git");
  });
});

describe("native error helpers", () => {
  it("getNativeSaveError preserves objects and wraps primitives", () => {
    const obj = { kind: "permission", message: "denied" };
    const err = new Error("boom");

    expect(getNativeSaveError(obj)).toBe(obj);
    expect(getNativeSaveError(err)).toBe(err);
    expect(getNativeSaveError("plain")).toEqual({ kind: "io", message: "plain" });
  });

  it("getNativeFileOperationError preserves objects and wraps primitives", () => {
    const obj = { message: "x" };
    const err = new Error("bad");

    expect(getNativeFileOperationError(obj)).toBe(obj);
    expect(getNativeFileOperationError(err)).toBe(err);
    expect(getNativeFileOperationError(42)).toEqual({ message: "42" });
  });
});

describe("project accents and initials", () => {
  it("getProjectInitials derives uppercase initials", () => {
    expect(getProjectInitials("my-cool-project")).toBe("MC");
    expect(getProjectInitials("workbench")).toBe("W");
    expect(getProjectInitials("CamelCaseName")).toBe("CC");
  });

  it("getProjectAccentStyle and getTabAccent return stable palette values", () => {
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

  it("returns null when there is no overflow", () => {
    expect(getEditorScrollbarGeometry("horizontal", metrics({ scrollWidth: 400, clientWidth: 400 }))).toBeNull();
    expect(getEditorScrollbarGeometry("vertical", metrics({ scrollHeight: 500, clientHeight: 500 }))).toBeNull();
  });

  it("returns thumb geometry when content overflows", () => {
    const horizontal = getEditorScrollbarGeometry("horizontal", metrics());
    const vertical = getEditorScrollbarGeometry("vertical", metrics());

    expect(horizontal).not.toBeNull();
    expect(horizontal!.thumbSize).toBeGreaterThan(0);
    expect(horizontal!.maxScroll).toBeGreaterThan(0);
    expect(vertical).not.toBeNull();
    expect(vertical!.thumbSize).toBeGreaterThan(0);
  });
});

describe("tree state merge and collapse", () => {
  it("mergeTreeNodeState returns files and missing previous nodes unchanged", () => {
    const node = file("a.ts", "/a.ts");

    expect(mergeTreeNodeState(node)).toBe(node);
    expect(mergeTreeNodeState(node, dir("a.ts", "/a.ts"))).toBe(node);
  });

  it("mergeTreeNodeState preserves previous directory children and state", () => {
    const previous = dir("src", "/src", [file("x", "/src/x")], true);
    const fresh = dir("src", "/src", [], false);
    const merged = mergeTreeNodeState(fresh, previous);

    expect(merged.expanded).toBe(true);
    expect(merged.childrenLoaded).toBe(true);
    expect(merged.children).toHaveLength(1);
  });

  it("collapseTreeNodesDeep collapses every directory", () => {
    const nodes = [dir("src", "/src", [dir("sub", "/src/sub", [], true)], true)];
    const collapsed = collapseTreeNodesDeep(nodes);

    expect(collapsed[0].expanded).toBe(false);
    expect((collapsed[0].children ?? [])[0].expanded).toBe(false);
  });
});

describe("document creation helpers", () => {
  it("createUntitledDocument creates a blank untitled document", () => {
    const document = createUntitledDocument();

    expect(document.isUntitled).toBe(true);
    expect(document.content).toBe("");
    expect(document.name).toBe("Untitled.txt");
    expect(document.id).toMatch(/^untitled-/);
  });

  it("getFileOpenId combines path and timestamp", () => {
    expect(getFileOpenId("/a/b.ts", 123)).toBe("/a/b.ts-123");
  });
});

describe("quick search history", () => {
  it("normalizes empty and duplicate history entries", () => {
    expect(normalizeQuickSearchHistory([" README ", "", "readme", "main.tsx"])).toEqual(["README", "main.tsx"]);
  });

  it("upserts a query at the front and deduplicates case-insensitively", () => {
    expect(upsertQuickSearchHistory(["README", "package.json"], " readme ")).toEqual(["readme", "package.json"]);
  });

  it("loads and saves history through localStorage", () => {
    window.localStorage.clear();
    saveQuickSearchHistory(["alpha", "beta"]);
    expect(loadQuickSearchHistory()).toEqual(["alpha", "beta"]);

    window.localStorage.setItem("norn.quickSearchHistory", "not json");
    expect(loadQuickSearchHistory()).toEqual([]);
  });
});

describe("editor search history", () => {
  it("normalizes and upserts editor search history", () => {
    expect(normalizeEditorSearchHistory([" const ", "CONST", "render"])).toEqual(["const", "render"]);
    expect(upsertEditorSearchHistory(["const", "render"], " render ")).toEqual(["render", "const"]);
  });

  it("loads and saves editor search history through localStorage", () => {
    window.localStorage.clear();
    saveEditorSearchHistory(["const", "render"]);
    expect(loadEditorSearchHistory()).toEqual(["const", "render"]);

    window.localStorage.setItem("norn.editorSearchHistory", "not json");
    expect(loadEditorSearchHistory()).toEqual([]);
  });
});
