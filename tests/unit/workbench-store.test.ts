import { beforeEach, describe, expect, it } from "vitest";

import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import { initialDocument } from "@/features/workbench/workbench-utils";

const reset = () =>
  useWorkbenchStore.setState({
    document: initialDocument,
    openDocuments: [initialDocument],
    leftPanelOpen: false,
    leftPanelWidth: 260,
    quickSearchHistory: [],
    saveState: "idle",
  });

describe("useWorkbenchStore", () => {
  beforeEach(reset);

  it("初始状态正确", () => {
    const state = useWorkbenchStore.getState();
    expect(state.document).toBe(initialDocument);
    expect(state.openDocuments).toEqual([initialDocument]);
    expect(state.document.name).toBe("Untitled.txt");
    expect(state.document.content).toBe("");
    expect(state.document.isUntitled).toBe(true);
    expect(state.leftPanelOpen).toBe(false);
    expect(state.gitWorkspace).toEqual({ kind: "idle" });
    expect(state.saveState).toBe("idle");
  });

  it("setter 支持直接赋值", () => {
    useWorkbenchStore.getState().setLeftPanelOpen(true);
    expect(useWorkbenchStore.getState().leftPanelOpen).toBe(true);

    useWorkbenchStore.getState().setSaveState("saving");
    expect(useWorkbenchStore.getState().saveState).toBe("saving");
  });

  it("setter 支持函数式更新（读取当前值）", () => {
    useWorkbenchStore.getState().setLeftPanelOpen((value) => !value);
    expect(useWorkbenchStore.getState().leftPanelOpen).toBe(true);

    useWorkbenchStore.getState().setLeftPanelWidth((width) => width + 40);
    expect(useWorkbenchStore.getState().leftPanelWidth).toBe(300);
  });

  it("openDocuments 函数式更新可追加", () => {
    const extra = { ...initialDocument, id: "doc-2", name: "b.ts" };
    useWorkbenchStore.getState().setOpenDocuments((docs) => [...docs, extra]);
    expect(useWorkbenchStore.getState().openDocuments).toHaveLength(2);
    expect(useWorkbenchStore.getState().openDocuments[1].id).toBe("doc-2");
  });

  it("所有 setter 都能写入对应字段", () => {
    const store = useWorkbenchStore.getState();

    store.setDocument({ ...initialDocument, id: "doc-x" });
    store.setPendingCloseDocument({ ...initialDocument, id: "pending" });
    store.setSaveConflict({ kind: "disk-changed" } as never);
    store.setRightPanelOpen(true);
    store.setRightPanelWidth(320);
    store.setResizingPanel("left");
    store.setResizeHandleHintsVisible(true);
    store.setScratchPanelHeight(180);
    store.setSettingsOpen(true);
    store.setSearchOpen(true);
    store.setQuickSearchHistory(["README"]);
    store.setFileError("oops");
    store.setFolderView({ kind: "folder" } as never);
    store.setGitWorkspace({ kind: "loading" } as never);
    store.setRecentFolders([{ path: "/p", name: "p" } as never]);
    store.setScratchFolder({ path: "/s", name: "s" } as never);
    store.setScratchFolderView((view) => ({ ...view, loading: true }));
    store.setFileTreeClipboard({ mode: "copy" } as never);
    store.setFileTreeContextMenu({ x: 1, y: 2 } as never);
    store.setFileTreeNameDialog({ mode: "create" } as never);
    store.setFileTreeNameValue("new-name.ts");
    store.setFileTreeTrashTarget({ path: "/t" } as never);
    store.setDraggedTreeNode({ path: "/d" } as never);
    store.setDropTarget({ path: "/drop", scope: "main" });

    const next = useWorkbenchStore.getState();
    expect(next.document.id).toBe("doc-x");
    expect(next.pendingCloseDocument?.id).toBe("pending");
    expect(next.rightPanelOpen).toBe(true);
    expect(next.rightPanelWidth).toBe(320);
    expect(next.resizingPanel).toBe("left");
    expect(next.resizeHandleHintsVisible).toBe(true);
    expect(next.scratchPanelHeight).toBe(180);
    expect(next.settingsOpen).toBe(true);
    expect(next.searchOpen).toBe(true);
    expect(next.quickSearchHistory).toEqual(["README"]);
    expect(next.fileError).toBe("oops");
    expect(next.recentFolders).toHaveLength(1);
    expect(next.scratchFolderView.loading).toBe(true);
    expect(next.fileTreeNameValue).toBe("new-name.ts");
    expect(next.dropTarget).toEqual({ path: "/drop", scope: "main" });
  });
});
