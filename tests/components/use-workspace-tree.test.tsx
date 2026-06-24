// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceTree } from "@/features/workbench/hooks/use-workspace-tree";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import type { FileTreeNode, NativeDirectoryEntry } from "@/features/workbench/types";
import { initialDocument } from "@/features/workbench/workbench-utils";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));

const invokeMock = vi.mocked(invoke);

const file = (name: string, path: string): FileTreeNode => ({ name, path, relativePath: path, kind: "file" });
const dir = (name: string, path: string): FileTreeNode => ({
  name,
  path,
  relativePath: path,
  kind: "directory",
  children: [],
  childrenLoaded: false,
  expanded: false,
});

const setTauri = (enabled: boolean) => {
  const win = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (enabled) {
    win.__TAURI_INTERNALS__ = {};
  } else {
    delete win.__TAURI_INTERNALS__;
  }
};

const baseStore = () =>
  useWorkbenchStore.setState({
    document: initialDocument,
    openDocuments: [initialDocument],
    folderView: null,
    scratchFolder: null,
    fileTreeClipboard: null,
    fileTreeContextMenu: null,
    fileTreeNameDialog: null,
    fileTreeNameValue: "",
    fileTreeTrashTarget: null,
    recentFolders: [],
    fileError: null,
    leftPanelOpen: false,
    gitWorkspace: { kind: "idle" },
  });

const renderTree = (requestFileOpen = vi.fn()) => ({
  requestFileOpen,
  ...renderHook(() => useWorkspaceTree({ requestFileOpen })),
});

beforeEach(() => {
  invokeMock.mockReset();
  setTauri(false);
  window.localStorage.clear();
  baseStore();
});

afterEach(() => setTauri(false));

describe("文件树剪贴板 / 菜单 / 对话框(同步 store)", () => {
  it("copyTreeNode / cutTreeNode 写入剪贴板并关菜单", () => {
    const { result } = renderTree();
    const node = file("a.ts", "/p/a.ts");

    act(() => result.current.copyTreeNode(node));
    expect(useWorkbenchStore.getState().fileTreeClipboard).toEqual({ action: "copy", nodes: [node] });

    act(() => result.current.cutTreeNode(node));
    expect(useWorkbenchStore.getState().fileTreeClipboard).toEqual({ action: "cut", nodes: [node] });
    expect(useWorkbenchStore.getState().fileTreeContextMenu).toBeNull();
  });

  it("requestTrashTreeNode 记录目标并关菜单", () => {
    const { result } = renderTree();
    const node = file("a.ts", "/p/a.ts");

    act(() => result.current.requestTrashTreeNode(node, "main"));

    const state = useWorkbenchStore.getState();
    expect(state.fileTreeTrashTarget).toEqual({ node, scope: "main" });
    expect(state.fileTreeContextMenu).toBeNull();
  });

  it("openFileTreeContextMenu 记录坐标与节点", () => {
    const { result } = renderTree();
    const node = file("a.ts", "/p/a.ts");
    const event = { preventDefault: vi.fn(), clientX: 12, clientY: 34 } as unknown as React.MouseEvent;

    act(() => result.current.openFileTreeContextMenu(node, event, "scratch"));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(useWorkbenchStore.getState().fileTreeContextMenu).toEqual({ node, scope: "scratch", x: 12, y: 34 });
  });

  it("openFileTreeNameDialog 重命名时预填名字、新建时清空", () => {
    const { result } = renderTree();

    act(() => result.current.openFileTreeNameDialog({ kind: "create-file", parentPath: "/p", scope: "main" }));
    expect(useWorkbenchStore.getState().fileTreeNameValue).toBe("");

    const node = file("old.ts", "/p/old.ts");
    act(() => result.current.openFileTreeNameDialog({ kind: "rename", node, scope: "main" }));
    expect(useWorkbenchStore.getState().fileTreeNameValue).toBe("old.ts");
  });

  it("closeFileTreeNameDialog 清空对话框与输入", () => {
    const { result } = renderTree();
    act(() => result.current.openFileTreeNameDialog({ kind: "create-file", parentPath: "/p" }));

    act(() => result.current.closeFileTreeNameDialog());
    const state = useWorkbenchStore.getState();
    expect(state.fileTreeNameDialog).toBeNull();
    expect(state.fileTreeNameValue).toBe("");
  });

  it("openTreeFile 仅对文件触发打开,目录忽略", async () => {
    const { result, requestFileOpen } = renderTree();

    await act(async () => result.current.openTreeFile(dir("src", "/p/src")));
    expect(requestFileOpen).not.toHaveBeenCalled();

    await act(async () => result.current.openTreeFile(file("a.ts", "/p/a.ts")));
    expect(requestFileOpen).toHaveBeenCalledWith({ kind: "path", path: "/p/a.ts", size: undefined });
  });
});

describe("文件夹打开(mock invoke)", () => {
  it("openFolderPicker 非 Tauri 环境报错", async () => {
    setTauri(false);
    const { result } = renderTree();

    await act(async () => {
      await result.current.openFolderPicker();
    });

    expect(useWorkbenchStore.getState().fileError).toContain("Tauri");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("openFolderView 读取目录并写入 folderView + 最近文件夹", async () => {
    const entries: NativeDirectoryEntry[] = [{ name: "a.ts", path: "/proj/a.ts", relativePath: "a.ts", kind: "file" }];
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "list_directory" ? entries : null));

    const { result } = renderTree();

    await act(async () => {
      await result.current.openFolderView("/proj", "open-folder");
    });

    expect(invokeMock).toHaveBeenCalledWith("list_directory", { path: "/proj" });
    await waitFor(() => {
      const state = useWorkbenchStore.getState();
      expect(state.folderView?.rootPath).toBe("/proj");
      expect(state.folderView?.nodes).toHaveLength(1);
    });
    expect(useWorkbenchStore.getState().recentFolders[0]).toMatchObject({ name: "proj", path: "/proj" });
  });
});

describe("移到回收站(mock invoke)", () => {
  it("confirmTrashTreeNode 调 trash_path 并清空目标", async () => {
    useWorkbenchStore.setState({
      folderView: {
        rootPath: "/proj",
        rootName: "proj",
        origin: "open-folder",
        nodes: [],
        rootExpanded: true,
        loadingPath: null,
        error: null,
      },
      fileTreeTrashTarget: { node: file("a.ts", "/proj/a.ts"), scope: "main" },
    });
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "list_directory" ? [] : undefined));

    const { result } = renderTree();

    await act(async () => {
      await result.current.confirmTrashTreeNode();
    });

    expect(invokeMock).toHaveBeenCalledWith("trash_path", { workspaceRoot: "/proj", path: "/proj/a.ts" });
    expect(useWorkbenchStore.getState().fileTreeTrashTarget).toBeNull();
  });
});
