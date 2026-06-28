import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  FolderGit2,
  FolderOpen,
  GitBranch as GitBranchIcon,
  GitBranchPlus,
  GitMerge,
  Loader2,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { type BranchTreeNode, buildBranchTree } from "../branch-tree";
import { gitActions } from "../hooks/use-git";
import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";
import type { GitBranch, GitDivergence, GitWorktree } from "../types";

/** 分支模式:本地/远程分支树（按 "/" 折叠）+ 选中分支的关系（上游、领先落后、独有提交）。 */
export function GitBranchesPane({ onOpenWorktree }: { onOpenWorktree: (path: string) => void }) {
  const { t } = useI18n();
  const branches = useWorkbenchStore((state) => state.gitBranches);
  const gitRefreshVersion = useWorkbenchStore((state) => state.gitRefreshVersion);
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const detached = useWorkbenchStore((state) => state.gitStatus?.detached ?? false);
  const currentBranch = useWorkbenchStore((state) => state.gitStatus?.branch ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  // 记录正在切换的分支名,在对应行上显示 spinner —— checkout 要 fetch/切工作区,有可感知延迟。
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const handleCheckout = (branch: GitBranch, localName?: string) => {
    setCheckingOut(branch.name);
    void gitActions.checkout(localName ?? branch.name).finally(() => setCheckingOut(null));
  };

  // 拉取/推送走网络(几秒),在按钮上转圈,避免「点完没反应像卡死」。
  const [syncing, setSyncing] = useState<"pull" | "push" | null>(null);
  const handleSync = (op: "pull" | "push") => {
    setSyncing(op);
    void (op === "pull" ? gitActions.pull() : gitActions.push()).finally(() => setSyncing(null));
  };

  // 合并:点按钮→确认对话框→把目标分支合并进当前分支。冲突由「合并进行中」横幅接管。
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const confirmMerge = () => {
    const source = mergeTarget;
    setMergeTarget(null);
    if (source) {
      void gitActions.merge(source, t("git.merged", { source }));
    }
  };

  const local = branches?.local ?? [];
  const remote = branches?.remote ?? [];
  const localTree = buildBranchTree(local);
  const remoteTree = buildBranchTree(remote, "origin/");

  // 直接展示每个本地分支相对 base(main)的领先/落后,无需点开。按分支名集合拉取一次。
  const [divergences, setDivergences] = useState<Record<string, GitDivergence>>({});
  const localKey = local.map((item) => item.name).join("\0");
  useEffect(() => {
    const names = localKey ? localKey.split("\0") : [];
    if (names.length === 0) {
      setDivergences({});
      return;
    }
    let alive = true;
    void Promise.all(
      names.map((name) => gitActions.loadDivergence(name).then((result) => [name, result] as const)),
    ).then((entries) => {
      if (!alive) {
        return;
      }
      const map: Record<string, GitDivergence> = {};
      for (const [name, result] of entries) {
        if (result) {
          map[name] = result;
        }
      }
      setDivergences(map);
    });
    return () => {
      alive = false;
    };
  }, [localKey, gitRefreshVersion]);

  // window.prompt 在 Tauri 的 WKWebView 里是 no-op(直接返回 null),改用应用内对话框。
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const confirmCreate = () => {
    const name = newName.trim();
    if (!name) return;
    void gitActions.createBranch(name);
    setCreateOpen(false);
    setNewName("");
  };

  return (
    <div className="git-branches">
      <BranchSummary />

      <div className="git-branches-toolbar">
        <Button
          className="git-toolbar-button"
          size="toolbar"
          variant="ghost"
          disabled={gitBusy}
          onClick={() => {
            setNewName("");
            setCreateOpen(true);
          }}
        >
          <GitBranchPlus className="h-3.5 w-3.5" />
          {t("git.newBranch")}
        </Button>
        <span className="git-branches-toolbar-spacer" aria-hidden="true" />
        <Button
          className="git-toolbar-button"
          size="toolbar"
          variant="ghost"
          disabled={gitBusy || detached}
          title={detached ? t("git.pullPushDisabledDetached") : undefined}
          onClick={() => handleSync("pull")}
        >
          {syncing === "pull" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowDownToLine className="h-3.5 w-3.5" />
          )}
          {t("git.pull")}
        </Button>
        <Button
          className="git-toolbar-button"
          size="toolbar"
          variant="ghost"
          disabled={gitBusy || detached}
          title={detached ? t("git.pullPushDisabledDetached") : undefined}
          onClick={() => handleSync("push")}
        >
          {syncing === "push" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUpFromLine className="h-3.5 w-3.5" />
          )}
          {t("git.push")}
        </Button>
      </div>

      <div className="git-branches-group-label">{t("git.local")}</div>
      <BranchTree
        nodes={localTree}
        selected={selected}
        divergences={divergences}
        onSelect={setSelected}
        onCheckout={(branch) => handleCheckout(branch)}
        onMerge={(branch) => setMergeTarget(branch.name)}
        checkingOut={checkingOut}
      />
      {local.length === 0 ? <div className="git-branch-empty">{t("git.noLocalBranches")}</div> : null}

      {remote.length > 0 ? (
        <>
          <div className="git-branches-group-label">{t("git.remoteOrigin")}</div>
          <BranchTree
            nodes={remoteTree}
            selected={selected}
            divergences={divergences}
            onSelect={setSelected}
            onCheckout={(branch) => handleCheckout(branch, branch.name.replace(/^[^/]+\//, ""))}
            onMerge={(branch) => setMergeTarget(branch.name)}
            checkingOut={checkingOut}
          />
        </>
      ) : null}

      <WorktreeSection onOpenWorktree={onOpenWorktree} currentBranch={currentBranch} />

      <Dialog open={mergeTarget !== null} onOpenChange={(open) => !open && setMergeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("git.mergeTitle", { source: mergeTarget ?? "" })}</DialogTitle>
            <DialogDescription>
              {t("git.mergeConfirm", { source: mergeTarget ?? "", current: currentBranch ?? "—" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMergeTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirmMerge}>{t("git.merge")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("git.newBranch")}</DialogTitle>
            <DialogDescription>{t("git.createBranchPrompt")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") confirmCreate();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirmCreate} disabled={!newName.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BranchSummary() {
  const { t } = useI18n();
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const detached = gitStatus?.detached ?? false;
  const branch = gitStatus?.branch ?? "—";
  const upstream = gitStatus?.upstream ?? null;
  const ahead = gitStatus?.ahead ?? 0;
  const behind = gitStatus?.behind ?? 0;
  const changeCount = gitStatus?.changes.length ?? 0;

  return (
    <div className="git-branch-summary">
      <div className="git-branch-summary-head">
        <GitBranchIcon className={cn("h-4 w-4", detached ? "text-amber-500" : "text-primary")} />
        <span className="git-branch-summary-name">{detached ? t("git.detachedHead") : branch}</span>
      </div>
      {detached ? <div className="git-branch-detached-hint">{t("git.detachedHint")}</div> : null}
      <div className="git-branch-summary-rows">
        <span className={cn("git-branch-summary-pill", changeCount > 0 && "git-branch-summary-pill-warn")}>
          {changeCount > 0 ? t("git.uncommittedChanges", { count: changeCount }) : t("git.workspaceClean")}
        </span>
        {!upstream ? (
          <span className="git-branch-summary-pill">{t("git.localOnlyNoUpstream")}</span>
        ) : ahead === 0 && behind === 0 ? (
          <span className="git-branch-summary-pill git-branch-summary-pill-ok">{t("git.syncedWithUpstream")}</span>
        ) : null}
        {/* 始终直接展示领先 / 落后数量,一眼看清是否需要推送 / 拉取。 */}
        {upstream ? (
          <span
            className={cn(
              "git-branch-summary-pill git-branch-summary-track",
              ahead > 0 && "git-branch-summary-pill-ahead",
              behind > 0 && "git-branch-summary-pill-behind",
            )}
          >
            <span className="git-branch-ahead">{t("git.aheadToPush", { count: ahead })}</span>
            <span className="git-branch-behind">{t("git.behindToPull", { count: behind })}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

type BranchTreeShared = {
  divergences: Record<string, GitDivergence>;
  onCheckout: (branch: GitBranch) => void;
  onMerge: (branch: GitBranch) => void;
  onSelect: (name: string | null) => void;
  selected: string | null;
  checkingOut: string | null;
};

function BranchTree({ depth = 0, nodes, ...shared }: { depth?: number; nodes: BranchTreeNode[] } & BranchTreeShared) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <BranchFolder key={`folder:${node.path}`} node={node} depth={depth} {...shared} />
        ) : (
          <BranchLeaf key={`branch:${node.branch.name}`} node={node} depth={depth} {...shared} />
        ),
      )}
    </>
  );
}

function BranchFolder({
  depth,
  node,
  ...shared
}: { depth: number; node: Extract<BranchTreeNode, { kind: "folder" }> } & BranchTreeShared) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        className="git-branch-folder"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open ? <BranchTree nodes={node.children} depth={depth + 1} {...shared} /> : null}
    </>
  );
}

function BranchLeaf({
  depth,
  divergences,
  node,
  onCheckout,
  onMerge,
  onSelect,
  selected,
  checkingOut,
}: { depth: number; node: Extract<BranchTreeNode, { kind: "branch" }> } & BranchTreeShared) {
  const { t } = useI18n();
  const { branch } = node;
  const isSelected = branch.name === selected;
  const isCheckingOut = checkingOut === branch.name;
  const divergence = divergences[branch.name];
  const baseName = divergence?.base ? divergence.base.replace(/^[^/]+\//, "") : null;
  const showBase =
    baseName && baseName !== branch.name && ((divergence?.aheadOfBase ?? 0) > 0 || (divergence?.behindBase ?? 0) > 0);

  return (
    <>
      <div
        className={cn(
          "git-branch-leaf",
          isSelected && "git-branch-leaf-selected",
          branch.current && "git-branch-leaf-current",
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <button
          type="button"
          className="git-branch-leaf-main"
          onClick={() => onSelect(isSelected ? null : branch.name)}
          onDoubleClick={() => !branch.current && onCheckout(branch)}
          title={t("git.branchCheckoutTitle", { name: branch.name })}
        >
          <span className="git-branch-leaf-check">
            {isCheckingOut ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : branch.current ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <GitBranchIcon className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
          <span className="truncate">{node.name}</span>
          {showBase ? (
            <span className="git-branch-base-chip" title={t("git.relativeTo", { name: baseName })}>
              {baseName}
              {(divergence?.aheadOfBase ?? 0) > 0 ? (
                <span className="git-branch-ahead">↑{divergence?.aheadOfBase}</span>
              ) : null}
              {(divergence?.behindBase ?? 0) > 0 ? (
                <span className="git-branch-behind">↓{divergence?.behindBase}</span>
              ) : null}
            </span>
          ) : null}
          {branch.ahead || branch.behind ? (
            <span className="git-branch-track">
              {branch.ahead ? <span className="git-branch-ahead">↑{branch.ahead}</span> : null}
              {branch.behind ? <span className="git-branch-behind">↓{branch.behind}</span> : null}
            </span>
          ) : null}
        </button>
        {!branch.current ? (
          <>
            {branch.kind === "local" ? (
              <button
                type="button"
                className="git-branch-leaf-merge"
                disabled={checkingOut !== null}
                title={t("git.mergeButtonTitle", { source: branch.name })}
                onClick={() => onMerge(branch)}
              >
                <GitMerge className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              className="git-branch-leaf-checkout"
              disabled={checkingOut !== null}
              onClick={() => onCheckout(branch)}
            >
              {isCheckingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("git.checkout")}
            </button>
          </>
        ) : null}
      </div>
      {isSelected ? <BranchRelationship branch={branch} /> : null}
    </>
  );
}

function BranchRelationship({ branch }: { branch: GitBranch }) {
  const { t } = useI18n();
  const gitRefreshVersion = useWorkbenchStore((state) => state.gitRefreshVersion);
  const [divergence, setDivergence] = useState<GitDivergence | null>(null);

  useEffect(() => {
    let alive = true;
    void gitActions.loadDivergence(branch.name).then((result) => {
      if (alive) {
        setDivergence(result);
      }
    });
    return () => {
      alive = false;
    };
  }, [branch.name, gitRefreshVersion]);

  const base = divergence?.base ?? null;
  const ownCommits = divergence?.ownCommits ?? [];

  return (
    <div className="git-branch-relationship">
      <div className="git-branch-relationship-row">
        {branch.upstream ? (
          <span className="git-branch-relationship-chip">
            {t("git.upstream", { upstream: branch.upstream })}
            {branch.ahead ? <span className="git-branch-ahead">↑{branch.ahead}</span> : null}
            {branch.behind ? <span className="git-branch-behind">↓{branch.behind}</span> : null}
          </span>
        ) : (
          <span className="git-branch-relationship-chip">{t("git.localOnlyNoUpstream")}</span>
        )}
        {base ? (
          <span className="git-branch-relationship-chip">
            {t("git.vsBase", { base })}
            <span className="git-branch-ahead">{t("git.aheadToPush", { count: divergence?.aheadOfBase ?? 0 })}</span>
            <span className="git-branch-behind">{t("git.behindToPull", { count: divergence?.behindBase ?? 0 })}</span>
          </span>
        ) : null}
      </div>

      {ownCommits.length > 0 ? (
        <div className="git-branch-relationship-commits">
          <div className="git-branch-relationship-label">{base ? t("git.relativeTo", { name: base }) : t("git.recentCommits")}</div>
          {ownCommits.slice(0, 6).map((commit) => (
            <div className="git-branch-relationship-commit" key={commit.hash} title={commit.subject}>
              <span className="truncate">{commit.subject}</span>
              <span className="git-branch-relationship-meta">{commit.relativeTime}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="git-branch-empty">{t("git.noCommits")}</div>
      )}
    </div>
  );
}

/** 工作树:列出本仓库所有 worktree(点「打开」即切换工作区),并提供「新建工作树」。 */
function WorktreeSection({
  onOpenWorktree,
  currentBranch,
}: {
  onOpenWorktree: (path: string) => void;
  currentBranch: string | null;
}) {
  const { t } = useI18n();
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const gitRefreshVersion = useWorkbenchStore((state) => state.gitRefreshVersion);
  const rootPath = useWorkbenchStore((state) => state.folderView?.rootPath ?? null);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    void gitActions.loadWorktrees().then((result) => {
      if (alive) setWorktrees(result);
    });
    return () => {
      alive = false;
    };
  }, [gitRefreshVersion]);

  // 新建工作树表单。父目录默认取仓库根的同级,路径建议 ../<仓库名>-<分支名>。
  const repoName = rootPath ? rootPath.replace(/[/\\]+$/, "").replace(/^.*[/\\]/, "") : "project";
  const parentDir = rootPath ? rootPath.replace(/[/\\]+$/, "").replace(/[/\\][^/\\]+$/, "") : "..";
  const [createOpen, setCreateOpen] = useState(false);
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [newBranch, setNewBranch] = useState(true);

  const openCreate = () => {
    setBranch("");
    setNewBranch(true);
    setPath("");
    setCreateOpen(true);
  };
  // 分支名变化时,若用户没改过路径就同步建议路径。
  const suggestedPath = (branchName: string) =>
    `${parentDir}/${repoName}-${branchName.replace(/[/\\]/g, "-") || "worktree"}`;
  const onBranchChange = (value: string) => {
    const wasSuggested = path === "" || path === suggestedPath(branch);
    setBranch(value);
    if (wasSuggested) setPath(suggestedPath(value));
  };

  const confirmCreate = async () => {
    const wtPath = path.trim();
    const branchName = branch.trim();
    if (!wtPath || !branchName) return;
    setCreateOpen(false);
    const created = await gitActions.addWorktree(
      wtPath,
      branchName,
      newBranch,
      newBranch ? (currentBranch ?? undefined) : undefined,
    );
    if (created) {
      useWorkbenchStore.getState().setGitNotice({ tone: "ok", text: t("git.worktreeCreated", { path: created }) });
      onOpenWorktree(created);
    }
  };

  // 删除工作树:确认对话框带「强制」选项(默认关,避免误删未提交改动)。清理后列表随刷新自动更新。
  const [removeTarget, setRemoveTarget] = useState<GitWorktree | null>(null);
  const [removeForce, setRemoveForce] = useState(false);
  const labelOf = (worktree: GitWorktree) =>
    worktree.branch ?? (worktree.detached ? "(detached)" : worktree.path.replace(/^.*[/\\]/, ""));
  const confirmRemove = () => {
    const target = removeTarget;
    const force = removeForce;
    setRemoveTarget(null);
    if (target) {
      void gitActions.removeWorktree(target.path, force, t("git.worktreeRemoved", { name: labelOf(target) }));
    }
  };

  return (
    <>
      <button type="button" className="git-branches-group-label git-worktree-header" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{t("git.worktrees")}</span>
        <span className="git-branches-toolbar-spacer" aria-hidden="true" />
        <span
          role="button"
          tabIndex={0}
          className="git-worktree-add"
          title={t("git.pruneWorktreesTitle")}
          onClick={(event) => {
            event.stopPropagation();
            void gitActions.pruneWorktrees(t("git.worktreesPruned"));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.stopPropagation();
              void gitActions.pruneWorktrees(t("git.worktreesPruned"));
            }
          }}
        >
          <Eraser className="h-3.5 w-3.5" />
        </span>
        <span
          role="button"
          tabIndex={0}
          className="git-worktree-add"
          title={t("git.newWorktree")}
          onClick={(event) => {
            event.stopPropagation();
            openCreate();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.stopPropagation();
              openCreate();
            }
          }}
        >
          <GitBranchPlus className="h-3.5 w-3.5" />
        </span>
      </button>

      {open
        ? worktrees.map((worktree) => (
            <div
              key={worktree.path}
              className={cn("git-branch-leaf", worktree.isCurrent && "git-branch-leaf-current")}
            >
              <div className="git-branch-leaf-main git-worktree-leaf" title={worktree.path}>
                <span className="git-branch-leaf-check">
                  <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
                <span className="truncate">{labelOf(worktree)}</span>
                {worktree.isCurrent ? <span className="git-branch-base-chip">{t("git.currentWorktree")}</span> : null}
              </div>
              {!worktree.isCurrent ? (
                <>
                  <button
                    type="button"
                    className="git-branch-leaf-checkout"
                    disabled={gitBusy}
                    onClick={() => onOpenWorktree(worktree.path)}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {t("git.openWorktree")}
                  </button>
                  <button
                    type="button"
                    className="git-branch-leaf-merge"
                    disabled={gitBusy}
                    title={t("git.removeWorktree")}
                    onClick={() => {
                      setRemoveForce(false);
                      setRemoveTarget(worktree);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : null}
            </div>
          ))
        : null}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("git.newWorktree")}</DialogTitle>
            <DialogDescription>{t("git.worktreeCreatePrompt")}</DialogDescription>
          </DialogHeader>
          <label className="git-worktree-field-label">{t("git.worktreeBranch")}</label>
          <Input autoFocus value={branch} onChange={(event) => onBranchChange(event.target.value)} />
          <label className="git-worktree-checkbox">
            <input type="checkbox" checked={newBranch} onChange={(event) => setNewBranch(event.target.checked)} />
            {t("git.worktreeNewBranch")}
          </label>
          <label className="git-worktree-field-label">{t("git.worktreePath")}</label>
          <Input
            value={path}
            placeholder={t("git.worktreePathPlaceholder")}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void confirmCreate();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void confirmCreate()} disabled={!path.trim() || !branch.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeTarget !== null} onOpenChange={(value) => !value && setRemoveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("git.removeWorktreeTitle", { name: removeTarget ? labelOf(removeTarget) : "" })}</DialogTitle>
            <DialogDescription>{t("git.removeWorktreeConfirm")}</DialogDescription>
          </DialogHeader>
          <div className="git-worktree-field-label">{removeTarget?.path}</div>
          <label className="git-worktree-checkbox">
            <input type="checkbox" checked={removeForce} onChange={(event) => setRemoveForce(event.target.checked)} />
            {t("git.removeWorktreeForce")}
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={confirmRemove}>{t("git.removeWorktree")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
