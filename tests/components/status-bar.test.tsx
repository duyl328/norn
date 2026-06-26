// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StatusBar } from "@/features/workbench/components/status-bar";
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

describe("StatusBar", () => {
  beforeEach(() => {
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
});
