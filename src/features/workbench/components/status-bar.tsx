import { GitBranch, Settings, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { gitChangeSummary, gitRepositoryMock } from "../mock-data";
import type { GitWorkspaceState, SaveState, WorkbenchDocument } from "../types";
import { formatFileSize, getDocumentLines, getTailPath } from "../workbench-utils";
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
  const documentPathLabel = getTailPath(document.path, 34);
  const [pathCopied, setPathCopied] = useState(false);
  const pathCopiedTimeoutRef = useRef<number | null>(null);
  // Mock 阶段:分支与改动量始终展示假数据的最终效果。
  const isNonRepository = gitWorkspace.kind === "ready" && !gitWorkspace.inspection.isRepository;
  const branchLabel =
    gitWorkspace.kind === "ready" && gitWorkspace.inspection.branch
      ? gitWorkspace.inspection.branch
      : gitRepositoryMock.branch;
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
  const copyDocumentPath = () => {
    const done = () => {
      if (pathCopiedTimeoutRef.current) {
        window.clearTimeout(pathCopiedTimeoutRef.current);
      }

      setPathCopied(true);
      pathCopiedTimeoutRef.current = window.setTimeout(() => {
        setPathCopied(false);
        pathCopiedTimeoutRef.current = null;
      }, 650);
    };

    const writePath = globalThis.navigator?.clipboard?.writeText(document.path);

    if (writePath) {
      void writePath.finally(done);
      return;
    }

    done();
  };

  useEffect(
    () => () => {
      if (pathCopiedTimeoutRef.current) {
        window.clearTimeout(pathCopiedTimeoutRef.current);
      }
    },
    [],
  );

  return (
    <footer className="status-bar">
      <div className="status-left-tokens">
        <button
          className={`status-token status-token-button status-path-token ${
            pathCopied ? "status-path-token-copied" : ""
          }`}
          aria-label={document.path}
          type="button"
          title={document.path}
          onClick={copyDocumentPath}
        >
          <span className="status-path-token-text">{documentPathLabel}</span>
        </button>
        <span className="status-token">{lineCount} lines</span>
        {document.size ? <span className="status-token">{formatFileSize(document.size)}</span> : null}
        <span className="status-token">UTF-8</span>
        <span className="status-token">LF</span>
        {document.mode === "large-readonly" ? <span className="status-token">Read-only range</span> : null}
        <span className="status-token">{saveLabel}</span>
      </div>
      <div className="status-right-tokens">
        {isNonRepository ? (
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
                {gitRepositoryMock.ahead > 0 ? <span className="status-ahead">↑{gitRepositoryMock.ahead}</span> : null}
                {gitRepositoryMock.behind > 0 ? (
                  <span className="status-behind">↓{gitRepositoryMock.behind}</span>
                ) : null}
              </button>
            </GitBranchMenu>
            <span className="status-token">
              {gitChangeSummary.files} 个文件
              <span className="status-additions">+{gitChangeSummary.additions}</span>
              <span className="status-deletions">−{gitChangeSummary.deletions}</span>
            </span>
          </>
        )}
        <span className="status-token">
          <Terminal className="h-3 w-3" />
          Tauri 2
        </span>
        <Button size="icon" variant="ghost" className="status-settings-button h-5 w-5" onClick={onOpenSettings}>
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </footer>
  );
}
