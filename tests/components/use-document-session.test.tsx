// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDocumentSession } from "@/features/workbench/hooks/use-document-session";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import type {
  NativeDirectoryEntry,
  NativeSavedTextFile,
  NativeTextFile,
  NativeTextFileInspection,
  WorkbenchDocument,
} from "@/features/workbench/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));

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

const makeInspection = (over: Partial<NativeTextFileInspection> = {}): NativeTextFileInspection => ({
  name: "a.ts",
  path: "/abs/a.ts",
  size: 3,
  lastModified: 200,
  isBinary: false,
  isUtf8: true,
  isText: true,
  encoding: "utf-8",
  encodingLabel: "UTF-8",
  encodingConfidence: 0.98,
  encodingCandidates: [
    { encoding: "utf-8", label: "UTF-8", confidence: 0.98, valid: true, recommended: true },
    { encoding: "gb18030", label: "GB18030 / GBK", confidence: 0, valid: false, recommended: false },
  ],
  hasBom: false,
  sample: "",
  ...over,
});

const makeNativeTextFile = (over: Partial<NativeTextFile> = {}): NativeTextFile => ({
  name: "a.ts",
  path: "/abs/a.ts",
  content: "new",
  size: 3,
  lastModified: 200,
  encoding: "utf-8",
  encodingLabel: "UTF-8",
  encodingCandidates: [
    { encoding: "utf-8", label: "UTF-8", confidence: 0.98, valid: true, recommended: true },
    { encoding: "gb18030", label: "GB18030 / GBK", confidence: 0, valid: false, recommended: false },
  ],
  hasBom: false,
  ...over,
});

const makeSavedFile = (over: Partial<NativeSavedTextFile> = {}): NativeSavedTextFile => ({
  name: "a.ts",
  path: "/abs/a.ts",
  size: 3,
  lastModified: 200,
  encoding: "utf-8",
  encodingLabel: "UTF-8",
  hasBom: false,
  ...over,
});

const makeDirectoryEntry = (over: Partial<NativeDirectoryEntry> = {}): NativeDirectoryEntry => ({
  name: "cba.ts",
  path: "/abs/cba.ts",
  relativePath: "cba.ts",
  kind: "file",
  size: 5,
  lastModified: 100,
  isHidden: false,
  isSymlink: false,
  targetKind: null,
  canonicalPath: "/abs/cba.ts",
  isReadonly: false,
  error: null,
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
  vi.useRealTimers();
  setTauri(false);
});

afterEach(() => {
  vi.useRealTimers();
  setTauri(false);
});

