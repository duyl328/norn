import { Check, Search } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { gitActions } from "../hooks/use-git";
import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";
import type { GitBranch } from "../types";

export function GitBranchMenu({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const branches = useWorkbenchStore((state) => state.gitBranches);
  const [filter, setFilter] = useState("");

  const matches = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());
  const localBranches = (branches?.local ?? []).filter((branch) => matches(branch.name));
  const remoteBranches = (branches?.remote ?? []).filter((branch) => matches(branch.name));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="git-branch-menu status-glass-menu">
        <div className="git-branch-search">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            className="git-branch-search-input"
            placeholder={t("git.filterBranches")}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </div>

        <DropdownMenuLabel className="status-menu-label git-branch-section-label">{t("git.localBranches")}</DropdownMenuLabel>
        {localBranches.length > 0 ? (
          localBranches.map((branch) => (
            <BranchRow key={branch.name} branch={branch} onSelect={() => void gitActions.checkout(branch.name)} />
          ))
        ) : (
          <div className="git-branch-empty">{branches ? t("git.noMatchingBranches") : t("git.refreshToLoadBranches")}</div>
        )}

        {remoteBranches.length > 0 ? (
          <>
            <DropdownMenuLabel className="status-menu-label git-branch-section-label">
              {t("git.remoteBranches")}
            </DropdownMenuLabel>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BranchRow({ branch, onSelect }: { branch: GitBranch; onSelect: () => void }) {
  const displayName = branch.kind === "remote" ? branch.name.replace(/^[^/]+\//, "") : branch.name;

  return (
    <DropdownMenuItem className="git-branch-item" onClick={branch.current ? undefined : onSelect}>
      <span className="git-branch-check">{branch.current ? <Check className="h-3 w-3" /> : null}</span>
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
