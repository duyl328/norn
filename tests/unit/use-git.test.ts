// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FolderView, GitBranches, GitStatus } from "@/features/workbench/types";
import type * as WorkbenchUtilsModule from "@/features/workbench/workbench-utils";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  tauri: true,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/features/workbench/workbench-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkbenchUtilsModule>();
  return {
    ...actual,
    isTauriRuntime: () => mocks.tauri,
  };
});

import { gitActions, refreshGit } from "@/features/workbench/hooks/use-git";
import { useWorkbenchStore } from "@/features/workbench/store/workbench-store";

const folder = (rootPath: string): FolderView => ({
  error: null,
  loadingPath: null,
  nodes: [],
  origin: "open-folder",
  rootExpanded: true,
  rootName: rootPath.split("/").pop() ?? "repo",
  rootPath,
});

const status = (branch: string): GitStatus => ({
  branch,
  detached: false,
  upstream: `origin/${branch}`,
  ahead: 0,
  behind: 0,
  changes: [],
});

const branches = (branch: string): GitBranches => ({
  current: branch,
  local: [{ name: branch, upstream: `origin/${branch}`, ahead: 0, behind: 0, current: true, kind: "local" }],
  remote: [],
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const installSuccessfulGitMock = () => {
  mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    const branch = String(args?.path ?? "").endsWith("repo-b") ? "branch-b" : "main";
    switch (command) {
      case "git_status":
        return Promise.resolve(status(branch));
      case "git_branches":
        return Promise.resolve(branches(branch));
      case "git_ignored_files":
      case "git_recent_commits":
        return Promise.resolve([]);
      case "git_pending_op":
        return Promise.resolve("");
      default:
        return Promise.resolve(null);
    }
  });
};