describe("document store operations", () => {
  it("activates a document and upserts it into open documents", () => {
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

  it("selects a neighboring tab after closing the active document", () => {
    const a = makeDoc({ id: "a" });
    const b = makeDoc({ id: "b", name: "b.ts" });
    resetStore(a, [a, b]);
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.closeDocument(a));

    const state = useWorkbenchStore.getState();
    expect(state.openDocuments.map((d) => d.id)).toEqual(["b"]);
    expect(state.document.id).toBe("b");
  });

  it("creates a new untitled document after closing the last tab", () => {
    const a = makeDoc({ id: "a" });
    resetStore(a, [a]);
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.closeDocument(a));

    const state = useWorkbenchStore.getState();
    expect(state.openDocuments).toHaveLength(1);
    expect(state.document.isUntitled).toBe(true);
    expect(state.saveState).toBe("idle");
  });

  it("closes clean documents immediately and auto-saves dirty on-disk documents on close", async () => {
    const clean = makeDoc({ id: "a", content: "x", savedContent: "x" });
    const other = makeDoc({ id: "b", name: "b.ts" });
    resetStore(clean, [clean, other]);
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.requestCloseDocument(clean));
    expect(useWorkbenchStore.getState().openDocuments.map((d) => d.id)).toEqual(["b"]);

    const dirty = makeDoc({ id: "c", content: "changed", savedContent: "orig" });
    resetStore(dirty, [dirty]);
    invokeMock.mockResolvedValue({
      path: dirty.path,
      name: "c.ts",
      lastModified: 1,
      size: 7,
      encoding: "utf-8",
      encodingLabel: "UTF-8",
      hasBom: false,
    });

    act(() => result.current.requestCloseDocument(dirty));

    // 已有本地归宿的脏文件:静默存盘后关闭,不再弹确认框。
    await waitFor(() => expect(useWorkbenchStore.getState().openDocuments.some((d) => d.id === "c")).toBe(false));
    expect(invokeMock).toHaveBeenCalledWith("save_text_file", expect.objectContaining({ content: "changed" }));
    expect(useWorkbenchStore.getState().pendingCloseDocument).toBeNull();
  });

  it("auto-saves dirty background documents on close instead of asking", async () => {
    const active = makeDoc({ id: "active", name: "active.ts", content: "x", savedContent: "x" });
    const dirty = makeDoc({ id: "dirty", name: "dirty.ts", content: "changed", savedContent: "old" });
    resetStore(active, [active, dirty]);
    invokeMock.mockResolvedValue({
      path: dirty.path,
      name: "dirty.ts",
      lastModified: 1,
      size: 7,
      encoding: "utf-8",
      encodingLabel: "UTF-8",
      hasBom: false,
    });
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.requestCloseDocument(dirty));

    await waitFor(() => expect(useWorkbenchStore.getState().openDocuments.map((d) => d.id)).toEqual(["active"]));
    expect(invokeMock).toHaveBeenCalledWith("save_text_file", expect.objectContaining({ content: "changed" }));
    expect(useWorkbenchStore.getState().pendingCloseDocument).toBeNull();
    expect(useWorkbenchStore.getState().document.id).toBe("active");
  });

  it("keeps dirty on-disk documents open when auto-save fails on close", async () => {
    const dirty = makeDoc({ id: "dirty", name: "dirty.ts", content: "changed", savedContent: "old" });
    resetStore(dirty, [dirty]);
    invokeMock.mockRejectedValueOnce({ kind: "modified", message: "changed outside" });
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.requestCloseDocument(dirty));

    await waitFor(() => expect(useWorkbenchStore.getState().saveConflict?.path).toBe(dirty.path));
    expect(useWorkbenchStore.getState().openDocuments.map((d) => d.id)).toEqual(["dirty"]);
    expect(useWorkbenchStore.getState().document.id).toBe("dirty");
    expect(useWorkbenchStore.getState().pendingCloseDocument).toBeNull();
  });

  it("closes empty untitled documents without confirmation", () => {
    const untitled = makeDoc({
      id: "untitled",
      name: "Untitled.txt",
      path: "Untitled.txt",
      content: "",
      savedContent: "",
      isUntitled: true,
    });
    const other = makeDoc({ id: "b", name: "b.ts" });
    resetStore(untitled, [untitled, other]);
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.requestCloseDocument(untitled));

    const state = useWorkbenchStore.getState();
    expect(state.pendingCloseDocument).toBeNull();
    expect(state.openDocuments.map((d) => d.id)).toEqual(["b"]);
  });

  it("asks before closing a non-empty untitled tab (no saved local file yet)", () => {
    const untitled = makeDoc({
      id: "untitled",
      name: "Untitled",
      path: "Untitled",
      content: "draft",
      savedContent: "",
      isUntitled: true,
    });
    resetStore(untitled, [untitled]);
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.requestCloseDocument(untitled));

    // 关这个 tab = 要丢掉它,先弹框让用户决定(保存 / 放弃),不能直接关。
    const state = useWorkbenchStore.getState();
    expect(state.pendingCloseDocument?.id).toBe("untitled");
    expect(state.openDocuments).toHaveLength(1);
  });

  it("creates a new file and clears folder/git context", () => {
    resetStore(makeDoc({ id: "a" }));
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.createFile());

    const state = useWorkbenchStore.getState();
    expect(state.document.isUntitled).toBe(true);
    expect(state.folderView).toBeNull();
    expect(state.leftPanelOpen).toBe(false);
    expect(state.gitWorkspace).toEqual({ kind: "idle" });
  });

  it("updates document content and marks save state idle", () => {
    resetStore(makeDoc({ id: "a", content: "x", savedContent: "x" }));
    useWorkbenchStore.setState({ saveState: "saved" });
    const { result } = renderHook(() => useDocumentSession());

    act(() => result.current.updateDocumentContent("y"));

    const state = useWorkbenchStore.getState();
    expect(state.document.content).toBe("y");
    expect(state.saveState).toBe("idle");
  });
});

