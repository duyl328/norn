import { beforeEach, describe, expect, it } from "vitest";

import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import { initialDocument } from "@/features/workbench/workbench-utils";

const reset = () =>
  useWorkbenchStore.setState({
    document: initialDocument,
    openDocuments: [initialDocument],
    leftPanelOpen: false,
    leftPanelWidth: 260,
    saveState: "idle",
  });

describe("useWorkbenchStore", () => {
  beforeEach(reset);

  it("初始状态正确", () => {
    const state = useWorkbenchStore.getState();
    expect(state.document).toBe(initialDocument);
    expect(state.openDocuments).toEqual([initialDocument]);
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
});
