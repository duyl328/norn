import { GitBranch, Settings, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useWorkbenchStore } from "../store/workbench-store";
import type { GitWorkspaceState, SaveState, WorkbenchDocument } from "../types";
import { formatFileSize, getDocumentLines } from "../workbench-utils";
import { GitBranchMenu } from "./git-branch-menu";

export function StatusBar({
  document,
  gitWorkspace,
  isDirty,
  onOpenSettings,
  saveState,
}: {
  document: WorkbenchDocument;
  gitWorkspace: GitWorkspaceState;
  isDirty: boolean;
  onOpenSettings: () => void;
  saveState: SaveState;
}) {
  const lineCount = getDocumentLines(document).length;
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const hasGit = gitStatus !== null;
  const branchLabel =
    gitStatus?.branch ??
    (gitWorkspace.kind === "ready" ? gitWorkspace.inspection.branch : null) ??
    "—";
  const changeFiles = gitStatus?.changes.length ?? 0;
  const additions = gitStatus?.changes.reduce((total, change) => total + change.additions, 0) ?? 0;
  const deletions = gitStatus?.changes.reduce((total, change) => total + change.deletions, 0) ?? 0;
  const ahead = gitStatus?.ahead ?? 0;
  const behind = gitStatus?.behind ?? 0;
  const saveLabel =
    document.mode === "large-readonly"
      ? "Read-only"
      : saveState === "saving"
        ? "Saving..."
        : saveState === "error"
          ? "Save failed"
          : isDirty || document.isUntitled
            ? "Unsaved"
            : "Saved";

  return (
    <footer className="status-bar">
      <div className="flex min-w-0 items-center gap-3">
        <span className="status-token truncate">{document.path}</span>
        <span className="status-token">{lineCount} lines</span>
        {document.size ? <span className="status-token">{formatFileSize(document.size)}</span> : null}
        <span className="status-token">UTF-8</span>
        <span className="status-token">LF</span>
        {document.mode === "large-readonly" ? <span className="status-token">Read-only range</span> : null}
        <span className="status-token">{saveLabel}</span>
      </div>
      <div className="flex items-center gap-3">
        {!hasGit ? (
          <span className="status-token">
            <GitBranch className="h-3 w-3" />
            未打开 Git
          </span>
        ) : (
          <>
            <GitBranchMenu>
              <button type="button" className="status-token status-token-button">
                <GitBranch className="h-3 w-3" />
                {branchLabel}
                {ahead > 0 ? <span className="status-ahead">↑{ahead}</span> : null}
                {behind > 0 ? <span className="status-behind">↓{behind}</span> : null}
              </button>
            </GitBranchMenu>
            {changeFiles > 0 ? (
              <span className="status-token">
                {changeFiles} 个文件
                <span className="status-additions">+{additions}</span>
                <span className="status-deletions">−{deletions}</span>
              </span>
            ) : null}
          </>
        )}
        <span className="status-token">
          <Terminal className="h-3 w-3" />
          Tauri 2
        </span>
        <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onOpenSettings}>
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </footer>
  );
}
