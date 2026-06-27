import { GitBranch, Settings, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";
import type { GitWorkspaceState, SaveState, TextEncodingOption, WorkbenchDocument } from "../types";
import { formatFileSize, getDocumentLines, getTailPath, textEncodingOptions } from "../workbench-utils";
import { GitBranchMenu } from "./git-branch-menu";

export function StatusBar({
  document,
  gitWorkspace,
  isDirty,
  onChangeEncoding,
  onOpenSettings,
  saveState,
}: {
  document: WorkbenchDocument;
  gitWorkspace: GitWorkspaceState;
  isDirty: boolean;
  onChangeEncoding: (option: TextEncodingOption) => void;
  onOpenSettings: () => void;
  saveState: SaveState;
}) {
  const { t } = useI18n();
  const lineCount = getDocumentLines(document).length;
  const documentPathLabel = getTailPath(document.path, 34);
  const encodingLabel = document.encodingLabel ?? "UTF-8";
  const encodingCandidates = document.encodingCandidates ?? [];
  const candidateEncodingSet = new Set(encodingCandidates.map((candidate) => candidate.encoding));
  const remainingEncodingOptions = textEncodingOptions.filter((option) => !candidateEncodingSet.has(option.value));
  const validCandidateCount = encodingCandidates.filter((candidate) => candidate.valid).length;
  const isEncodingAmbiguous =
    validCandidateCount > 1 &&
    encodingCandidates.some((candidate) => candidate.valid && !candidate.recommended && candidate.confidence >= 0.55);
  const triggerEncodingLabel = isEncodingAmbiguous ? `${encodingLabel} ?` : encodingLabel;
  const [pathCopied, setPathCopied] = useState(false);
  const pathCopiedTimeoutRef = useRef<number | null>(null);
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const gitBranches = useWorkbenchStore((state) => state.gitBranches);
  const hasGit = gitWorkspace.kind === "ready" && gitWorkspace.inspection.isRepository;
  const branchLabel =
    gitStatus?.branch ??
    gitBranches?.current ??
    (gitWorkspace.kind === "ready" ? gitWorkspace.inspection.branch : null) ??
    "-";
  const changeFiles = gitStatus?.changes.length ?? 0;
  const additions = gitStatus?.changes.reduce((total, change) => total + change.additions, 0) ?? 0;
  const deletions = gitStatus?.changes.reduce((total, change) => total + change.deletions, 0) ?? 0;
  const ahead = gitStatus?.ahead ?? 0;
  const behind = gitStatus?.behind ?? 0;
  const saveLabel =
    document.mode === "large-readonly"
      ? t("status.save.readonly")
      : saveState === "saving"
        ? t("status.save.saving")
        : saveState === "error"
          ? t("status.save.error")
          : isDirty || document.isUntitled
            ? t("status.save.unsaved")
            : t("status.save.saved");

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
        <span className="status-token">{t("status.lines", { count: lineCount })}</span>
        {document.size ? <span className="status-token">{formatFileSize(document.size)}</span> : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="status-token status-token-button"
              type="button"
              title={isDirty ? t("status.encoding.changeSave") : t("status.encoding.reopen")}
            >
              {triggerEncodingLabel}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-64">
            <DropdownMenuLabel>
              {isDirty ? t("status.encoding.save") : t("status.encoding.reopen")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {encodingCandidates.length > 0 ? (
              <>
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  {t("status.encoding.detected")}
                </DropdownMenuLabel>
                {encodingCandidates.slice(0, 5).map((candidate) => (
                  <DropdownMenuRadioItem
                    key={`candidate-${candidate.encoding}`}
                    value={candidate.encoding}
                    disabled={!candidate.valid}
                    onSelect={() => {
                      const option = textEncodingOptions.find((item) => item.value === candidate.encoding);

                      if (option) {
                        onChangeEncoding(option);
                      }
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{candidate.label}</span>
                    <span className="ml-3 font-mono text-ui-sm text-muted-foreground">
                      {candidate.valid ? candidate.confidence.toFixed(2) : t("status.encoding.invalid")}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
                {remainingEncodingOptions.length > 0 ? <DropdownMenuSeparator /> : null}
              </>
            ) : null}
            {remainingEncodingOptions.length > 0 ? (
              <>
                <DropdownMenuLabel className="font-normal text-muted-foreground">
                  {t("status.encoding.all")}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={document.encoding ?? "utf-8"}>
                  {remainingEncodingOptions.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                      onSelect={() => onChangeEncoding(option)}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="status-token">LF</span>
        {document.mode === "large-readonly" ? <span className="status-token">{t("status.readonlyRange")}</span> : null}
        <span className="status-token">{saveLabel}</span>
      </div>
      <div className="status-right-tokens">
        {hasGit ? (
          <>
            <GitBranchMenu>
              <button type="button" className="status-token status-token-button" title={t("status.gitBranchesTitle")}>
                <GitBranch className="h-3 w-3" />
                {branchLabel}
                {ahead > 0 ? <span className="status-ahead">+{ahead}</span> : null}
                {behind > 0 ? <span className="status-behind">-{behind}</span> : null}
              </button>
            </GitBranchMenu>
            {changeFiles > 0 ? (
              <span className="status-token">
                {t("status.files", { count: changeFiles })}
                <span className="status-additions">+{additions}</span>
                <span className="status-deletions">-{deletions}</span>
              </span>
            ) : null}
          </>
        ) : null}
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
