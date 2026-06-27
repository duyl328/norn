// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBar } from "@/features/workbench/components/status-bar";
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
    branch: "main",
    gitAvailable: true,
    gitRoot: "/mock/project",
    hasDotGit: true,
    isRepository: true,
    message: "Git 仓库已就绪。",
    workspacePath: "/mock/project",
  },
};

describe("StatusBar", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      gitBranches: null,
      gitStatus: null,
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("显示文件路径、行数、大小和保存状态", () => {
    render(
      <StatusBar document={document} gitWorkspace={idleGit} isDirty={false} onOpenSettings={() => {}} saveState="saved" />,
    );

    expect(screen.getByRole("button", { name: "/mock/project/README.md" })).toBeInTheDocument();
    expect(screen.getByText("2 lines")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("未检测到完整 Git 仓库时不显示底部 Git 信息", () => {
    render(
      <StatusBar document={document} gitWorkspace={idleGit} isDirty={false} onOpenSettings={() => {}} saveState="saved" />,
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

    render(
      <StatusBar
        document={document}
        gitWorkspace={readyGit}
        isDirty={false}
        onOpenSettings={() => {}}
        saveState="saved"
      />,
    );

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-2")).toBeInTheDocument();
    expect(screen.getByText("1 files")).toBeInTheDocument();
  });

  it("large-readonly 文档显示只读 range 状态", () => {
    render(
      <StatusBar
        document={{ ...document, mode: "large-readonly" }}
        gitWorkspace={idleGit}
        isDirty={false}
        onOpenSettings={() => {}}
        saveState="saved"
      />,
    );

    expect(screen.getByText("Read-only")).toBeInTheDocument();
    expect(screen.getByText("Read-only range")).toBeInTheDocument();
  });

  it("点击设置按钮触发 onOpenSettings", () => {
    const onOpenSettings = vi.fn();
    render(
      <StatusBar
        document={document}
        gitWorkspace={idleGit}
        isDirty={false}
        onOpenSettings={onOpenSettings}
        saveState="saved"
      />,
    );

    fireEvent.click(screen.getAllByRole("button").at(-1)!);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("copies the document path from the status bar", async () => {
    render(
      <StatusBar
        document={document}
        gitWorkspace={idleGit}
        isDirty={false}
        onOpenSettings={() => {}}
        saveState="saved"
      />,
    );

    const pathButton = screen.getByRole("button", { name: document.path });
    fireEvent.click(pathButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(document.path);
    await waitFor(() => expect(pathButton).toHaveClass("status-path-token-copied"));
  });
});
