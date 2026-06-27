import { create } from "zustand";

import { leftPanelDefaultWidth, rightPanelDefaultWidth, scratchPanelDefaultHeight } from "../constants";
import { type AppSettings, DEFAULT_SETTINGS } from "../settings";
import type {
  FileTreeClipboard,
  FileTreeContextMenuState,
  FileTreeNameDialog,
  FileTreeNode,
  FileTreeTrashTarget,
  FolderView,
  GitBranches,
  GitCommit,
  GitError,
  GitNotice,
  GitPanelMode,
  GitStatus,
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
import {
  initialDocument,
  loadEditorLineWrapping,
  loadQuickSearchHistory,
  loadRecentFolders,
  loadResizeHandleHints,
} from "../workbench-utils";

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
  language: AppSettings["language"];
  theme: AppSettings["theme"];
  editorFontSize: number;
  editorTabSize: number;
  editorFormatOnSave: boolean;
  showStatusBar: boolean;
  restoreLastWorkspace: boolean;
  scratchPanelHeight: number;
  settingsOpen: boolean;
  searchOpen: boolean;
  // 顶部搜索打开文件的回调:由 workbench-page 注册(指向 requestFileOpen),QuickSearch 调用。
  openFileFromSearch: ((path: string) => void) | null;
  // 打开文件后要定位到的行/列(0 基列):QuickSearch 设置,editor-surface 在内容就绪后消费并清空。
  pendingReveal: { column: number; line: number; path: string } | null;
  quickSearchHistory: string[];
  commandPaletteOpen: boolean;
  keymapOverrides: Record<string, string[]>;
  setLeftPanelOpen: (setter: StateSetter<boolean>) => void;
  setLeftPanelWidth: (setter: StateSetter<number>) => void;
  setRightPanelOpen: (setter: StateSetter<boolean>) => void;
  setRightPanelWidth: (setter: StateSetter<number>) => void;
  setResizingPanel: (setter: StateSetter<"left" | "right" | null>) => void;
  setResizeHandleHintsVisible: (setter: StateSetter<boolean>) => void;
  setEditorLineWrapping: (setter: StateSetter<boolean>) => void;
  setLanguage: (setter: StateSetter<AppSettings["language"]>) => void;
  setTheme: (setter: StateSetter<AppSettings["theme"]>) => void;
  setEditorFontSize: (setter: StateSetter<number>) => void;
  setEditorTabSize: (setter: StateSetter<number>) => void;
  setEditorFormatOnSave: (setter: StateSetter<boolean>) => void;
  setShowStatusBar: (setter: StateSetter<boolean>) => void;
  setRestoreLastWorkspace: (setter: StateSetter<boolean>) => void;
  applySettings: (settings: AppSettings) => void;
  setScratchPanelHeight: (setter: StateSetter<number>) => void;
  setSettingsOpen: (setter: StateSetter<boolean>) => void;
  setSearchOpen: (setter: StateSetter<boolean>) => void;
  setOpenFileFromSearch: (handler: ((path: string) => void) | null) => void;
  setPendingReveal: (reveal: { column: number; line: number; path: string } | null) => void;
  setQuickSearchHistory: (setter: StateSetter<string[]>) => void;
  setCommandPaletteOpen: (setter: StateSetter<boolean>) => void;
  setKeymapOverrides: (setter: StateSetter<Record<string, string[]>>) => void;

  // ---------------------------------------------------------------------------
  // workspace
  // ---------------------------------------------------------------------------
  fileError: string | null;
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
  gitStatus: GitStatus | null;
  gitBranches: GitBranches | null;
  gitRefreshVersion: number;
  gitIgnoredFiles: string[];
  gitRecentCommits: GitCommit[];
  gitBusy: boolean;
  gitError: GitError | null;
  gitNotice: GitNotice | null;
  gitPendingOp: string | null;
  gitPanelMode: GitPanelMode;
  recentFolders: RecentFolder[];
  scratchFolder: ScratchFolder | null;
  scratchFolderView: ScratchFolderView;
  setFileError: (setter: StateSetter<string | null>) => void;
  setFolderView: (setter: StateSetter<FolderView | null>) => void;
  setGitWorkspace: (setter: StateSetter<GitWorkspaceState>) => void;
  setGitStatus: (setter: StateSetter<GitStatus | null>) => void;
  setGitBranches: (setter: StateSetter<GitBranches | null>) => void;
  bumpGitRefreshVersion: () => void;
  setGitIgnoredFiles: (setter: StateSetter<string[]>) => void;
  setGitRecentCommits: (setter: StateSetter<GitCommit[]>) => void;
  setGitBusy: (setter: StateSetter<boolean>) => void;
  setGitError: (setter: StateSetter<GitError | null>) => void;
  setGitNotice: (setter: StateSetter<GitNotice | null>) => void;
  setGitPendingOp: (setter: StateSetter<string | null>) => void;
  setGitPanelMode: (setter: StateSetter<GitPanelMode>) => void;
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
  language: DEFAULT_SETTINGS.language,
  theme: DEFAULT_SETTINGS.theme,
  editorFontSize: DEFAULT_SETTINGS.editor.fontSize,
  editorTabSize: DEFAULT_SETTINGS.editor.tabSize,
  editorFormatOnSave: DEFAULT_SETTINGS.editor.formatOnSave,
  showStatusBar: DEFAULT_SETTINGS.ui.showStatusBar,
  restoreLastWorkspace: DEFAULT_SETTINGS.ui.restoreLastWorkspace,
  scratchPanelHeight: scratchPanelDefaultHeight,
  settingsOpen: false,
  searchOpen: false,
  openFileFromSearch: null,
  pendingReveal: null,
  quickSearchHistory: loadQuickSearchHistory(),
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
  setLanguage: (setter) => set((state) => ({ language: resolveSetter(setter, state.language) })),
  setTheme: (setter) => set((state) => ({ theme: resolveSetter(setter, state.theme) })),
  setEditorFontSize: (setter) => set((state) => ({ editorFontSize: resolveSetter(setter, state.editorFontSize) })),
  setEditorTabSize: (setter) => set((state) => ({ editorTabSize: resolveSetter(setter, state.editorTabSize) })),
  setEditorFormatOnSave: (setter) =>
    set((state) => ({ editorFormatOnSave: resolveSetter(setter, state.editorFormatOnSave) })),
  setShowStatusBar: (setter) => set((state) => ({ showStatusBar: resolveSetter(setter, state.showStatusBar) })),
  setRestoreLastWorkspace: (setter) =>
    set((state) => ({ restoreLastWorkspace: resolveSetter(setter, state.restoreLastWorkspace) })),
  applySettings: (settings) =>
    set(() => ({
      language: settings.language,
      theme: settings.theme,
      editorFontSize: settings.editor.fontSize,
      editorTabSize: settings.editor.tabSize,
      editorLineWrapping: settings.editor.lineWrapping,
      editorFormatOnSave: settings.editor.formatOnSave,
      showStatusBar: settings.ui.showStatusBar,
      resizeHandleHintsVisible: settings.ui.resizeHandleHints,
      restoreLastWorkspace: settings.ui.restoreLastWorkspace,
    })),
  setScratchPanelHeight: (setter) =>
    set((state) => ({ scratchPanelHeight: resolveSetter(setter, state.scratchPanelHeight) })),
  setSettingsOpen: (setter) => set((state) => ({ settingsOpen: resolveSetter(setter, state.settingsOpen) })),
  setSearchOpen: (setter) => set((state) => ({ searchOpen: resolveSetter(setter, state.searchOpen) })),
  setOpenFileFromSearch: (handler) => set(() => ({ openFileFromSearch: handler })),
  setPendingReveal: (reveal) => set(() => ({ pendingReveal: reveal })),
  setQuickSearchHistory: (setter) =>
    set((state) => ({ quickSearchHistory: resolveSetter(setter, state.quickSearchHistory) })),
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
  gitStatus: null,
  gitBranches: null,
  gitRefreshVersion: 0,
  gitIgnoredFiles: [],
  gitRecentCommits: [],
  gitBusy: false,
  gitError: null,
  gitNotice: null,
  gitPendingOp: null,
  gitPanelMode: "commit",
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
  setGitStatus: (setter) => set((state) => ({ gitStatus: resolveSetter(setter, state.gitStatus) })),
  setGitBranches: (setter) => set((state) => ({ gitBranches: resolveSetter(setter, state.gitBranches) })),
  bumpGitRefreshVersion: () => set((state) => ({ gitRefreshVersion: state.gitRefreshVersion + 1 })),
  setGitIgnoredFiles: (setter) =>
    set((state) => ({ gitIgnoredFiles: resolveSetter(setter, state.gitIgnoredFiles) })),
  setGitRecentCommits: (setter) => set((state) => ({ gitRecentCommits: resolveSetter(setter, state.gitRecentCommits) })),
  setGitBusy: (setter) => set((state) => ({ gitBusy: resolveSetter(setter, state.gitBusy) })),
  setGitError: (setter) => set((state) => ({ gitError: resolveSetter(setter, state.gitError) })),
  setGitNotice: (setter) => set((state) => ({ gitNotice: resolveSetter(setter, state.gitNotice) })),
  setGitPendingOp: (setter) => set((state) => ({ gitPendingOp: resolveSetter(setter, state.gitPendingOp) })),
  setGitPanelMode: (setter) => set((state) => ({ gitPanelMode: resolveSetter(setter, state.gitPanelMode) })),
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

/** 从 store 扁平 prefs 收集成可序列化的 AppSettings(持久化 / 导出用)。 */
export const collectSettings = (state: WorkbenchState): AppSettings => ({
  language: state.language,
  theme: state.theme,
  editor: {
    fontSize: state.editorFontSize,
    tabSize: state.editorTabSize,
    lineWrapping: state.editorLineWrapping,
    formatOnSave: state.editorFormatOnSave,
  },
  ui: {
    showStatusBar: state.showStatusBar,
    resizeHandleHints: state.resizeHandleHintsVisible,
    restoreLastWorkspace: state.restoreLastWorkspace,
  },
});
