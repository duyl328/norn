import type { FileTreeNode, FolderView, ScratchFolder, ScratchFolderView } from "./types";
import { collapseTreeNodeDeep, collapseTreeNodesDeep, mergeTreeNodesState, updateTreeNode } from "./workbench-utils";

// 主文件夹树（FolderView）的纯状态变换 —————————————————————————————————————

export const markFolderLoading = (view: FolderView, path: string): FolderView => ({
  ...view,
  loadingPath: path,
  error: null,
});

export const applyFolderEntries = (
  view: FolderView,
  path: string,
  nextChildren: FileTreeNode[],
  preserveExpansion: boolean,
): FolderView => {
  if (path === view.rootPath) {
    return {
      ...view,
      nodes: preserveExpansion ? mergeTreeNodesState(nextChildren, view.nodes) : nextChildren,
      loadingPath: null,
      error: null,
    };
  }

  return {
    ...view,
    loadingPath: null,
    error: null,
    nodes: updateTreeNode(view.nodes, path, (currentNode) => ({
      ...currentNode,
      children: preserveExpansion ? mergeTreeNodesState(nextChildren, currentNode.children ?? []) : nextChildren,
      childrenLoaded: true,
      expanded: preserveExpansion ? currentNode.expanded : true,
      error: undefined,
    })),
  };
};

export const applyFolderError = (view: FolderView, path: string, message: string): FolderView => {
  if (path === view.rootPath) {
    return { ...view, loadingPath: null, error: message };
  }

  return {
    ...view,
    loadingPath: null,
    nodes: updateTreeNode(view.nodes, path, (currentNode) => ({
      ...currentNode,
      childrenLoaded: true,
      expanded: true,
      error: message,
    })),
  };
};

export const toggleFolderNode = (view: FolderView, path: string): FolderView => ({
  ...view,
  nodes: updateTreeNode(view.nodes, path, (currentNode) => ({
    ...(currentNode.expanded ? collapseTreeNodeDeep(currentNode) : currentNode),
    expanded: !currentNode.expanded,
  })),
});

export const markFolderNodeExpanding = (view: FolderView, path: string): FolderView => ({
  ...view,
  loadingPath: path,
  nodes: updateTreeNode(view.nodes, path, (currentNode) => ({
    ...currentNode,
    expanded: true,
    error: undefined,
  })),
});

export const applyFolderNodeChildren = (
  view: FolderView,
  path: string,
  children: FileTreeNode[],
): FolderView => ({
  ...view,
  loadingPath: null,
  nodes: updateTreeNode(view.nodes, path, (currentNode) => ({
    ...currentNode,
    children,
    childrenLoaded: true,
    expanded: true,
    error: undefined,
  })),
});

export const toggleFolderRoot = (view: FolderView): FolderView => {
  if (view.rootExpanded) {
    return { ...view, rootExpanded: false, nodes: collapseTreeNodesDeep(view.nodes) };
  }

  return { ...view, rootExpanded: true };
};

// scratch 文件夹树（ScratchFolderView）的纯状态变换 ————————————————————————

export const markScratchLoading = (
  view: ScratchFolderView,
  folder: ScratchFolder,
  path: string,
  expand: boolean,
): ScratchFolderView => ({
  ...view,
  expanded: path === folder.path ? expand : view.expanded,
  loading: true,
  loadingPath: path,
  error: null,
});

export const applyScratchEntries = (
  view: ScratchFolderView,
  folder: ScratchFolder,
  path: string,
  nextChildren: FileTreeNode[],
  expand: boolean,
): ScratchFolderView => ({
  ...view,
  nodes:
    path === folder.path
      ? nextChildren
      : updateTreeNode(view.nodes, path, (currentNode) => ({
          ...currentNode,
          children: nextChildren,
          childrenLoaded: true,
          expanded: true,
          error: undefined,
        })),
  expanded: path === folder.path ? expand : view.expanded,
  loading: false,
  loadingPath: null,
  error: null,
});

export const applyScratchError = (
  view: ScratchFolderView,
  folder: ScratchFolder,
  path: string,
  message: string,
): ScratchFolderView => ({
  ...view,
  loading: false,
  loadingPath: null,
  nodes:
    path === folder.path
      ? view.nodes
      : updateTreeNode(view.nodes, path, (currentNode) => ({
          ...currentNode,
          childrenLoaded: true,
          expanded: true,
          error: message,
        })),
  error: message,
});

export const toggleScratchRoot = (view: ScratchFolderView): ScratchFolderView => {
  if (view.expanded) {
    return { ...view, expanded: false, nodes: collapseTreeNodesDeep(view.nodes) };
  }

  return { ...view, expanded: true };
};

export const collapseScratchNode = (view: ScratchFolderView, path: string): ScratchFolderView => ({
  ...view,
  nodes: updateTreeNode(view.nodes, path, (currentNode) => collapseTreeNodeDeep(currentNode)),
});

export const expandLoadedScratchNode = (view: ScratchFolderView, path: string): ScratchFolderView => ({
  ...view,
  nodes: updateTreeNode(view.nodes, path, (currentNode) => ({
    ...currentNode,
    expanded: true,
    children: collapseTreeNodesDeep(currentNode.children ?? []),
  })),
});
