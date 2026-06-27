// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBar } from "@/features/workbench/components/status-bar";
import { I18nProvider } from "@/features/workbench/i18n-provider";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import type { GitWorkspaceState, WorkbenchDocument } from "@/features/workbench/types";

const document: WorkbenchDocument = {
  id: "doc-1",
  name: "README.md",
  path: "/mock/project/README.md",
  content: "one\ntwo",
  savedContent: "one\ntwo",
  size: 2048,
  mode: "editable",
};

const idleGit: GitWorkspaceState = { kind: "idle" };
const readyGit: GitWorkspaceState = {
  kind: "ready",
  inspection: {
    workspacePath: "/mock/project",
    gitAvailable: true,
    isRepository: true,
    gitRoot: "/mock/project",
    hasDotGit: true,
    branch: "main",
    message: "Git repository",
  },
};

const renderWithI18n = (node: ReactElement) => {
  const result = render(<I18nProvider>{node}</I18nProvider>);

  return {
    ...result,
    rerenderWithI18n: (next: ReactElement) => result.rerender(<I18nProvider>{next}</I18nProvider>),
  };
};

describe("StatusBar", () => {
  beforeEach(() => {
    const store = useWorkbenchStore.getState();
    store.setLanguage("zh");
    store.setGitStatus(null);
    store.setGitBranches(null);
    store.setGitRecentCommits([]);
    store.setGitBusy(false);
    store.setGitError(null);

    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("显示文件路径、行数、大小和编码入口", () => {
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 2, column: 3 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "/mock/project/README.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ln 2, Col 3" })).toBeInTheDocument();
    expect(screen.queryByText("2 lines")).not.toBeInTheDocument();
    expect(screen.queryByText("2.0 KB")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UTF-8" })).toHaveClass("status-encoding-trigger");
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("编码切换菜单使用状态栏专属毛玻璃样式", async () => {
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "UTF-8" }), { button: 0, ctrlKey: false });

    expect(await screen.findByText("所有编码")).toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveClass("status-encoding-menu");
  });

  it("显示并切换换行符格式", async () => {
    const onChangeLineEnding = vi.fn();
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={{ ...document, content: "one\r\ntwo" }}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={onChangeLineEnding}
        onGoToLine={() => {}}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "CRLF" }), { button: 0, ctrlKey: false });

    expect(await screen.findByText("换行符")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "LF" }));
    expect(onChangeLineEnding).toHaveBeenCalledWith("lf");
  });

  it("点击光标位置可输入行号并跳转", () => {
    const onGoToLine = vi.fn();
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={onGoToLine}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ln 1, Col 1" }));
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("1,1");
    expect(screen.queryByRole("button", { name: "Ln 1, Col 1" })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.submit(input.closest("form")!);

    expect(input.closest("form")).toHaveClass("status-goto-line-form");
    expect(onGoToLine).toHaveBeenCalledWith(2, undefined);
  });

  it("快捷键请求会打开醒目的行号输入框", async () => {
    const { rerenderWithI18n } = renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 2, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    rerenderWithI18n(
      <StatusBar
        cursorPosition={{ line: 2, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={1}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    const input = await screen.findByRole("textbox");
    expect(input).toHaveValue("2,1");
    expect(input.closest("form")).toHaveClass("status-goto-line-popover");
    expect(screen.getByRole("button", { name: "Ln 2, Col 1" })).toBeInTheDocument();
  });

  it("按 Esc 关闭跳转输入并请求恢复编辑器焦点", async () => {
    const onCancelGoToLine = vi.fn();
    const { rerenderWithI18n } = renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 2, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={onCancelGoToLine}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    rerenderWithI18n(
      <StatusBar
        cursorPosition={{ line: 2, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={1}
        isDirty={false}
        onCancelGoToLine={onCancelGoToLine}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    const input = await screen.findByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCancelGoToLine).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("已有快捷键请求 id 的首次挂载不自动打开输入框", () => {
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 2, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={1}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ln 2, Col 1" })).toBeInTheDocument();
  });

  it("快捷键请求 id 变化才打开输入框", async () => {
    const { rerenderWithI18n } = renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 2, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={1}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    rerenderWithI18n(
      <StatusBar
        cursorPosition={{ line: 2, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={2}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    expect(await screen.findByRole("textbox")).toHaveValue("2,1");
  });

  it.each([
    ["12", 12, undefined],
    ["12:3", 12, 3],
    ["Ln 12, Col 3", 12, 3],
    ["Ln12 Col3", 12, 3],
  ])("行号输入支持格式 %s", (value, line, column) => {
    const onGoToLine = vi.fn();
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={onGoToLine}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ln 1, Col 1" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);

    expect(onGoToLine).toHaveBeenCalledWith(line, column);
  });

  it("未检测到完整 Git 仓库时不显示底部 Git 信息", () => {
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    expect(screen.queryByText("No Git")).not.toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
  });

  it("完整 Git 仓库时显示分支和变更统计", () => {
    useWorkbenchStore.setState({
      gitStatus: {
        ahead: 1,
        behind: 2,
        branch: "main",
        changes: [{ additions: 3, deletions: 1, path: "README.md", status: "modified" }],
        upstream: "origin/main",
      },
    });

    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={document}
        gitWorkspace={readyGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
    expect(screen.getByText("1 个文件")).toBeInTheDocument();
  });

  it("large-readonly 文档显示只读 range 状态", () => {
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={{ ...document, mode: "large-readonly" }}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    expect(screen.getByText("只读范围")).toBeInTheDocument();
  });

  it("copies the document path from the status bar", async () => {
    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={document}
        gitWorkspace={idleGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    const pathButton = screen.getByRole("button", { name: document.path });
    fireEvent.click(pathButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(document.path);
    await waitFor(() => expect(pathButton).toHaveClass("status-path-token-copied"));
  });

  it("在底部右侧显示 Git 分支快速切换入口", async () => {
    const store = useWorkbenchStore.getState();
    store.setGitStatus({
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      changes: [],
    });
    store.setGitBranches({
      current: "main",
      local: [
        { name: "main", upstream: "origin/main", ahead: 1, behind: 0, current: true, kind: "local" },
        { name: "feature/status-branch", upstream: null, ahead: 0, behind: 0, current: false, kind: "local" },
      ],
      remote: [],
    });

    renderWithI18n(
      <StatusBar
        cursorPosition={{ line: 1, column: 1 }}
        document={document}
        gitWorkspace={readyGit}
        goToLineRequestId={0}
        isDirty={false}
        onCancelGoToLine={() => {}}
        onChangeEncoding={() => {}}
        onChangeLineEnding={() => {}}
        onGoToLine={() => {}}
      />,
    );

    const branchButton = screen.getByRole("button", { name: /main/ });
    expect(branchButton).toHaveAttribute("title", "查看和切换 Git 分支");

    fireEvent.pointerDown(branchButton, { button: 0, ctrlKey: false });

    expect(await screen.findByText("当前分支")).toBeInTheDocument();
    expect(screen.getByText("feature/status-branch")).toBeInTheDocument();
  });
});
