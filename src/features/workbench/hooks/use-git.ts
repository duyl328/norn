import { invoke } from "@tauri-apps/api/core";

import { useWorkbenchStore } from "../store/workbench-store";
import type {
  GitBranches,
  GitCommit,
  GitCommitFile,
  GitDivergence,
  GitFileVersions,
  GitLogCommit,
  GitStatus,
  GitWorkspaceInspection,
} from "../types";
import { getGitError, isTauriRuntime } from "../workbench-utils";

const RECENT_COMMIT_LIMIT = 20;

const repoPath = (): string | null => useWorkbenchStore.getState().folderView?.rootPath ?? null;

/** 拉取 status / branches / recent commits 写入 store。不抛错，错误进 gitError。 */
export const refreshGit = async (): Promise<void> => {
  const store = useWorkbenchStore.getState();
  const path = repoPath();

  if (!path || !isTauriRuntime()) {
    store.setGitStatus(null);
    store.setGitBranches(null);
    store.setGitIgnoredFiles([]);
    store.setGitRecentCommits([]);
    return;
  }

  try {
    const [status, branches, ignoredFiles, commits] = await Promise.all([
      invoke<GitStatus>("git_status", { path }),
      invoke<GitBranches>("git_branches", { path }),
      invoke<string[]>("git_ignored_files", { path }),
      invoke<GitCommit[]>("git_recent_commits", { path, limit: RECENT_COMMIT_LIMIT }),
    ]);
    store.setGitStatus(status);
    store.setGitBranches(branches);
    store.setGitIgnoredFiles(ignoredFiles);
    store.setGitRecentCommits(commits);
    store.setGitError(null);
  } catch (error) {
    store.setGitIgnoredFiles([]);
    store.setGitError(getGitError(error));
  }
};

/** 执行一次写操作 + 自动刷新，统一管理 gitBusy / gitError。返回是否成功。 */
const withBusy = async (run: (path: string) => Promise<unknown>): Promise<boolean> => {
  const path = repoPath();
  if (!path) {
    return false;
  }

  const store = useWorkbenchStore.getState();
  store.setGitBusy(true);
  store.setGitError(null);
  try {
    await run(path);
    await refreshGit();
    return true;
  } catch (error) {
    store.setGitError(getGitError(error));
    return false;
  } finally {
    useWorkbenchStore.getState().setGitBusy(false);
  }
};

export const gitActions = {
  refresh: refreshGit,
  commit: (message: string, push: boolean, files: string[] = [], amend = false) =>
    withBusy((path) => invoke("git_commit", { path, message, push, amend, files })),
  push: () => withBusy((path) => invoke("git_push", { path })),
  resolveConflict: (file: string, content: string) =>
    withBusy((path) => invoke("git_resolve_conflict", { path, file, content })),
  addToGitignore: (entry: string) => withBusy((path) => invoke("git_ignore_path", { path, entry })),
  loadIgnored: async (): Promise<string[]> => {
    const path = repoPath();
    if (!path) {
      return [];
    }
    try {
      return await invoke<string[]>("git_ignored_files", { path });
    } catch (error) {
      useWorkbenchStore.getState().setGitError(getGitError(error));
      return [];
    }
  },
  pull: () => withBusy((path) => invoke("git_pull", { path })),
  checkout: (branch: string) => withBusy((path) => invoke("git_checkout", { path, branch })),
  createBranch: (name: string) => withBusy((path) => invoke("git_create_branch", { path, name })),
  initRepo: () =>
    withBusy(async (path) => {
      await invoke("git_init", { path });
      // 重新探测，让面板从「非仓库」切回正常状态。
      const inspection = await invoke<GitWorkspaceInspection>("inspect_git_workspace", { path });
      useWorkbenchStore.getState().setGitWorkspace({ kind: "ready", inspection });
    }),
  loadDiff: async (file: string): Promise<string> => {
    const path = repoPath();
    if (!path) {
      return "";
    }
    try {
      return await invoke<string>("git_file_diff", { path, file });
    } catch (error) {
      useWorkbenchStore.getState().setGitError(getGitError(error));
      return "";
    }
  },
  loadFileVersions: async (file: string): Promise<GitFileVersions> => {
    const path = repoPath();
    if (!path) {
      return { original: "", modified: "" };
    }
    try {
      return await invoke<GitFileVersions>("git_file_versions", { path, file });
    } catch (error) {
      useWorkbenchStore.getState().setGitError(getGitError(error));
      return { original: "", modified: "" };
    }
  },
  loadCommitFileVersions: async (hash: string, file: string): Promise<GitFileVersions> => {
    const path = repoPath();
    if (!path) {
      return { original: "", modified: "" };
    }
    try {
      return await invoke<GitFileVersions>("git_commit_file_versions", { path, hash, file });
    } catch (error) {
      useWorkbenchStore.getState().setGitError(getGitError(error));
      return { original: "", modified: "" };
    }
  },
  loadLog: async (limit = 200): Promise<GitLogCommit[]> => {
    const path = repoPath();
    if (!path) {
      return [];
    }
    try {
      return await invoke<GitLogCommit[]>("git_log", { path, limit });
    } catch (error) {
      useWorkbenchStore.getState().setGitError(getGitError(error));
      return [];
    }
  },
  loadCommitFiles: async (hash: string): Promise<GitCommitFile[]> => {
    const path = repoPath();
    if (!path) {
      return [];
    }
    try {
      return await invoke<GitCommitFile[]>("git_commit_files", { path, hash });
    } catch (error) {
      useWorkbenchStore.getState().setGitError(getGitError(error));
      return [];
    }
  },
  loadDivergence: async (branch: string, base?: string): Promise<GitDivergence | null> => {
    const path = repoPath();
    if (!path) {
      return null;
    }
    try {
      return await invoke<GitDivergence>("git_branch_divergence", { path, branch, base: base ?? null });
    } catch (error) {
      useWorkbenchStore.getState().setGitError(getGitError(error));
      return null;
    }
  },
};
