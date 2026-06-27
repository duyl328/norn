import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch as GitBranchIcon,
  GitBranchPlus,
  Loader2,
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
import type { GitBranch, GitDivergence } from "../types";

/** 分支模式:本地/远程分支树（按 "/" 折叠）+ 选中分支的关系（上游、领先落后、独有提交）。 */
export function GitBranchesPane() {
  const { t } = useI18n();
  const branches = useWorkbenchStore((state) => state.gitBranches);
  const gitRefreshVersion = useWorkbenchStore((state) => state.gitRefreshVersion);
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const detached = useWorkbenchStore((state) => state.gitStatus?.detached ?? false);
  const [selected, setSelected] = useState<string | null>(null);
  // 记录正在切换的分支名,在对应行上显示 spinner —— checkout 要 fetch/切工作区,有可感知延迟。
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const handleCheckout = (branch: GitBranch, localName?: string) => {
    setCheckingOut(branch.name);
    void gitActions.checkout(localName ?? branch.name).finally(() => setCheckingOut(null));
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
          onClick={() => void gitActions.pull()}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
          {t("git.pull")}
        </Button>
        <Button
          className="git-toolbar-button"
          size="toolbar"
          variant="ghost"
          disabled={gitBusy || detached}
          title={detached ? t("git.pullPushDisabledDetached") : undefined}
          onClick={() => void gitActions.push()}
        >
          <ArrowUpFromLine className="h-3.5 w-3.5" />
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
            checkingOut={checkingOut}
          />
        </>
      ) : null}

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
          <button
            type="button"
            className="git-branch-leaf-checkout"
            disabled={checkingOut !== null}
            onClick={() => onCheckout(branch)}
          >
            {isCheckingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("git.checkout")}
          </button>
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
