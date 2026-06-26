import { Check, ChevronDown, ChevronRight, GitBranch as GitBranchIcon, GitBranchPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { type BranchTreeNode,buildBranchTree } from "../branch-tree";
import { gitActions } from "../hooks/use-git";
import { useWorkbenchStore } from "../store/workbench-store";
import type { GitBranch, GitDivergence } from "../types";

/** 分支模式:本地/远程分支树（按 "/" 折叠）+ 选中分支的关系（上游、领先落后、独有提交）。 */
export function GitBranchesPane() {
  const branches = useWorkbenchStore((state) => state.gitBranches);
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const [selected, setSelected] = useState<string | null>(null);

  const local = branches?.local ?? [];
  const remote = branches?.remote ?? [];
  const localTree = buildBranchTree(local);
  const remoteTree = buildBranchTree(remote, "origin/");

  const createBranch = () => {
    const name = window.prompt("从当前分支新建分支，输入名称：");
    if (name && name.trim()) {
      void gitActions.createBranch(name.trim());
    }
  };

  return (
    <div className="git-branches">
      <div className="git-branches-toolbar">
        <Button size="toolbar" variant="ghost" disabled={gitBusy} onClick={createBranch}>
          <GitBranchPlus className="h-3.5 w-3.5" />
          新建分支
        </Button>
      </div>

      <div className="git-branches-group-label">本地</div>
      <BranchTree
        nodes={localTree}
        selected={selected}
        onSelect={setSelected}
        onCheckout={(branch) => void gitActions.checkout(branch.name)}
      />
      {local.length === 0 ? <div className="git-branch-empty">无本地分支</div> : null}

      {remote.length > 0 ? (
        <>
          <div className="git-branches-group-label">远程 · origin</div>
          <BranchTree
            nodes={remoteTree}
            selected={selected}
            onSelect={setSelected}
            onCheckout={(branch) => void gitActions.checkout(branch.name.replace(/^[^/]+\//, ""))}
          />
        </>
      ) : null}
    </div>
  );
}

function BranchTree({
  depth = 0,
  nodes,
  onCheckout,
  onSelect,
  selected,
}: {
  depth?: number;
  nodes: BranchTreeNode[];
  onCheckout: (branch: GitBranch) => void;
  onSelect: (name: string | null) => void;
  selected: string | null;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <BranchFolder
            key={`folder:${node.path}`}
            node={node}
            depth={depth}
            onCheckout={onCheckout}
            onSelect={onSelect}
            selected={selected}
          />
        ) : (
          <BranchLeaf
            key={`branch:${node.branch.name}`}
            node={node}
            depth={depth}
            onCheckout={onCheckout}
            onSelect={onSelect}
            selected={selected}
          />
        ),
      )}
    </>
  );
}

function BranchFolder({
  depth,
  node,
  onCheckout,
  onSelect,
  selected,
}: {
  depth: number;
  node: Extract<BranchTreeNode, { kind: "folder" }>;
  onCheckout: (branch: GitBranch) => void;
  onSelect: (name: string | null) => void;
  selected: string | null;
}) {
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
      {open ? (
        <BranchTree
          nodes={node.children}
          depth={depth + 1}
          onCheckout={onCheckout}
          onSelect={onSelect}
          selected={selected}
        />
      ) : null}
    </>
  );
}

function BranchLeaf({
  depth,
  node,
  onCheckout,
  onSelect,
  selected,
}: {
  depth: number;
  node: Extract<BranchTreeNode, { kind: "branch" }>;
  onCheckout: (branch: GitBranch) => void;
  onSelect: (name: string | null) => void;
  selected: string | null;
}) {
  const { branch } = node;
  const isSelected = branch.name === selected;

  return (
    <>
      <div
        className={cn("git-branch-leaf", isSelected && "git-branch-leaf-selected", branch.current && "git-branch-leaf-current")}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        <button
          type="button"
          className="git-branch-leaf-main"
          onClick={() => onSelect(isSelected ? null : branch.name)}
          onDoubleClick={() => !branch.current && onCheckout(branch)}
          title={`${branch.name}（双击切换）`}
        >
          <span className="git-branch-leaf-check">{branch.current ? <Check className="h-3.5 w-3.5" /> : <GitBranchIcon className="h-3.5 w-3.5 text-muted-foreground" />}</span>
          <span className="truncate">{node.name}</span>
          {branch.ahead || branch.behind ? (
            <span className="git-branch-track">
              {branch.ahead ? <span className="git-branch-ahead">↑{branch.ahead}</span> : null}
              {branch.behind ? <span className="git-branch-behind">↓{branch.behind}</span> : null}
            </span>
          ) : null}
        </button>
        {!branch.current ? (
          <button type="button" className="git-branch-leaf-checkout" onClick={() => onCheckout(branch)}>
            切换
          </button>
        ) : null}
      </div>
      {isSelected ? <BranchRelationship branch={branch} /> : null}
    </>
  );
}

function BranchRelationship({ branch }: { branch: GitBranch }) {
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
  }, [branch.name]);

  const base = divergence?.base ?? null;
  const ownCommits = divergence?.ownCommits ?? [];

  return (
    <div className="git-branch-relationship">
      <div className="git-branch-relationship-row">
        {branch.upstream ? (
          <span className="git-branch-relationship-chip">
            上游 {branch.upstream}
            {branch.ahead ? <span className="git-branch-ahead">↑{branch.ahead}</span> : null}
            {branch.behind ? <span className="git-branch-behind">↓{branch.behind}</span> : null}
          </span>
        ) : (
          <span className="git-branch-relationship-chip">无上游 · 仅本地</span>
        )}
        {base ? (
          <span className="git-branch-relationship-chip">
            vs {base}
            <span className="git-branch-ahead">领先{divergence?.aheadOfBase ?? 0}</span>
            <span className="git-branch-behind">落后{divergence?.behindBase ?? 0}</span>
          </span>
        ) : null}
      </div>

      {ownCommits.length > 0 ? (
        <div className="git-branch-relationship-commits">
          <div className="git-branch-relationship-label">{base ? `领先 ${base} 的提交` : "最近提交"}</div>
          {ownCommits.slice(0, 6).map((commit) => (
            <div className="git-branch-relationship-commit" key={commit.hash} title={commit.subject}>
              <span className="truncate">{commit.subject}</span>
              <span className="git-branch-relationship-meta">{commit.relativeTime}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="git-branch-empty">无独有提交</div>
      )}
    </div>
  );
}