describe("save operations", () => {
  it("reports an error outside Tauri", async () => {
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

  it("saves an existing document without changing its id", async () => {
    resetStore(makeDoc({ id: "a", path: "/abs/a.ts", content: "new", savedContent: "old", lastModified: 100 }));
    setTauri(true);
    const saved = makeSavedFile();
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
      encoding: "utf-8",
      hasBom: false,
    });
    const state = useWorkbenchStore.getState();
    expect(state.document.id).toBe("a");
    expect(state.document.savedContent).toBe("new");
    expect(state.document.lastModified).toBe(200);
    expect(state.saveState).toBe("saved");
  });

  it("routes untitled documents through Save As", async () => {
    resetStore(makeDoc({ id: "a", name: "Untitled.txt", path: "Untitled.txt", isUntitled: true }));
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string) => (cmd === "open_save_dialog" ? null : null));

    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      await result.current.saveDocument();
    });

    expect(invokeMock).toHaveBeenCalledWith("open_save_dialog", { defaultName: "Untitled.txt" });
  });

  it("saves untitled documents to the path chosen by the user", async () => {
    resetStore(
      makeDoc({
        id: "untitled",
        name: "Untitled.txt",
        path: "Untitled.txt",
        content: "draft",
        savedContent: "",
        isUntitled: true,
      }),
    );
    setTauri(true);
    const saved = makeSavedFile({ name: "notes.txt", path: "/abs/notes.txt", size: 5, lastModified: 300 });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "open_save_dialog") return "/abs/notes.txt";
      if (cmd === "save_text_file_as") return saved;
      return null;
    });

    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      await result.current.saveDocument();
    });

    expect(invokeMock).toHaveBeenCalledWith("open_save_dialog", { defaultName: "Untitled.txt" });
    expect(invokeMock).toHaveBeenCalledWith("save_text_file_as", {
      path: "/abs/notes.txt",
      content: "draft",
      encoding: "utf-8",
      hasBom: false,
    });
    const state = useWorkbenchStore.getState();
    expect(state.document.isUntitled).toBe(false);
    expect(state.document.path).toBe("/abs/notes.txt");
    expect(state.document.savedContent).toBe("draft");
    expect(state.saveState).toBe("saved");
  });

  it("does not write when Save As is cancelled", async () => {
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

  it("changes document id when Save As writes to a new path", async () => {
    resetStore(makeDoc({ id: "a", name: "a.ts", path: "/abs/a.ts", content: "body", savedContent: "body" }));
    setTauri(true);
    const saved = makeSavedFile({ name: "new.ts", path: "/abs/new.ts", size: 4, lastModified: 9 });
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "open_save_dialog") return "/abs/new.ts";
      if (cmd === "save_text_file_as") return saved;
      return null;
    });

    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      await result.current.saveDocumentAs();
    });

    expect(invokeMock).toHaveBeenCalledWith("save_text_file_as", {
      path: "/abs/new.ts",
      content: "body",
      encoding: "utf-8",
      hasBom: false,
    });
    const state = useWorkbenchStore.getState();
    expect(state.document.id).not.toBe("a");
    expect(state.document.path).toBe("/abs/new.ts");
    expect(state.document.name).toBe("new.ts");
    expect(state.saveState).toBe("saved");
  });

  it("reopens a clean document with the selected encoding", async () => {
    resetStore(
      makeDoc({ id: "a", path: "/abs/big5.txt", content: "garbled", savedContent: "garbled", lastModified: 100 }),
    );
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "read_text_file") {
        return makeNativeTextFile({
          name: "big5.txt",
          path: "/abs/big5.txt",
          content: "繁體中文：你好",
          encoding: "big5",
          encodingLabel: "Big5",
        });
      }
      return null;
    });

    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      await result.current.changeDocumentEncoding({ label: "Big5", value: "big5" });
    });

    expect(invokeMock).toHaveBeenCalledWith("read_text_file", { path: "/abs/big5.txt", encoding: "big5" });
    const state = useWorkbenchStore.getState();
    expect(state.document.content).toBe("繁體中文：你好");
    expect(state.document.savedContent).toBe("繁體中文：你好");
    expect(state.document.encoding).toBe("big5");
    expect(state.saveState).toBe("saved");
  });

  it("changes the save encoding for dirty documents without reloading content", async () => {
    resetStore(
      makeDoc({
        id: "a",
        path: "/abs/gbk.txt",
        content: "local edit",
        savedContent: "old",
        encoding: "gb18030",
        encodingLabel: "GB18030 / GBK",
      }),
    );
    setTauri(true);
    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      await result.current.changeDocumentEncoding({ label: "UTF-8", value: "utf-8" });
    });

    expect(invokeMock).not.toHaveBeenCalledWith("read_text_file", expect.anything());
    const state = useWorkbenchStore.getState();
    expect(state.document.content).toBe("local edit");
    expect(state.document.savedContent).toBe("old");
    expect(state.document.encoding).toBe("utf-8");
    expect(state.document.encodingLabel).toBe("UTF-8");
    expect(state.saveState).toBe("idle");
  });

  it("auto reloads a clean document when the disk version changes", async () => {
    resetStore(makeDoc({ id: "a", path: "/abs/a.ts", content: "old", savedContent: "old", lastModified: 100 }));
    setTauri(true);
    const reloaded = makeNativeTextFile();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "inspect_text_file") return makeInspection();
      if (cmd === "read_text_file") return reloaded;
      return null;
    });

    renderHook(() => useDocumentSession());

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const state = useWorkbenchStore.getState();
    expect(state.document.id).toBe("a");
    expect(state.document.content).toBe("new");
    expect(state.document.savedContent).toBe("new");
    expect(state.document.lastModified).toBe(200);
    expect(state.saveConflict).toBeNull();
    expect(state.saveState).toBe("saved");
  });

  it("prompts for conflict when a dirty document changes on disk", async () => {
    resetStore(makeDoc({ id: "a", path: "/abs/a.ts", content: "local", savedContent: "old", lastModified: 100 }));
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "inspect_text_file") return makeInspection({ size: 6 });
      if (cmd === "read_text_file") {
        return makeNativeTextFile({ content: "disk", size: 4 });
      }
      return null;
    });

    renderHook(() => useDocumentSession());

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const state = useWorkbenchStore.getState();
    expect(state.document.content).toBe("local");
    expect(state.saveConflict?.path).toBe("/abs/a.ts");
    expect(state.saveConflict?.content).toBe("local");
    expect(state.saveConflict?.diskContent).toBe("disk");
    expect(state.saveState).toBe("idle");
  });

  it("prompts when the active document is deleted on disk", async () => {
    resetStore(makeDoc({ id: "a", path: "/abs/a.ts", content: "local", savedContent: "local", lastModified: 100 }));
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "inspect_text_file") throw new Error("Unable to read file metadata for /abs/a.ts: not found");
      return null;
    });

    renderHook(() => useDocumentSession());

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const state = useWorkbenchStore.getState();
    expect(state.saveConflict?.diskMissing).toBe(true);
    expect(state.saveConflict?.content).toBe("local");
    expect(state.saveState).toBe("idle");
  });

  it("updates the active clean document path when a same-folder rename is detected", async () => {
    resetStore(
      makeDoc({ id: "a", path: "/abs/abc.ts", content: "local", savedContent: "local", size: 5, lastModified: 100 }),
    );
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "inspect_text_file") throw new Error("Unable to read file metadata for /abs/abc.ts: not found");
      if (cmd === "list_directory") return [makeDirectoryEntry()];
      return null;
    });

    renderHook(() => useDocumentSession());

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const state = useWorkbenchStore.getState();
    expect(state.document.id).toBe("a");
    expect(state.document.path).toBe("/abs/cba.ts");
    expect(state.document.name).toBe("cba.ts");
    expect(state.document.content).toBe("local");
    expect(state.saveConflict).toBeNull();
  });

  it("updates only the path for dirty documents when a same-folder rename is detected", async () => {
    resetStore(
      makeDoc({ id: "a", path: "/abs/abc.ts", content: "dirty", savedContent: "local", size: 5, lastModified: 100 }),
    );
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "inspect_text_file") throw new Error("Unable to read file metadata for /abs/abc.ts: not found");
      if (cmd === "list_directory") return [makeDirectoryEntry()];
      return null;
    });

    renderHook(() => useDocumentSession());

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const state = useWorkbenchStore.getState();
    expect(state.document.path).toBe("/abs/cba.ts");
    expect(state.document.content).toBe("dirty");
    expect(state.document.savedContent).toBe("local");
    expect(state.saveConflict).toBeNull();
  });

  it("auto reloads clean background open documents", async () => {
    const active = makeDoc({
      id: "active",
      path: "/abs/active.ts",
      content: "active",
      savedContent: "active",
      lastModified: 100,
    });
    const background = makeDoc({
      id: "bg",
      name: "bg.ts",
      path: "/abs/bg.ts",
      content: "old",
      savedContent: "old",
      lastModified: 100,
    });
    resetStore(active, [active, background]);
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "inspect_text_file" && args?.path === "/abs/active.ts")
        return makeInspection({ path: "/abs/active.ts", lastModified: 100 });
      if (cmd === "inspect_text_file" && args?.path === "/abs/bg.ts")
        return makeInspection({ name: "bg.ts", path: "/abs/bg.ts", lastModified: 200 });
      if (cmd === "read_text_file" && args?.path === "/abs/bg.ts") {
        return makeNativeTextFile({ name: "bg.ts", path: "/abs/bg.ts", content: "new" });
      }
      return null;
    });

    renderHook(() => useDocumentSession());

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    const state = useWorkbenchStore.getState();
    const updated = state.openDocuments.find((openDocument) => openDocument.id === "bg");
    expect(state.document.id).toBe("active");
    expect(updated?.content).toBe("new");
    expect(updated?.savedContent).toBe("new");
    expect(updated?.lastModified).toBe(200);
    expect(updated?.diskConflict).toBeUndefined();
  });

  it("stores background dirty document conflicts until the tab is activated", async () => {
    const active = makeDoc({
      id: "active",
      path: "/abs/active.ts",
      content: "active",
      savedContent: "active",
      lastModified: 100,
    });
    const background = makeDoc({
      id: "bg",
      name: "bg.ts",
      path: "/abs/bg.ts",
      content: "local",
      savedContent: "old",
      lastModified: 100,
    });
    resetStore(active, [active, background]);
    setTauri(true);
    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "inspect_text_file" && args?.path === "/abs/active.ts")
        return makeInspection({ path: "/abs/active.ts", lastModified: 100 });
      if (cmd === "inspect_text_file" && args?.path === "/abs/bg.ts")
        return makeInspection({ name: "bg.ts", path: "/abs/bg.ts", lastModified: 200 });
      if (cmd === "read_text_file" && args?.path === "/abs/bg.ts") {
        return makeNativeTextFile({ name: "bg.ts", path: "/abs/bg.ts", content: "disk", size: 4 });
      }
      return null;
    });

    const { result } = renderHook(() => useDocumentSession());

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    let state = useWorkbenchStore.getState();
    const conflicted = state.openDocuments.find((openDocument) => openDocument.id === "bg");
    expect(state.saveConflict).toBeNull();
    expect(conflicted?.diskConflict?.diskContent).toBe("disk");

    act(() => {
      result.current.activateDocument(conflicted!);
    });

    state = useWorkbenchStore.getState();
    expect(state.document.id).toBe("bg");
    expect(state.saveConflict?.diskContent).toBe("disk");
    expect(state.saveConflict?.content).toBe("local");
  });
});
