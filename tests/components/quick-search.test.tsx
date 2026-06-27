// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickSearch } from "@/features/workbench/components/quick-search";
import { I18nProvider } from "@/features/workbench/i18n-provider";
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

const renderWithI18n = (ui: ReactNode) => render(<I18nProvider>{ui}</I18nProvider>);

describe("QuickSearch", () => {
  beforeEach(() => {
    resetStore();
    window.localStorage.clear();
  });

  it("stores the submitted search query in history", () => {
    renderWithI18n(<QuickSearch open onClose={() => {}} />);

    const input = screen.getByPlaceholderText("按名称搜索文件");
    fireEvent.change(input, { target: { value: "README" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(useWorkbenchStore.getState().quickSearchHistory).toEqual(["README"]);
    expect(window.localStorage.getItem("norn.quickSearchHistory")).toBe(JSON.stringify(["README"]));
  });

  it("uses a selected history entry as the active query", () => {
    useWorkbenchStore.getState().setQuickSearchHistory(["README", "package"]);
    renderWithI18n(<QuickSearch open onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "使用搜索历史：README" }));

    expect(screen.getByPlaceholderText("按名称搜索文件")).toHaveValue("README");
    // 文件名结果会高亮匹配字符(<mark> 拆分文本),按 textContent 校验整条路径仍然渲染。
    expect(
      screen.getByText(
        (_, element) =>
          element?.classList.contains("windows-quick-search-result-detail") === true &&
          element?.textContent === "/mock/project/README.md",
      ),
    ).toBeInTheDocument();
    expect(useWorkbenchStore.getState().quickSearchHistory).toEqual(["README", "package"]);
  });

  it("clears search history", () => {
    useWorkbenchStore.getState().setQuickSearchHistory(["README"]);
    renderWithI18n(<QuickSearch open onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "清空搜索历史" }));

    expect(useWorkbenchStore.getState().quickSearchHistory).toEqual([]);
    expect(screen.getByText("输入以搜索文件")).toBeInTheDocument();
  });
});
