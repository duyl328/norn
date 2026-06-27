// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GitPanel } from "@/features/workbench/components/git-panel";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";
import type { FolderView, GitWorkspaceState } from "@/features/workbench/types";

const noop = () => {};

const folderView: FolderView = {
  error: null,
  loadingPath: null,
  nodes: [],
  origin: "open-folder",
  rootExpanded: true,
  rootName: "project",
  rootPath: "/mock/project",
};

const renderPanel = (options: { folderView: FolderView | null; gitWorkspace: GitWorkspaceState }) =>
  render(
    <GitPanel
      folderView={options.folderView}
      gitWorkspace={options.gitWorkspace}
      onOpenCommitDiff={noop}
      onOpenDiff={noop}
      onOpenFile={noop}
    />,
  );

describe("GitPanel", () => {
  beforeEach(() => {
    useWorkbenchStore.setState({
      gitBranches: null,
      gitBusy: false,
      gitError: null,
      gitPanelMode: "commit",
      gitRecentCommits: [],
      gitStatus: null,
    });
    vi.clearAllMocks();
  });

  it("prompts to open a folder before Git can be used", () => {
    renderPanel({ folderView: null, gitWorkspace: { kind: "idle" } });

    expect(screen.getByText("尚未打开工作区")).toBeInTheDocument();
    expect(screen.getByText("请先从左侧打开一个文件夹，然后再查看 Git 变更。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建 Git 仓库" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText("工作区已干净")).not.toBeInTheDocument();
  });

  it("offers to initialize Git when the open folder is not a repository", () => {
    renderPanel({
      folderView,
      gitWorkspace: {
        kind: "ready",
        inspection: {
          branch: null,
          gitAvailable: true,
          gitRoot: null,
          gitVersion: "git version 2.50.0",
          hasDotGit: false,
          isRepository: false,
          message: "当前文件夹还没有 .git 目录。",
          workspacePath: "/mock/project",
        },
      },
    });

    expect(screen.getByText("当前文件夹不是 Git 仓库")).toBeInTheDocument();
    expect(screen.getByText("当前文件夹还没有 .git 目录。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建 Git 仓库" })).toBeEnabled();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByText("无本地分支")).not.toBeInTheDocument();
  });
});
