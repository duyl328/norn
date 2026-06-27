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
    workspacePath: "/mock/project",
    gitAvailable: true,
    isRepository: true,
    gitRoot: "/mock/project",
    hasDotGit: true,
    branch: "main",
    message: "Git repository",
  },
};

describe("StatusBar", () => {
  beforeEach(() => {
    const store = useWorkbenchStore.getState();
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

  it("显示文件路径、行数、大小和保存状态", () => {
    render(
      <StatusBar document={document} gitWorkspace={idleGit} isDirty={false} onOpenSettings={() => {}} saveState="saved" />,
    );

    expect(screen.getByRole("button", { name: "/mock/project/README.md" })).toBeInTheDocument();
    expect(screen.getByText("2 lines")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
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

    render(
      <StatusBar
        document={document}
        gitWorkspace={readyGit}
        isDirty={false}
        onOpenSettings={() => {}}
        saveState="saved"
      />,
    );

    const branchButton = screen.getByRole("button", { name: /main/ });
    expect(branchButton).toHaveAttribute("title", "查看和切换 Git 分支");

    fireEvent.pointerDown(branchButton, { button: 0, ctrlKey: false });

    expect(await screen.findByText("当前分支")).toBeInTheDocument();
    expect(screen.getByText("feature/status-branch")).toBeInTheDocument();
  });
});
