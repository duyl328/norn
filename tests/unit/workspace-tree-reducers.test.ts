import { describe, expect, it } from "vitest";

import type { FileTreeNode, FolderView, ScratchFolder, ScratchFolderView } from "@/features/workbench/types";
import {
  applyFolderEntries,
  applyFolderError,
  applyFolderNodeChildren,
  applyScratchEntries,
  applyScratchError,
  collapseScratchNode,
  expandLoadedScratchNode,
  markFolderLoading,
  markFolderNodeExpanding,
  markScratchLoading,
  toggleFolderNode,
  toggleFolderRoot,
  toggleScratchRoot,
} from "@/features/workbench/workspace-tree-reducers";

const file = (name: string, path: string): FileTreeNode => ({ name, path, relativePath: path, kind: "file" });

const dir = (name: string, path: string, children: FileTreeNode[] = [], expanded = false): FileTreeNode => ({
  name,
  path,
  relativePath: path,
  kind: "directory",
  children,
  childrenLoaded: children.length > 0,
  expanded,
});

const folderView = (nodes: FileTreeNode[], overrides: Partial<FolderView> = {}): FolderView => ({
  rootPath: "/root",
  rootName: "root",
  origin: "open-folder",
  nodes,
  rootExpanded: true,
  loadingPath: null,
  error: null,
  ...overrides,
});

const scratchView = (nodes: FileTreeNode[], overrides: Partial<ScratchFolderView> = {}): ScratchFolderView => ({
  nodes,
  expanded: true,
  loading: false,
  loadingPath: null,
  error: null,
  ...overrides,
});

const folder: ScratchFolder = { name: "scratch", path: "/scratch" };

describe("FolderView reducers", () => {
  it("markFolderLoading 设置 loadingPath 并清空 error", () => {
    const next = markFolderLoading(folderView([], { error: "old" }), "/root/sub");
    expect(next.loadingPath).toBe("/root/sub");
    expect(next.error).toBeNull();
  });

  it("applyFolderEntries 根路径替换 nodes(不保留展开)", () => {
    const view = folderView([file("old.ts", "/root/old.ts")]);
    const next = applyFolderEntries(view, "/root", [file("new.ts", "/root/new.ts")], false);
    expect(next.nodes).toEqual([file("new.ts", "/root/new.ts")]);
    expect(next.loadingPath).toBeNull();
  });

  it("applyFolderEntries 根路径保留展开时做状态合并", () => {
    const view = folderView([dir("src", "/root/src", [file("a.ts", "/root/src/a.ts")], true)]);
    const next = applyFolderEntries(view, "/root", [dir("src", "/root/src", [], false)], true);
    expect(next.nodes[0].expanded).toBe(true);
    expect(next.nodes[0].childrenLoaded).toBe(true);
  });

  it("applyFolderEntries 非根路径写入对应节点 children", () => {
    const view = folderView([dir("src", "/root/src", [], false)]);
    const next = applyFolderEntries(view, "/root/src", [file("a.ts", "/root/src/a.ts")], false);
    expect(next.nodes[0].children).toHaveLength(1);
    expect(next.nodes[0].childrenLoaded).toBe(true);
    expect(next.nodes[0].expanded).toBe(true);
  });

  it("applyFolderError 根路径设置顶层 error", () => {
    const next = applyFolderError(folderView([]), "/root", "boom");
    expect(next.error).toBe("boom");
    expect(next.loadingPath).toBeNull();
  });

  it("applyFolderError 非根路径设置节点 error", () => {
    const view = folderView([dir("src", "/root/src", [], false)]);
    const next = applyFolderError(view, "/root/src", "denied");
    expect(next.nodes[0].error).toBe("denied");
    expect(next.error).toBeNull();
  });

  it("toggleFolderNode 在展开/折叠间切换", () => {
    const collapsed = folderView([dir("src", "/root/src", [file("a.ts", "/root/src/a.ts")], false)]);
    expect(toggleFolderNode(collapsed, "/root/src").nodes[0].expanded).toBe(true);

    const expanded = folderView([dir("src", "/root/src", [file("a.ts", "/root/src/a.ts")], true)]);
    expect(toggleFolderNode(expanded, "/root/src").nodes[0].expanded).toBe(false);
  });

  it("markFolderNodeExpanding 标记节点展开并记录 loadingPath", () => {
    const view = folderView([dir("src", "/root/src", [], false)]);
    const next = markFolderNodeExpanding(view, "/root/src");
    expect(next.loadingPath).toBe("/root/src");
    expect(next.nodes[0].expanded).toBe(true);
  });

  it("applyFolderNodeChildren 写入子节点并清 loadingPath", () => {
    const view = folderView([dir("src", "/root/src", [], false)], { loadingPath: "/root/src" });
    const next = applyFolderNodeChildren(view, "/root/src", [file("a.ts", "/root/src/a.ts")]);
    expect(next.loadingPath).toBeNull();
    expect(next.nodes[0].children).toHaveLength(1);
    expect(next.nodes[0].childrenLoaded).toBe(true);
  });

  it("toggleFolderRoot 折叠时同时深折叠子节点", () => {
    const view = folderView([dir("src", "/root/src", [], true)], { rootExpanded: true });
    const collapsed = toggleFolderRoot(view);
    expect(collapsed.rootExpanded).toBe(false);
    expect(collapsed.nodes[0].expanded).toBe(false);

    expect(toggleFolderRoot(folderView([], { rootExpanded: false })).rootExpanded).toBe(true);
  });
});

