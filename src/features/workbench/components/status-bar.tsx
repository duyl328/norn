import { GitPullRequest, Settings, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";

import { gitRepositoryMock } from "../mock-data";
import type { GitWorkspaceState, SaveState, WorkbenchDocument } from "../types";
import { formatFileSize, getDocumentLines } from "../workbench-utils";

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
  const gitStatusLabel =
    gitWorkspace.kind === "ready" && gitWorkspace.inspection.isRepository
      ? (gitWorkspace.inspection.branch ?? "Git 仓库")
      : gitWorkspace.kind === "loading"
        ? "检测 Git"
        : "未打开 Git";
  const gitChangeLabel =
    gitWorkspace.kind === "ready" && gitWorkspace.inspection.isRepository
      ? `${gitRepositoryMock.workingCount} 项变更`
      : "无变更数据";
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
        <span className="status-token">
          <GitPullRequest className="h-3 w-3" />
          {gitStatusLabel}
        </span>
        <span className="status-token">{gitChangeLabel}</span>
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
