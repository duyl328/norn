import { Check, GitBranchPlus, GitMerge, Search } from "lucide-react";
import type { ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { gitBranches, type GitBranchItem, gitRecentCommits, gitRepositoryMock } from "../mock-data";

export function GitBranchMenu({ children }: { children: ReactNode }) {
  const localBranches = gitBranches.filter((branch) => branch.kind === "local");
  const remoteBranches = gitBranches.filter((branch) => branch.kind === "remote");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="git-branch-menu">
        <div className="git-branch-current">
          <div className="git-branch-current-label">当前分支</div>
          <div className="git-branch-current-name">{gitRepositoryMock.branch}</div>
          <div className="git-branch-current-meta">
            <span>{gitRepositoryMock.upstream}</span>
            <span className="git-branch-track">
              <span className="git-branch-ahead">↑{gitRepositoryMock.ahead}</span>
              <span className="git-branch-behind">↓{gitRepositoryMock.behind}</span>
            </span>
          </div>
        </div>

        <div className="git-branch-search">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            className="git-branch-search-input"
            placeholder="过滤分支…"
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>

        <DropdownMenuLabel>本地分支</DropdownMenuLabel>
        {localBranches.map((branch) => (
          <BranchRow key={branch.name} branch={branch} />
        ))}

        <DropdownMenuLabel>远程分支</DropdownMenuLabel>
        {remoteBranches.map((branch) => (
          <BranchRow key={branch.name} branch={branch} />
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem className="git-branch-action">
          <GitBranchPlus className="h-3.5 w-3.5" />
          从当前分支新建…
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>最近提交</DropdownMenuLabel>
        <div className="git-lineage">
          {gitRecentCommits.map((commit, index) => (
            <div className="git-lineage-row" key={commit.hash}>
              <span className="git-lineage-rail" aria-hidden="true">
                <span className={cn("git-lineage-dot", commit.isMerge && "git-lineage-dot-merge")}>
                  {commit.isMerge ? <GitMerge className="h-2.5 w-2.5" /> : null}
                </span>
                {index < gitRecentCommits.length - 1 ? <span className="git-lineage-line" /> : null}
              </span>
              <span className="git-lineage-main">
                <span className="git-lineage-subject">{commit.subject}</span>
                <span className="git-lineage-meta">
                  {commit.author} · {commit.relativeTime} · {commit.hash}
                </span>
              </span>
              {commit.refs && commit.refs.length > 0 ? (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BranchRow({ branch }: { branch: GitBranchItem }) {
  const displayName = branch.kind === "remote" ? branch.name.replace(/^origin\//, "") : branch.name;

  return (
    <DropdownMenuItem className="git-branch-item">
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
