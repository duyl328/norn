// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickSearch } from "@/features/workbench/components/titlebar";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import { initialDocument } from "@/features/workbench/workbench-utils";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    minimize: vi.fn(),
    show: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn(),
  }),
}));

const resetStore = () => {
  useWorkbenchStore.setState({
    document: initialDocument,
    openDocuments: [
      initialDocument,
      {
        ...initialDocument,
        id: "readme",
        name: "README.md",
        path: "/mock/project/README.md",
      },
    ],
    folderView: null,
    scratchFolderView: {
      nodes: [],
      expanded: true,
      loading: false,
      loadingPath: null,
      error: null,
    },
    quickSearchHistory: [],
  });
};

describe("QuickSearch", () => {
  beforeEach(() => {
    resetStore();
    window.localStorage.clear();
  });

  it("stores the submitted search query in history", () => {
    render(<QuickSearch open onClose={() => {}} />);

    const input = screen.getByPlaceholderText("Search files, commands, symbols");
    fireEvent.change(input, { target: { value: "README" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useWorkbenchStore.getState().quickSearchHistory).toEqual(["README"]);
    expect(window.localStorage.getItem("norn.quickSearchHistory")).toBe(JSON.stringify(["README"]));
  });

  it("uses a selected history entry as the active query", () => {
    useWorkbenchStore.getState().setQuickSearchHistory(["README", "package"]);
    render(<QuickSearch open onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Use README from search history" }));

    expect(screen.getByPlaceholderText("Search files, commands, symbols")).toHaveValue("README");
    expect(screen.getByText("/mock/project/README.md")).toBeInTheDocument();
    expect(useWorkbenchStore.getState().quickSearchHistory).toEqual(["README", "package"]);
  });

  it("clears search history", () => {
    useWorkbenchStore.getState().setQuickSearchHistory(["README"]);
    render(<QuickSearch open onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear search history" }));

    expect(useWorkbenchStore.getState().quickSearchHistory).toEqual([]);
    expect(screen.getByText("No search history yet")).toBeInTheDocument();
  });
});