describe("ScratchFolderView reducers", () => {
  it("markScratchLoading 根路径应用 expand,非根保留 expanded", () => {
    expect(markScratchLoading(scratchView([], { expanded: false }), folder, "/scratch", true).expanded).toBe(true);
    expect(markScratchLoading(scratchView([], { expanded: true }), folder, "/scratch/sub", false).expanded).toBe(true);
  });

  it("applyScratchEntries 根路径替换 nodes,非根写入节点", () => {
    const rootNext = applyScratchEntries(scratchView([]), folder, "/scratch", [file("a", "/scratch/a")], true);
    expect(rootNext.nodes).toHaveLength(1);
    expect(rootNext.loading).toBe(false);

    const childView = scratchView([dir("sub", "/scratch/sub", [], false)]);
    const childNext = applyScratchEntries(childView, folder, "/scratch/sub", [file("b", "/scratch/sub/b")], true);
    expect(childNext.nodes[0].children).toHaveLength(1);
  });

  it("applyScratchError 根路径保留 nodes,非根写节点 error", () => {
    const rootNext = applyScratchError(scratchView([file("a", "/scratch/a")]), folder, "/scratch", "boom");
    expect(rootNext.nodes).toHaveLength(1);
    expect(rootNext.error).toBe("boom");

    const childView = scratchView([dir("sub", "/scratch/sub", [], false)]);
    expect(applyScratchError(childView, folder, "/scratch/sub", "x").nodes[0].error).toBe("x");
  });

  it("toggleScratchRoot 折叠时深折叠子节点", () => {
    const collapsed = toggleScratchRoot(scratchView([dir("sub", "/scratch/sub", [], true)], { expanded: true }));
    expect(collapsed.expanded).toBe(false);
    expect(collapsed.nodes[0].expanded).toBe(false);
    expect(toggleScratchRoot(scratchView([], { expanded: false })).expanded).toBe(true);
  });

  it("collapseScratchNode 折叠指定节点", () => {
    const view = scratchView([dir("sub", "/scratch/sub", [], true)]);
    expect(collapseScratchNode(view, "/scratch/sub").nodes[0].expanded).toBe(false);
  });

  it("expandLoadedScratchNode 展开节点并深折叠其子节点", () => {
    const view = scratchView([dir("sub", "/scratch/sub", [dir("deep", "/scratch/sub/deep", [], true)], false)]);
    const next = expandLoadedScratchNode(view, "/scratch/sub");
    expect(next.nodes[0].expanded).toBe(true);
    expect((next.nodes[0].children ?? [])[0].expanded).toBe(false);
  });
});
