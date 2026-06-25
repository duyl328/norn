import { create } from "zustand";

import { leftPanelDefaultWidth, rightPanelDefaultWidth, scratchPanelDefaultHeight } from "../constants";
import type {
  FileTreeClipboard,
  FileTreeContextMenuState,
  FileTreeNameDialog,
  FileTreeNode,
  FileTreeTrashTarget,
  FolderView,
  GitWorkspaceState,
  RecentFolder,
  SaveConflict,
  SaveState,
  ScratchFolder,
  ScratchFolderView,
  TreeDropTarget,
  TreeSearch,
  TreeSelection,
  WorkbenchDocument,
} from "../types";
import { initialDocument, loadEditorLineWrapping, loadRecentFolders, loadResizeHandleHints } from "../workbench-utils";

type StateSetter<T> = T | ((current: T) => T);

const resolveSetter = <T>(setter: StateSetter<T>, current: T): T =>
  typeof setter === "function" ? (setter as (value: T) => T)(current) : setter;

export interface WorkbenchState {
  // ---------------------------------------------------------------------------
  // documents
  // ---------------------------------------------------------------------------
  document: WorkbenchDocument;
  openDocuments: WorkbenchDocument[];
  pendingCloseDocument: WorkbenchDocument | null;
  saveConflict: SaveConflict | null;
  saveState: SaveState;
  setDocument: (setter: StateSetter<WorkbenchDocument>) => void;
  setOpenDocuments: (setter: StateSetter<WorkbenchDocument[]>) => void;
  setPendingCloseDocument: (setter: StateSetter<WorkbenchDocument | null>) => void;
  setSaveConflict: (setter: StateSetter<SaveConflict | null>) => void;
  setSaveState: (setter: StateSetter<SaveState>) => void;

  // ---------------------------------------------------------------------------
  // panels-layout
  // ---------------------------------------------------------------------------
  leftPanelOpen: boolean;
  leftPanelWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  resizingPanel: "left" | "right" | null;
  resizeHandleHintsVisible: boolean;
  editorLineWrapping: boolean;
  scratchPanelHeight: number;
  settingsOpen: boolean;
  searchOpen: boolean;
  commandPaletteOpen: boolean;
  keymapOverrides: Record<string, string[]>;
  setLeftPanelOpen: (setter: StateSetter<boolean>) => void;
  setLeftPanelWidth: (setter: StateSetter<number>) => void;
  setRightPanelOpen: (setter: StateSetter<boolean>) => void;
  setRightPanelWidth: (setter: StateSetter<number>) => void;
  setResizingPanel: (setter: StateSetter<"left" | "right" | null>) => void;
  setResizeHandleHintsVisible: (setter: StateSetter<boolean>) => void;
  setEditorLineWrapping: (setter: StateSetter<boolean>) => void;
  setScratchPanelHeight: (setter: StateSetter<number>) => void;
  setSettingsOpen: (setter: StateSetter<boolean>) => void;
  setSearchOpen: (setter: StateSetter<boolean>) => void;
  setCommandPaletteOpen: (setter: StateSetter<boolean>) => void;
  setKeymapOverrides: (setter: StateSetter<Record<string, string[]>>) => void;

  // ---------------------------------------------------------------------------
  // workspace
  // ---------------------------------------------------------------------------
  fileError: string | null;
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
  recentFolders: RecentFolder[];
  scratchFolder: ScratchFolder | null;
  scratchFolderView: ScratchFolderView;
  setFileError: (setter: StateSetter<string | null>) => void;
  setFolderView: (setter: StateSetter<FolderView | null>) => void;
  setGitWorkspace: (setter: StateSetter<GitWorkspaceState>) => void;
  setRecentFolders: (setter: StateSetter<RecentFolder[]>) => void;
  setScratchFolder: (setter: StateSetter<ScratchFolder | null>) => void;
  setScratchFolderView: (setter: StateSetter<ScratchFolderView>) => void;

