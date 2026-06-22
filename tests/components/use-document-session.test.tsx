// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentSession } from "@/features/workbench/hooks/use-document-session";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import type { NativeSavedTextFile, WorkbenchDocument } from "@/features/workbench/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const makeDoc = (over: Partial<WorkbenchDocument> = {}): WorkbenchDocument => ({
  id: "a",
  name: "a.ts",
  path: "/abs/a.ts",
  content: "x",
  savedContent: "x",
  mode: "editable",
  ...over,
});

const setTauri = (enabled: boolean) => {
  const win = window as Window & { __TAURI_INTERNALS__?: unknown };
  if (enabled) {
    win.__TAURI_INTERNALS__ = {};
  } else {
    delete win.__TAURI_INTERNALS__;
  }
};

const resetStore = (document: WorkbenchDocument, openDocuments: WorkbenchDocument[] = [document]) =>
  useWorkbenchStore.setState({
    document,
    openDocuments,
    saveState: "idle",
    saveConflict: null,
    pendingCloseDocument: null,
    fileError: null,
    folderView: null,
    leftPanelOpen: true,
    gitWorkspace: { kind: "loading" } as never,
  });

beforeEach(() => {
  invokeMock.mockReset();
  setTauri(false);
});

afterEach(() => {
  setTauri(false);
});

describe("纯 store 编排(无需 invoke)", () => {
  it("activateDocument 设为当前并 upsert 到打开列表", () => {
    resetStore(makeDoc({ id: "a" }));
    const { result } = renderHook(() => useDocumentSession());
    const next = makeDoc({ id: "b", name: "b.ts" });

    act(() => result.current.activateDocument(next));

    const state = useWorkbenchStore.getState();
    expect(state.document.id).toBe("b");
    expect(state.openDocuments.map((d) => d.id)).toEqual(["a", "b"]);
    expect(state.saveState).toBe("saved");
    expect(state.saveConflict).toBeNull();
  });

  it("closeDocument 关闭当前页时选中相邻页", () => {
    const a = makeDoc({ id: "a" });
    const b = makeDoc({ id: "b", name: "b.ts" });
    resetStore(a, [a, b]);
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.closeDocument(a));

    const state = useWorkbenchStore.getState();
    expect(state.openDocuments.map((d) => d.id)).toEqual(["b"]);
    expect(state.document.id).toBe("b");
  });

  it("closeDocument 关闭最后一页时新建未命名文档", () => {
    const a = makeDoc({ id: "a" });
    resetStore(a, [a]);
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.closeDocument(a));

    const state = useWorkbenchStore.getState();
    expect(state.openDocuments).toHaveLength(1);
    expect(state.document.isUntitled).toBe(true);
    expect(state.saveState).toBe("idle");
  });

  it("requestCloseDocument 干净文档直接关闭、脏文档转待确认", () => {
    const clean = makeDoc({ id: "a", content: "x", savedContent: "x" });
    const other = makeDoc({ id: "b", name: "b.ts" });
    resetStore(clean, [clean, other]);
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.requestCloseDocument(clean));
    expect(useWorkbenchStore.getState().openDocuments.map((d) => d.id)).toEqual(["b"]);

    const dirty = makeDoc({ id: "c", content: "changed", savedContent: "orig" });
    resetStore(dirty, [dirty]);
    act(() => result.current.requestCloseDocument(dirty));
    const state = useWorkbenchStore.getState();
    expect(state.pendingCloseDocument?.id).toBe("c");
    expect(state.openDocuments).toHaveLength(1);
  });

  it("createFile 清空文件夹视图并激活未命名文档", () => {
    resetStore(makeDoc({ id: "a" }));
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.createFile());

    const state = useWorkbenchStore.getState();
    expect(state.document.isUntitled).toBe(true);
    expect(state.folderView).toBeNull();
    expect(state.leftPanelOpen).toBe(false);
    expect(state.gitWorkspace).toEqual({ kind: "idle" });
  });

  it("updateDocumentContent 写入新内容并置 idle", () => {
    resetStore(makeDoc({ id: "a", content: "x", savedContent: "x" }));
    useWorkbenchStore.setState({ saveState: "saved" });
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.updateDocumentContent("y"));

    const state = useWorkbenchStore.getState();
    expect(state.document.content).toBe("y");
    expect(state.saveState).toBe("idle");
  });
});

describe("保存动作(mock invoke)", () => {
  it("非 Tauri 环境保存报错", async () => {
    resetStore(makeDoc({ id: "a", path: "/abs/a.ts", isUntitled: false }));
    setTauri(false);
    const { result } = renderHook(() => useDocumentSession());

    let returned: WorkbenchDocument | null = makeDoc();
    await act(async () => {
      returned = await result.current.saveDocument();
    });

    expect(returned).toBeNull();
    const state = useWorkbenchStore.getState();
    expect(state.saveState).toBe("error");
    expect(state.fileError).toContain("Tauri");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("saveDocument 成功调用 save_text_file 并刷新文档", async () => {
    resetStore(makeDoc({ id: "a", path: "/abs/a.ts", content: "new", savedContent: "old", lastModified: 100 }));
    setTauri(true);
    const saved: NativeSavedTextFile = { name: "a.ts", path: "/abs/a.ts", size: 3, lastModified: 200 };
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "save_text_file" ? saved : null));

    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      await result.current.saveDocument();
    });

    expect(invokeMock).toHaveBeenCalledWith("save_text_file", {
      path: "/abs/a.ts",
      content: "new",
      expectedLastModified: 100,
      force: false,
    });
    const state = useWorkbenchStore.getState();
    expect(state.document.savedContent).toBe("new");
    expect(state.document.lastModified).toBe(200);
    expect(state.saveState).toBe("saved");
  });

  it("saveDocument 对未命名文档转走 saveDocumentAs(弹保存对话框)", async () => {
    resetStore(makeDoc({ id: "a", name: "Untitled.txt", path: "Untitled.txt", isUntitled: true }));
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "open_save_dialog" ? null : null));

    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      await result.current.saveDocument();
    });

    expect(invokeMock).toHaveBeenCalledWith("open_save_dialog", { defaultName: "Untitled.txt" });
  });

  it("saveDocumentAs 取消(对话框返回 null)不写文件", async () => {
    resetStore(makeDoc({ id: "a", content: "x", savedContent: "x" }));
    setTauri(true);
    invokeMock.mockResolvedValue(null);

    const { result } = renderHook(() => useDocumentSession());

    let returned: WorkbenchDocument | null = makeDoc();
    await act(async () => {
      returned = await result.current.saveDocumentAs();
    });

    expect(returned).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("open_save_dialog", { defaultName: "a.ts" });
    expect(invokeMock).not.toHaveBeenCalledWith("save_text_file_as", expect.anything());
  });

  it("saveDocumentAs 成功写入新路径", async () => {
    resetStore(makeDoc({ id: "a", name: "a.ts", path: "/abs/a.ts", content: "body", savedContent: "body" }));
    setTauri(true);
    const saved: NativeSavedTextFile = { name: "new.ts", path: "/abs/new.ts", size: 4, lastModified: 9 };
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "open_save_dialog") return "/abs/new.ts";
      if (cmd === "save_text_file_as") return saved;
      return null;
    });

    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      await result.current.saveDocumentAs();
    });

    expect(invokeMock).toHaveBeenCalledWith("save_text_file_as", { path: "/abs/new.ts", content: "body" });
    const state = useWorkbenchStore.getState();
    expect(state.document.path).toBe("/abs/new.ts");
    expect(state.document.name).toBe("new.ts");
    expect(state.saveState).toBe("saved");
  });
});
