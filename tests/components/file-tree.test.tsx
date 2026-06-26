// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FileTreePanel } from "@/features/workbench/components/file-tree";
import type {
  FileTreeClipboard,
  FileTreeContextMenuState,
  FileTreeNode,
  TreePanelView,
} from "@/features/workbench/types";

const treeView: TreePanelView = {
  error: null,
  loadingPath: null,
  nodes: [],
  rootExpanded: true,
  rootName: "project",
  rootPath: "/mock/project",
};

const noop = () => {};

const renderPanel = (contextMenu: FileTreeContextMenuState | null = null, clipboard: FileTreeClipboard | null = null) => {
  const onContextMenu = vi.fn();

  render(
    <FileTreePanel
      activePath="/mock/project/README.md"
      clipboard={clipboard}
      contextMenu={contextMenu}
      draggedNode={null}
      dropTarget={null}
      scope="main"
      search={null}
      selection={null}
      treeView={treeView}
      onCollapseAll={noop}
      onContextMenu={onContextMenu}
      onCopyNode={noop}
      onCopyPath={noop}
      onCutNode={noop}
      onDragEnd={noop}
      onDragNode={noop}
      onDropNode={noop}
      onDropTargetChange={noop}
      onExpandAll={noop}
      onOpenFile={noop}
      onOpenTerminal={noop}
      onPasteNode={noop}
      onRefreshFolder={noop}
      onRequestCreateDirectory={noop}
      onRequestCreateFile={noop}
      onRequestRenameNode={noop}
      onRequestTrashNode={noop}
      onRevealActiveFile={noop}
      onRevealNode={noop}
      onSelectNode={noop}
      onToggleDirectory={noop}
      onToggleRootDirectory={noop}
      onTreeBlur={noop}
      onTreeKeyDown={noop}
    />,
  );

  return { onContextMenu };
};

describe("FileTreePanel", () => {
  it("passes the root directory node when opening the root context menu", () => {
    const { onContextMenu } = renderPanel();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /project/ }));

    const [node, , scope] = onContextMenu.mock.calls[0] as [FileTreeNode, MouseEvent, "main"];
    expect(scope).toBe("main");
    expect(node).toMatchObject({
      kind: "directory",
      name: "project",
      path: "/mock/project",
      relativePath: ".",
    });
  });

  it("keeps root-only destructive context menu actions disabled", () => {
    renderPanel({
      node: { kind: "directory", name: "project", path: "/mock/project", relativePath: "." },
      scope: "main",
      x: 16,
      y: 20,
    });

    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move to Trash" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /Refresh/ })).toBeEnabled();
  });

  it("uses inline lucide icons instead of Catppuccin image assets in the tree", () => {
    renderPanel();

    const rootRow = screen.getByRole("treeitem", { name: /project/ });
    expect(rootRow.querySelector("svg.tree-row-icon")).not.toBeNull();
    expect(rootRow.querySelector("img.tree-row-icon")).toBeNull();
  });
});