describe("Git action state flow", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.tauri = true;
    useWorkbenchStore.setState({
      folderView: folder("C:/repo-a"),
      gitBranches: null,
      gitBusy: false,
      gitError: null,
      gitIgnoredFiles: [],
      gitNotice: null,
      gitPendingOp: null,
      gitRecentCommits: [],
      gitRefreshing: false,
      gitRefreshVersion: 0,
      gitStatus: null,
      gitWorkspace: { kind: "idle" },
      language: "zh",
    });
  });

  it("clears Git state without invoking native commands when no workspace is open", async () => {
    useWorkbenchStore.setState({
      folderView: null,
      gitBranches: branches("old"),
      gitIgnoredFiles: ["ignored"],
      gitRecentCommits: [
        { hash: "1", subject: "old", author: "tester", relativeTime: "now", refs: [], isMerge: false },
      ],
      gitStatus: status("old"),
    });

    await refreshGit();

    const state = useWorkbenchStore.getState();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(state.gitStatus).toBeNull();
    expect(state.gitBranches).toBeNull();
    expect(state.gitIgnoredFiles).toEqual([]);
    expect(state.gitRecentCommits).toEqual([]);
  });

  it("loads status, branches, ignored files, commits and pending operation together", async () => {
    const nextStatus = { ...status("main"), ahead: 2, behind: 1 };
    mocks.invoke.mockImplementation((command: string) => {
      switch (command) {
        case "git_status":
          return Promise.resolve(nextStatus);
        case "git_branches":
          return Promise.resolve(branches("main"));
        case "git_ignored_files":
          return Promise.resolve(["dist/"]);
        case "git_recent_commits":
          return Promise.resolve([
            { hash: "abc", subject: "one", author: "tester", relativeTime: "now", refs: [], isMerge: false },
          ]);
        case "git_pending_op":
          return Promise.resolve("merge");
        default:
          return Promise.reject(new Error(`unexpected ${command}`));
      }
    });

    await refreshGit();

    const state = useWorkbenchStore.getState();
    expect(state.gitStatus).toEqual(nextStatus);
    expect(state.gitBranches?.current).toBe("main");
    expect(state.gitIgnoredFiles).toEqual(["dist/"]);
    expect(state.gitRecentCommits).toHaveLength(1);
    expect(state.gitPendingOp).toBe("merge");
    expect(state.gitRefreshVersion).toBe(1);
    expect(state.gitRefreshing).toBe(false);
    expect(state.gitError).toBeNull();
  });

  it("records a structured read error and always restores refreshing state", async () => {
    mocks.invoke.mockImplementation((command: string) => {
      if (command === "git_status") return Promise.reject({ kind: "not-repository", message: "gone" });
      if (command === "git_pending_op") return Promise.resolve("");
      return Promise.resolve([]);
    });

    await refreshGit();

    const state = useWorkbenchStore.getState();
    expect(state.gitError).toEqual({ kind: "not-repository", message: "gone" });
    expect(state.gitIgnoredFiles).toEqual([]);
    expect(state.gitRefreshing).toBe(false);
  });

  it("commits once, refreshes state and restores busy after success", async () => {
    installSuccessfulGitMock();

    const result = await gitActions.commit("message", false, ["a.txt"]);

    expect(result).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("git_commit", {
      path: "C:/repo-a",
      message: "message",
      push: false,
      amend: false,
      files: ["a.txt"],
    });
    expect(mocks.invoke).toHaveBeenCalledWith("git_status", { path: "C:/repo-a" });
    expect(useWorkbenchStore.getState().gitBusy).toBe(false);
    expect(useWorkbenchStore.getState().gitNotice?.tone).toBe("ok");
  });

  it("prevents a second write operation while the first is pending", async () => {
    const push = deferred<null>();
    installSuccessfulGitMock();
    mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "git_push") return push.promise;
      const branch = String(args?.path ?? "").endsWith("repo-b") ? "branch-b" : "main";
      if (command === "git_status") return Promise.resolve(status(branch));
      if (command === "git_branches") return Promise.resolve(branches(branch));
      if (command === "git_pending_op") return Promise.resolve("");
      if (command === "git_ignored_files" || command === "git_recent_commits") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const first = gitActions.push();
    const second = await gitActions.push();
    expect(second).toBe(false);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "git_push")).toHaveLength(1);

    push.resolve(null);
    await expect(first).resolves.toBe(true);
    expect(useWorkbenchStore.getState().gitBusy).toBe(false);
  });

  it("restores busy and exposes the native error after a write failure", async () => {
    mocks.invoke.mockRejectedValue({ kind: "auth-failed", message: "Permission denied" });

    const result = await gitActions.push();

    expect(result).toBe(false);
    expect(useWorkbenchStore.getState().gitBusy).toBe(false);
    expect(useWorkbenchStore.getState().gitError).toEqual({ kind: "auth-failed", message: "Permission denied" });
    expect(useWorkbenchStore.getState().gitNotice).toEqual({
      tone: "err",
      error: { kind: "auth-failed", message: "Permission denied" },
    });
  });

  it("deduplicates background fetch and refreshes again when fetch finishes", async () => {
    const fetch = deferred<null>();
    installSuccessfulGitMock();
    const implementation = mocks.invoke.getMockImplementation();
    mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === "git_fetch") return fetch.promise;
      return implementation?.(command, args);
    });

    await Promise.all([refreshGit({ fetch: true, notify: true }), refreshGit({ fetch: true, notify: true })]);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "git_fetch")).toHaveLength(1);
    expect(useWorkbenchStore.getState().gitRefreshing).toBe(true);

    fetch.resolve(null);
    await vi.waitFor(() => {
      expect(useWorkbenchStore.getState().gitRefreshing).toBe(false);
      expect(useWorkbenchStore.getState().gitNotice?.tone).toBe("ok");
    });
    expect(mocks.invoke.mock.calls.filter(([command]) => command === "git_status").length).toBeGreaterThanOrEqual(3);
  });

  it("does not let a slow refresh from the previous workspace overwrite the new workspace", async () => {
    const oldStatus = deferred<GitStatus>();
    mocks.invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      const path = String(args?.path);
      const branch = path.endsWith("repo-b") ? "branch-b" : "branch-a";
      if (command === "git_status" && path.endsWith("repo-a")) return oldStatus.promise;
      if (command === "git_status") return Promise.resolve(status(branch));
      if (command === "git_branches") return Promise.resolve(branches(branch));
      if (command === "git_pending_op") return Promise.resolve("");
      return Promise.resolve([]);
    });

    const oldRefresh = refreshGit();
    useWorkbenchStore.setState({ folderView: folder("C:/repo-b") });
    await refreshGit();
    expect(useWorkbenchStore.getState().gitStatus?.branch).toBe("branch-b");

    oldStatus.resolve(status("branch-a"));
    await oldRefresh;

    expect(useWorkbenchStore.getState().gitStatus?.branch).toBe("branch-b");
    expect(useWorkbenchStore.getState().gitBranches?.current).toBe("branch-b");
  });
});
