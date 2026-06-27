import { afterEach, describe, expect, it, vi } from "vitest";

import { type ActionDeps, buildActions } from "@/features/workbench/actions/use-actions";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import { initialDocument } from "@/features/workbench/workbench-utils";

const deps = (overrides: Partial<ActionDeps> = {}): ActionDeps => ({
  createFile: vi.fn(),
  activateDocument: vi.fn(),
  openFilePicker: vi.fn(),
  openFolderPicker: vi.fn(),
  saveDocument: vi.fn(),
  saveDocumentAs: vi.fn(),
  toggleFilesTool: vi.fn(),
  openSearchTool: vi.fn(),
  openSettingsTool: vi.fn(),
  ...overrides,
});

afterEach(() => {
  useWorkbenchStore.setState({ document: initialDocument, openDocuments: [initialDocument] });
});

describe("buildActions", () => {
  it("registers Alt+ArrowLeft/Right for switching open files", () => {
    const actions = buildActions(deps());

    expect(actions.find((action) => action.id === "navigate.previousFile")).toMatchObject({
      keys: ["Alt+ArrowLeft"],
      capture: true,
    });
    expect(actions.find((action) => action.id === "navigate.nextFile")).toMatchObject({
      keys: ["Alt+ArrowRight"],
      capture: true,
    });
  });

  it("cycles between open documents", () => {
    const activateDocument = vi.fn();
    const actions = buildActions(deps({ activateDocument }));
    const previous = actions.find((action) => action.id === "navigate.previousFile")!;
    const next = actions.find((action) => action.id === "navigate.nextFile")!;
    const docs = [
      { id: "a", name: "a.ts", path: "/tmp/a.ts", content: "", savedContent: "", mode: "editable" as const },
      { id: "b", name: "b.ts", path: "/tmp/b.ts", content: "", savedContent: "", mode: "editable" as const },
      { id: "c", name: "c.ts", path: "/tmp/c.ts", content: "", savedContent: "", mode: "editable" as const },
    ];

    useWorkbenchStore.setState({ document: docs[1], openDocuments: docs });

    previous.run({ store: useWorkbenchStore.getState() });
    expect(activateDocument).toHaveBeenLastCalledWith("a");

    next.run({ store: useWorkbenchStore.getState() });
    expect(activateDocument).toHaveBeenLastCalledWith("c");
  });
});
