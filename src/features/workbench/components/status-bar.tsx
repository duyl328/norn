import { GitBranch } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useWorkbenchStore } from "../store/workbench-store";
import type { GitWorkspaceState, TextEncodingOption, WorkbenchDocument } from "../types";
import { getDocumentLines, getTailPath, textEncodingOptions } from "../workbench-utils";
import { GitBranchMenu } from "./git-branch-menu";

type LineEnding = "crlf" | "lf";

const getLineEnding = (content: string): LineEnding => (content.includes("\r\n") ? "crlf" : "lf");
const lineEndingLabel = (lineEnding: LineEnding) => lineEnding.toUpperCase();

const parseGoToLocation = (raw: string): { column?: number; line: number } | null => {
  const value = raw.trim();
  if (!value) return null;

  const labeled = value.match(/(?:ln|line)\s*(\d+)(?:\D+(?:col|column)?\s*(\d+))?/i);
  if (labeled) {
    return {
      line: Number.parseInt(labeled[1], 10),
      column: labeled[2] ? Number.parseInt(labeled[2], 10) : undefined,
    };
  }

  const numbers = value.match(/\d+/g);
  if (!numbers?.length) return null;

  return {
    line: Number.parseInt(numbers[0], 10),
    column: numbers[1] ? Number.parseInt(numbers[1], 10) : undefined,
  };
};

export function StatusBar({
  cursorPosition,
  document,
  gitWorkspace,
  goToLineRequestId,
  isDirty,
  onCancelGoToLine,
  onChangeEncoding,
  onChangeLineEnding,
  onGoToLine,
}: {
  cursorPosition: { column: number; line: number };
  document: WorkbenchDocument;
  gitWorkspace: GitWorkspaceState;
  goToLineRequestId: number;
  isDirty: boolean;
  onCancelGoToLine: () => void;
  onChangeEncoding: (option: TextEncodingOption) => void;
  onChangeLineEnding: (lineEnding: LineEnding) => void;
  onGoToLine: (line: number, column?: number) => void;
}) {
  const totalLines = getDocumentLines(document).length;
  const documentPathLabel = getTailPath(document.path, 34);
  const lineEnding = getLineEnding(document.content);
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
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineMode, setGoToLineMode] = useState<"inline" | "popover">("inline");
  const [goToLineValue, setGoToLineValue] = useState("");
  const pathCopiedTimeoutRef = useRef<number | null>(null);
  const handledGoToLineRequestRef = useRef(goToLineRequestId);
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

  const openGoToLineInput = useCallback((mode: "inline" | "popover") => {
    setGoToLineMode(mode);
    setGoToLineValue(`${cursorPosition.line},${cursorPosition.column}`);
    setGoToLineOpen(true);
  }, [cursorPosition.column, cursorPosition.line]);

  const submitGoToLine = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const location = parseGoToLocation(goToLineValue);
    if (!location) {
      return;
    }

    onGoToLine(location.line, location.column);
    setGoToLineOpen(false);
  };

  useEffect(() => {
    if (goToLineRequestId <= 0) return;
    if (handledGoToLineRequestRef.current === goToLineRequestId) return;
    handledGoToLineRequestRef.current = goToLineRequestId;

    openGoToLineInput("popover");
  }, [goToLineRequestId, openGoToLineInput]);

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
        {goToLineOpen && goToLineMode === "inline" ? null : (
          <button
            className="status-token status-token-button status-cursor-position"
            type="button"
            title={`Go to line, 1-${totalLines}`}
            onClick={() => openGoToLineInput("inline")}
          >
            Ln {Math.min(cursorPosition.line, totalLines)}, Col {Math.max(cursorPosition.column, 1)}
          </button>
        )}
        {goToLineOpen ? (
          <form
            className={goToLineMode === "popover" ? "status-goto-line-popover" : "status-goto-line-form"}
            onSubmit={submitGoToLine}
          >
            {goToLineMode === "popover" ? <label htmlFor="status-goto-line-input">Go to line</label> : null}
            <input
              id="status-goto-line-input"
              aria-label="Go to line"
              autoFocus
              className={goToLineMode === "popover" ? "status-goto-line-popover-input" : "status-goto-line-input"}
              inputMode="text"
              title={`Go to line, 1-${totalLines}. Examples: 42, 42:8, 42,8`}
              value={goToLineValue}
              onBlur={() => setGoToLineOpen(false)}
              onChange={(event) => setGoToLineValue(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setGoToLineOpen(false);
                  onCancelGoToLine();
                }
              }}
            />
          </form>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="status-token status-token-button status-encoding-trigger"
              type="button"
              title={isDirty ? "Change save encoding" : "Reopen with encoding"}
            >
              {triggerEncodingLabel}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="status-encoding-menu w-64" sideOffset={8}>
            <DropdownMenuLabel>{isDirty ? "Save encoding" : "Reopen with encoding"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {encodingCandidates.length > 0 ? (
              <>
                <DropdownMenuLabel className="font-normal text-muted-foreground">Detected candidates</DropdownMenuLabel>
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
                      {candidate.valid ? candidate.confidence.toFixed(2) : "invalid"}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
                {remainingEncodingOptions.length > 0 ? <DropdownMenuSeparator /> : null}
              </>
            ) : null}
            {remainingEncodingOptions.length > 0 ? (
              <>
                <DropdownMenuLabel className="font-normal text-muted-foreground">All encodings</DropdownMenuLabel>
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="status-token status-token-button status-line-ending-trigger"
              type="button"
              title="Change line ending"
              disabled={document.mode === "large-readonly" || document.mode === "diff"}
            >
              {lineEndingLabel(lineEnding)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="status-glass-menu w-36" sideOffset={8}>
            <DropdownMenuLabel>Line ending</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={lineEnding}>
              <DropdownMenuRadioItem value="lf" onSelect={() => onChangeLineEnding("lf")}>
                LF
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="crlf" onSelect={() => onChangeLineEnding("crlf")}>
                CRLF
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {document.mode === "large-readonly" ? <span className="status-token">Read-only range</span> : null}
      </div>
      <div className="status-right-tokens">
        {hasGit ? (
          <>
            <GitBranchMenu>
              <button type="button" className="status-token status-token-button" title="查看和切换 Git 分支">
                <GitBranch className="h-3 w-3" />
                {branchLabel}
                {ahead > 0 ? <span className="status-ahead">+{ahead}</span> : null}
                {behind > 0 ? <span className="status-behind">-{behind}</span> : null}
              </button>
            </GitBranchMenu>
            {changeFiles > 0 ? (
              <span className="status-token">
                {changeFiles} files
                <span className="status-additions">+{additions}</span>
                <span className="status-deletions">-{deletions}</span>
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </footer>
  );
}