  // ---------------------------------------------------------------------------
  // file-tree-interaction
  // ---------------------------------------------------------------------------
  fileTreeClipboard: FileTreeClipboard | null;
  fileTreeContextMenu: FileTreeContextMenuState | null;
  fileTreeNameDialog: FileTreeNameDialog | null;
  fileTreeNameValue: string;
  fileTreeTrashTarget: FileTreeTrashTarget | null;
  draggedTreeNode: FileTreeNode | null;
  dropTarget: TreeDropTarget | null;
  // 文件树多选:与编辑区打开的文件(document.path)解耦,仅随用户在树中的点击/键盘/定位变化。
  treeSelection: TreeSelection | null;
  // 文件树「即输即搜」当前查询(null = 未在搜索)。
  treeSearch: TreeSearch | null;
  setFileTreeClipboard: (setter: StateSetter<FileTreeClipboard | null>) => void;
  setFileTreeContextMenu: (setter: StateSetter<FileTreeContextMenuState | null>) => void;
  setFileTreeNameDialog: (setter: StateSetter<FileTreeNameDialog | null>) => void;
  setFileTreeNameValue: (setter: StateSetter<string>) => void;
  setFileTreeTrashTarget: (setter: StateSetter<FileTreeTrashTarget | null>) => void;
  setDraggedTreeNode: (setter: StateSetter<FileTreeNode | null>) => void;
  setDropTarget: (setter: StateSetter<TreeDropTarget | null>) => void;
  setTreeSelection: (setter: StateSetter<TreeSelection | null>) => void;
  setTreeSearch: (setter: StateSetter<TreeSearch | null>) => void;
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  // ---------------------------------------------------------------------------
  // documents
  // ---------------------------------------------------------------------------
  document: initialDocument,
  openDocuments: [initialDocument],
  pendingCloseDocument: null,
  saveConflict: null,
  saveState: "idle",
  setDocument: (setter) => set((state) => ({ document: resolveSetter(setter, state.document) })),
  setOpenDocuments: (setter) => set((state) => ({ openDocuments: resolveSetter(setter, state.openDocuments) })),
  setPendingCloseDocument: (setter) =>
    set((state) => ({ pendingCloseDocument: resolveSetter(setter, state.pendingCloseDocument) })),
  setSaveConflict: (setter) => set((state) => ({ saveConflict: resolveSetter(setter, state.saveConflict) })),
  setSaveState: (setter) => set((state) => ({ saveState: resolveSetter(setter, state.saveState) })),

  // ---------------------------------------------------------------------------
  // panels-layout
  // ---------------------------------------------------------------------------
  leftPanelOpen: false,
  leftPanelWidth: leftPanelDefaultWidth,
  rightPanelOpen: false,
  rightPanelWidth: rightPanelDefaultWidth,
  resizingPanel: null,
  resizeHandleHintsVisible: loadResizeHandleHints(),
  editorLineWrapping: loadEditorLineWrapping(),
  scratchPanelHeight: scratchPanelDefaultHeight,
  settingsOpen: false,
  searchOpen: false,
  commandPaletteOpen: false,
  // 启动时由 workbench-page 异步从 keybindings.json 载入(见 WorkbenchActionsRuntime)。
  keymapOverrides: {},
  setLeftPanelOpen: (setter) => set((state) => ({ leftPanelOpen: resolveSetter(setter, state.leftPanelOpen) })),
  setLeftPanelWidth: (setter) => set((state) => ({ leftPanelWidth: resolveSetter(setter, state.leftPanelWidth) })),
  setRightPanelOpen: (setter) => set((state) => ({ rightPanelOpen: resolveSetter(setter, state.rightPanelOpen) })),
  setRightPanelWidth: (setter) => set((state) => ({ rightPanelWidth: resolveSetter(setter, state.rightPanelWidth) })),
  setResizingPanel: (setter) => set((state) => ({ resizingPanel: resolveSetter(setter, state.resizingPanel) })),
  setResizeHandleHintsVisible: (setter) =>
    set((state) => ({ resizeHandleHintsVisible: resolveSetter(setter, state.resizeHandleHintsVisible) })),
  setEditorLineWrapping: (setter) =>
    set((state) => ({ editorLineWrapping: resolveSetter(setter, state.editorLineWrapping) })),
  setScratchPanelHeight: (setter) =>
    set((state) => ({ scratchPanelHeight: resolveSetter(setter, state.scratchPanelHeight) })),
  setSettingsOpen: (setter) => set((state) => ({ settingsOpen: resolveSetter(setter, state.settingsOpen) })),
  setSearchOpen: (setter) => set((state) => ({ searchOpen: resolveSetter(setter, state.searchOpen) })),
  setCommandPaletteOpen: (setter) =>
    set((state) => ({ commandPaletteOpen: resolveSetter(setter, state.commandPaletteOpen) })),
  setKeymapOverrides: (setter) =>
    set((state) => ({ keymapOverrides: resolveSetter(setter, state.keymapOverrides) })),

