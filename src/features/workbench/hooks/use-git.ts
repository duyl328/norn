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
// 用计数器维护 gitRefreshing:本地刷新与后台 fetch 可能重叠,首进置 true、全部结束才置 false,避免闪烁。
let refreshInFlight = 0;
const beginRefresh = () => {
  if (refreshInFlight++ === 0) useWorkbenchStore.getState().setGitRefreshing(true);
};
const endRefresh = () => {
  if (--refreshInFlight === 0) useWorkbenchStore.getState().setGitRefreshing(false);
};

export const refreshGit = async (options?: { fetch?: boolean }): Promise<void> => {
  const store = useWorkbenchStore.getState();
  const path = repoPath();

  if (!path || !isTauriRuntime()) {
    store.setGitStatus(null);
    store.setGitBranches(null);
    store.setGitIgnoredFiles([]);
    store.setGitRecentCommits([]);
    return;
  }

  beginRefresh();
  try {
    // git fetch 走网络(~2s),不能挡住本地状态读取。仅在显式请求时后台跑,完成后再刷新一次本地视图。
    if (options?.fetch) {
      beginRefresh(); // 持有到 fetch + 其后续刷新结束,刷新图标在整个同步期间保持转动
      void invoke("git_fetch", { path })
        .then(() => refreshGit())
        .catch(() => undefined)
        .finally(endRefresh);
    }
    const [status, branches, ignoredFiles, commits, pendingOp] = await Promise.all([
      invoke<GitStatus>("git_status", { path }),
      invoke<GitBranches>("git_branches", { path }),
      invoke<string[]>("git_ignored_files", { path }),
      invoke<GitCommit[]>("git_recent_commits", { path, limit: RECENT_COMMIT_LIMIT }),
      invoke<string>("git_pending_op", { path }).catch(() => ""),
    ]);
    store.setGitStatus(status);
    store.setGitBranches(branches);
    store.setGitIgnoredFiles(ignoredFiles);
    store.setGitRecentCommits(commits);
    store.setGitPendingOp(pendingOp || null);
    store.bumpGitRefreshVersion();
    store.setGitError(null);
  } catch (error) {
    store.setGitIgnoredFiles([]);
    store.setGitError(getGitError(error));
  } finally {
    endRefresh();
  }
};

/** 执行一次写操作 + 自动刷新，统一管理 gitBusy / gitError / gitNotice。返回是否成功。 */
const withBusy = async (run: (path: string) => Promise<unknown>, okMessage?: string): Promise<boolean> => {
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
    if (okMessage) {
      useWorkbenchStore.getState().setGitNotice({ tone: "ok", text: okMessage });
    }
    return true;
  } catch (error) {
    const gitError = getGitError(error);
    store.setGitError(gitError);
    store.setGitNotice({ tone: "err", error: gitError });
    return false;
  } finally {
    useWorkbenchStore.getState().setGitBusy(false);
  }
};

export const gitActions = {
  refresh: () => refreshGit({ fetch: true }),
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
  checkoutCommit: (hash: string, okMessage?: string) =>
    withBusy((path) => invoke("git_checkout_commit", { path, hash }), okMessage),
  resetTo: (hash: string, mode: "soft" | "mixed" | "hard", okMessage?: string) =>
    withBusy((path) => invoke("git_reset", { path, hash, mode }), okMessage),
  revertCommit: (hash: string, okMessage?: string) =>
    withBusy((path) => invoke("git_revert", { path, hash }), okMessage),
  createBranch: (name: string) => withBusy((path) => invoke("git_create_branch", { path, name })),
  createBranchAt: (name: string, hash: string, okMessage?: string) =>
    withBusy((path) => invoke("git_create_branch_at", { path, name, hash }), okMessage),
  abortOp: (op: string, okMessage?: string) =>
    withBusy((path) => invoke("git_abort_op", { path, op }), okMessage),
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
