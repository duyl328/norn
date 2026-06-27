import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  GitBranchPlus,
  GitMerge,
  History,
  ListTree,
  RefreshCw,
  Search,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { gitActions } from "../hooks/use-git";
import { useWorkbenchStore } from "../store/workbench-store";
import type { GitBranch } from "../types";

export function GitBranchMenu({ children }: { children: ReactNode }) {
  const branches = useWorkbenchStore((state) => state.gitBranches);
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const recentCommits = useWorkbenchStore((state) => state.gitRecentCommits);
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const setPanelMode = useWorkbenchStore((state) => state.setGitPanelMode);
  const setRightPanelOpen = useWorkbenchStore((state) => state.setRightPanelOpen);
  const [filter, setFilter] = useState("");

  const openBranches = () => {
    setRightPanelOpen(true);
    setPanelMode("branch");
  };

  const openHistory = () => {
    setRightPanelOpen(true);
    setPanelMode("history");
  };

  const matches = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());
  const localBranches = (branches?.local ?? []).filter((branch) => matches(branch.name));
  const remoteBranches = (branches?.remote ?? []).filter((branch) => matches(branch.name));

  const currentBranch = gitStatus?.branch ?? branches?.current ?? "—";
  const currentLocalBranch = branches?.local.find((branch) => branch.current || branch.name === currentBranch);
  const upstream = gitStatus?.upstream ?? currentLocalBranch?.upstream ?? "无上游";
  const ahead = gitStatus?.ahead ?? currentLocalBranch?.ahead ?? 0;
  const behind = gitStatus?.behind ?? currentLocalBranch?.behind ?? 0;

  const createBranch = () => {
    const name = window.prompt("从当前分支新建分支，输入名称：");
    if (name && name.trim()) {
      void gitActions.createBranch(name.trim());
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="git-branch-menu">
        <div className="git-branch-current">
          <div className="git-branch-current-label">当前分支</div>
          <div className="git-branch-current-name">{currentBranch}</div>
          <div className="git-branch-current-meta">
            <span>{upstream}</span>
            <span className="git-branch-track">
              <span className="git-branch-ahead">↑{ahead}</span>
              <span className="git-branch-behind">↓{behind}</span>
            </span>
          </div>
        </div>

        <div className="git-branch-actions-row">
          <DropdownMenuItem className="git-branch-action" onClick={openBranches}>
            <ListTree className="h-3.5 w-3.5" />
            分支面板
          </DropdownMenuItem>
          <DropdownMenuItem
            className="git-branch-action"
            disabled={gitBusy}
            onClick={() => void gitActions.refresh()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            刷新
          </DropdownMenuItem>
        </div>

        <div className="git-branch-actions-row">
          <DropdownMenuItem
            className="git-branch-action"
            disabled={gitBusy}
            onClick={() => void gitActions.pull()}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            拉取
          </DropdownMenuItem>
          <DropdownMenuItem
            className="git-branch-action"
            disabled={gitBusy}
            onClick={() => void gitActions.push()}
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            推送
          </DropdownMenuItem>
        </div>

        <div className="git-branch-actions-row git-branch-actions-row-single">
          <DropdownMenuItem className="git-branch-action" onClick={openHistory}>
            <History className="h-3.5 w-3.5" />
            版本演进图
          </DropdownMenuItem>
        </div>

        <div className="git-branch-search">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            className="git-branch-search-input"
            placeholder="过滤分支…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>

        <DropdownMenuLabel>本地分支</DropdownMenuLabel>
        {localBranches.length > 0 ? (
          localBranches.map((branch) => (
            <BranchRow key={branch.name} branch={branch} onSelect={() => void gitActions.checkout(branch.name)} />
          ))
        ) : (
          <div className="git-branch-empty">{branches ? "无匹配分支" : "点击刷新加载分支列表"}</div>
        )}

        {remoteBranches.length > 0 ? (
          <>
            <DropdownMenuLabel>远程分支</DropdownMenuLabel>
            {remoteBranches.map((branch) => {
              const localName = branch.name.replace(/^[^/]+\//, "");
              return (
                <BranchRow
                  key={branch.name}
                  branch={branch}
                  onSelect={() => void gitActions.checkout(localName)}
                />
              );
            })}
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="git-branch-action" disabled={gitBusy} onClick={createBranch}>
          <GitBranchPlus className="h-3.5 w-3.5" />
          从当前分支新建…
        </DropdownMenuItem>

        {recentCommits.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>最近提交</DropdownMenuLabel>
            <div className="git-lineage">
              {recentCommits.map((commit, index) => (
                <div className="git-lineage-row" key={commit.hash}>
                  <span className="git-lineage-rail" aria-hidden="true">
                    <span className={cn("git-lineage-dot", commit.isMerge && "git-lineage-dot-merge")}>
                      {commit.isMerge ? <GitMerge className="h-2.5 w-2.5" /> : null}
                    </span>
                    {index < recentCommits.length - 1 ? <span className="git-lineage-line" /> : null}
                  </span>
                  <span className="git-lineage-main">
                    <span className="git-lineage-subject">{commit.subject}</span>
                    <span className="git-lineage-meta">
                      {commit.author} · {commit.relativeTime} · {commit.hash}
                    </span>
                  </span>
                  {commit.refs.length > 0 ? (
                    <span className="git-lineage-refs">
                      {commit.refs.map((ref) => (
                        <span
                          key={ref}
                          className={cn("git-ref-badge", ref.startsWith("origin/") && "git-ref-badge-remote")}
                        >
                          {ref}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BranchRow({ branch, onSelect }: { branch: GitBranch; onSelect: () => void }) {
  const displayName = branch.kind === "remote" ? branch.name.replace(/^[^/]+\//, "") : branch.name;

  return (
    <DropdownMenuItem className="git-branch-item" onClick={branch.current ? undefined : onSelect}>
      <span className="git-branch-check">{branch.current ? <Check className="h-3.5 w-3.5" /> : null}</span>
      <span className="git-branch-name">
        {branch.kind === "remote" ? <span className="git-branch-remote-prefix">origin/</span> : null}
        {displayName}
      </span>
      {(branch.ahead || branch.behind) && !branch.current ? (
        <span className="git-branch-track">
          {branch.ahead ? <span className="git-branch-ahead">↑{branch.ahead}</span> : null}
          {branch.behind ? <span className="git-branch-behind">↓{branch.behind}</span> : null}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
