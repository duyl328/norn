// @vitest-environment jsdom

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/features/workbench/i18n-provider";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import type { WorkbenchDocument } from "@/features/workbench/types";
import { WorkbenchPage } from "@/features/workbench/workbench-page";

const onCloseRequestedMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    close: vi.fn(),
    minimize: vi.fn(),
    onCloseRequested: onCloseRequestedMock,
    onDragDropEvent: vi.fn(async () => vi.fn()),
    show: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn(),
  })),
}));

const makeDoc = (over: Partial<WorkbenchDocument> = {}): WorkbenchDocument => ({
  id: "a",
  name: "a.ts",
  path: "/abs/a.ts",
  content: "x",
  savedContent: "x",
  mode: "editable",
  ...over,
});

const invokeMock = vi.mocked(invoke);

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
    pendingCloseDocument: null,
    saveConflict: null,
    saveState: "idle",
    fileError: null,
    fileTreeClipboard: null,
    fileTreeContextMenu: null,
    fileTreeNameDialog: null,
    fileTreeNameValue: "",
    fileTreeTrashTarget: null,
    folderView: null,
    gitWorkspace: { kind: "idle" },
    leftPanelOpen: false,
    recentFolders: [],
    restoreLastWorkspace: false,
    scratchFolder: null,
    scratchFolderView: { nodes: [], expanded: false, loading: false, loadingPath: null, error: null },
    settingsOpen: false,
    searchOpen: false,
    draggedTreeNode: null,
    dropTarget: null,
    treeSearch: null,
    treeSelection: null,
  });

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string) => {
    if (cmd === "scratch_folder") return { name: "scratch", path: "/mock/scratch" };
    if (cmd === "list_directory") return [];
    return [];
  });
  onCloseRequestedMock.mockReset();
  onCloseRequestedMock.mockResolvedValue(vi.fn());
  setTauri(true);
});

describe("WorkbenchPage close protection", () => {
  const renderWorkbenchPage = () =>
    render(
      <I18nProvider>
        <WorkbenchPage />
      </I18nProvider>,
    );

  it("blocks native window close and focuses the first unsaved document", async () => {
    const clean = makeDoc({ id: "clean", name: "clean.ts", content: "x", savedContent: "x" });
    const dirty = makeDoc({ id: "dirty", name: "dirty.ts", content: "changed", savedContent: "old" });
    resetStore(clean, [clean, dirty]);

    renderWorkbenchPage();

    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalled());
    const handler = onCloseRequestedMock.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => void;
    const event = { preventDefault: vi.fn() };

    act(() => handler(event));

    const state = useWorkbenchStore.getState();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("destroy_current_window");
    expect(state.document.id).toBe("dirty");
    expect(state.pendingCloseDocument?.id).toBe("dirty");
    expect(screen.getByRole("dialog")).toHaveTextContent("未保存的更改");
  });

  it("allows native window close when no document needs confirmation", async () => {
    const clean = makeDoc({ id: "clean", name: "clean.ts", content: "x", savedContent: "x" });
    resetStore(clean, [clean]);

    renderWorkbenchPage();

    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalled());
    const handler = onCloseRequestedMock.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => void;
    const event = { preventDefault: vi.fn() };

    act(() => handler(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("destroy_current_window");
    expect(useWorkbenchStore.getState().pendingCloseDocument).toBeNull();
  });

  it("allows native window close with multiple empty untitled documents", async () => {
    const first = makeDoc({
      id: "untitled-1",
      name: "Untitled.txt",
      path: "Untitled.txt",
      content: "",
      savedContent: "",
      isUntitled: true,
    });
    const second = makeDoc({
      id: "untitled-2",
      name: "Untitled.txt",
      path: "Untitled.txt",
      content: "",
      savedContent: "",
      isUntitled: true,
    });
    resetStore(first, [first, second]);

    renderWorkbenchPage();

    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalled());
    const handler = onCloseRequestedMock.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => void;
    const event = { preventDefault: vi.fn() };

    act(() => handler(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("destroy_current_window");
    expect(useWorkbenchStore.getState().pendingCloseDocument).toBeNull();
  });

  it("allows native window close when an empty untitled document has incomplete persisted state", async () => {
    const untitled = makeDoc({
      id: "untitled",
      name: "Untitled.txt",
      path: "Untitled.txt",
      content: "",
      savedContent: undefined as never,
      isUntitled: true,
    });
    resetStore(untitled, [untitled]);

    renderWorkbenchPage();

    await waitFor(() => expect(onCloseRequestedMock).toHaveBeenCalled());
    const handler = onCloseRequestedMock.mock.calls[0]?.[0] as (event: { preventDefault: () => void }) => void;
    const event = { preventDefault: vi.fn() };

    expect(() => act(() => handler(event))).not.toThrow();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("destroy_current_window");
    expect(useWorkbenchStore.getState().pendingCloseDocument).toBeNull();
  });

  it("does not register native close protection outside Tauri", () => {
    setTauri(false);
    const clean = makeDoc({ id: "clean", name: "clean.ts", content: "x", savedContent: "x" });
    resetStore(clean, [clean]);

    renderWorkbenchPage();

    expect(getCurrentWindow().onCloseRequested).not.toHaveBeenCalled();
  });
});