  // ---------------------------------------------------------------------------
  // workspace
  // ---------------------------------------------------------------------------
  fileError: null,
  folderView: null,
  gitWorkspace: { kind: "idle" },
  recentFolders: loadRecentFolders(),
  scratchFolder: null,
  scratchFolderView: {
    nodes: [],
    expanded: true,
    loading: false,
    loadingPath: null,
    error: null,
  },
  setFileError: (setter) => set((state) => ({ fileError: resolveSetter(setter, state.fileError) })),
  setFolderView: (setter) => set((state) => ({ folderView: resolveSetter(setter, state.folderView) })),
  setGitWorkspace: (setter) => set((state) => ({ gitWorkspace: resolveSetter(setter, state.gitWorkspace) })),
  setRecentFolders: (setter) => set((state) => ({ recentFolders: resolveSetter(setter, state.recentFolders) })),
  setScratchFolder: (setter) => set((state) => ({ scratchFolder: resolveSetter(setter, state.scratchFolder) })),
  setScratchFolderView: (setter) =>
    set((state) => ({ scratchFolderView: resolveSetter(setter, state.scratchFolderView) })),

  // ---------------------------------------------------------------------------
  // file-tree-interaction
  // ---------------------------------------------------------------------------
  fileTreeClipboard: null,
  fileTreeContextMenu: null,
  fileTreeNameDialog: null,
  fileTreeNameValue: "",
  fileTreeTrashTarget: null,
  draggedTreeNode: null,
  dropTarget: null,
  treeSelection: null,
  treeSearch: null,
  setFileTreeClipboard: (setter) =>
    set((state) => ({ fileTreeClipboard: resolveSetter(setter, state.fileTreeClipboard) })),
  setFileTreeContextMenu: (setter) =>
    set((state) => ({ fileTreeContextMenu: resolveSetter(setter, state.fileTreeContextMenu) })),
  setFileTreeNameDialog: (setter) =>
    set((state) => ({ fileTreeNameDialog: resolveSetter(setter, state.fileTreeNameDialog) })),
  setFileTreeNameValue: (setter) =>
    set((state) => ({ fileTreeNameValue: resolveSetter(setter, state.fileTreeNameValue) })),
  setFileTreeTrashTarget: (setter) =>
    set((state) => ({ fileTreeTrashTarget: resolveSetter(setter, state.fileTreeTrashTarget) })),
  setDraggedTreeNode: (setter) => set((state) => ({ draggedTreeNode: resolveSetter(setter, state.draggedTreeNode) })),
  setDropTarget: (setter) => set((state) => ({ dropTarget: resolveSetter(setter, state.dropTarget) })),
  setTreeSelection: (setter) => set((state) => ({ treeSelection: resolveSetter(setter, state.treeSelection) })),
  setTreeSearch: (setter) => set((state) => ({ treeSearch: resolveSetter(setter, state.treeSearch) })),
}));
