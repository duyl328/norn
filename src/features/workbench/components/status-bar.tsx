import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { buildFileTree, type FileTreeNode } from "../change-tree";
import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";
import type { GitChange, GitWorkspaceState, TextEncodingOption, WorkbenchDocument } from "../types";
import {
  countContentCharacters,
  formatFileSize,
  getDocumentLines,
  getPathDisplayIcon,
  getTailPath,
  textEncodingOptions,
} from "../workbench-utils";
import { GitBranchMenu } from "./git-branch-menu";

type LineEnding = "crlf" | "lf";
type StatusChangeNode = FileTreeNode<GitChange>;

const getLineEnding = (content: string): LineEnding => (content.includes("\r\n") ? "crlf" : "lf");
const lineEndingLabel = (lineEnding: LineEnding) => lineEnding.toUpperCase();
const getStatusLabel = (status: GitChange["status"]) =>
  ({
    added: "A",
    conflict: "!",
    deleted: "D",
    modified: "M",
    renamed: "R",
    untracked: "?",
  })[status];

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
  onOpenDiff = () => {},
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
  onOpenDiff?: (file: string) => void;
}) {
  const { t } = useI18n();
  const totalLines = getDocumentLines(document).length;
  // 底部只读指标:文件大小 / 字符数 / 行数。按 content 记忆,避免每次光标移动都全量重算。
  const charCount = useMemo(() => countContentCharacters(document.content), [document.content]);
  const byteSize = useMemo(
    () =>
      document.mode === "large-readonly"
        ? (document.size ?? 0) // 大文件只读是窗口切片,内容不完整 → 用磁盘实际大小
        : new TextEncoder().encode(document.content).length,
    [document.content, document.mode, document.size],
  );
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
  const changes = gitStatus?.changes ?? [];
  const changeFiles = changes.length;
  const additions = changes.reduce((total, change) => total + change.additions, 0);
  const deletions = changes.reduce((total, change) => total + change.deletions, 0);
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
            title={t("status.gotoLine.title", { count: totalLines })}
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
            {goToLineMode === "popover" ? <label htmlFor="status-goto-line-input">{t("status.gotoLine.label")}</label> : null}
            <input
              id="status-goto-line-input"
              aria-label={t("status.gotoLine.label")}
              autoFocus
              className={goToLineMode === "popover" ? "status-goto-line-popover-input" : "status-goto-line-input"}
              inputMode="text"
              title={t("status.gotoLine.inputTitle", { count: totalLines })}
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
        <span
          className="status-token status-file-metrics"
          title={t("status.metrics.title", {
            size: byteSize,
            chars: charCount.toLocaleString(),
            lines: totalLines.toLocaleString(),
          })}
        >
          {formatFileSize(byteSize)} · {t("status.metrics.chars", { count: charCount.toLocaleString() })} ·{" "}
          {t("status.metrics.lines", { count: totalLines.toLocaleString() })}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="status-token status-token-button status-encoding-trigger"
              type="button"
              title={isDirty ? t("status.encoding.changeSave") : t("status.encoding.reopen")}
            >
              {triggerEncodingLabel}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="status-encoding-menu w-56" sideOffset={6}>
            <DropdownMenuLabel className="status-menu-label">
              {isDirty ? t("status.encoding.save") : t("status.encoding.reopen")}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {encodingCandidates.length > 0 ? (
              <>
                <DropdownMenuLabel className="status-menu-label font-normal text-muted-foreground">
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
                    <span className="status-encoding-confidence font-mono text-muted-foreground">
                      {candidate.valid ? candidate.confidence.toFixed(2) : t("status.encoding.invalid")}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
                {remainingEncodingOptions.length > 0 ? <DropdownMenuSeparator /> : null}
              </>
            ) : null}
            {remainingEncodingOptions.length > 0 ? (
              <>
                <DropdownMenuLabel className="status-menu-label font-normal text-muted-foreground">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="status-token status-token-button status-line-ending-trigger"
              type="button"
              title={t("status.lineEnding.change")}
              disabled={document.mode === "large-readonly" || document.mode === "diff"}
            >
              {lineEndingLabel(lineEnding)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="status-glass-menu" sideOffset={6}>
            <DropdownMenuLabel className="status-menu-label">{t("status.lineEnding.label")}</DropdownMenuLabel>
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
        {document.mode === "large-readonly" ? <span className="status-token">{t("status.readonlyRange")}</span> : null}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="status-token status-token-button status-changes-trigger"
                    title={t("status.changes.title", { count: changeFiles })}
                  >
                    {t("status.files", { count: changeFiles })}
                    <span className="status-additions">+{additions}</span>
                    <span className="status-deletions">-{deletions}</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top" className="status-changes-menu status-glass-menu" sideOffset={6}>
                  <DropdownMenuLabel className="status-menu-label">
                    {t("status.changes.title", { count: changeFiles })}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <StatusChangesTree changes={changes} onOpenDiff={onOpenDiff} />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        ) : null}
      </div>
    </footer>
  );
}

function StatusChangesTree({ changes, onOpenDiff }: { changes: GitChange[]; onOpenDiff: (file: string) => void }) {
  const tree = useMemo(() => buildFileTree(changes), [changes]);

  return (
    <div className="status-changes-tree">
      <StatusChangeNodes depth={0} nodes={tree} onOpenDiff={onOpenDiff} />
    </div>
  );
}

function StatusChangeNodes({
  depth,
  nodes,
  onOpenDiff,
}: {
  depth: number;
  nodes: StatusChangeNode[];
  onOpenDiff: (file: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <StatusChangeFolder key={`folder:${node.path}`} depth={depth} node={node} onOpenDiff={onOpenDiff} />
        ) : (
          <StatusChangeFile key={`file:${node.item.path}`} change={node.item} depth={depth} name={node.name} onOpenDiff={onOpenDiff} />
        ),
      )}
    </>
  );
}

function StatusChangeFolder({
  depth,
  node,
  onOpenDiff,
}: {
  depth: number;
  node: Extract<StatusChangeNode, { kind: "folder" }>;
  onOpenDiff: (file: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const count = countChangeFiles(node.children);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${node.name} ${count}`}
        className="status-change-folder"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="status-change-chevron" /> : <ChevronRight className="status-change-chevron" />}
        <StatusChangeIcon expanded={open} kind="directory" name={node.name} />
        <span className="status-change-folder-name">{node.name}</span>
        <span className="status-change-folder-count">{count}</span>
      </button>
      {open ? <StatusChangeNodes depth={depth + 1} nodes={node.children} onOpenDiff={onOpenDiff} /> : null}
    </>
  );
}

function StatusChangeFile({
  change,
  depth,
  name,
  onOpenDiff,
}: {
  change: GitChange;
  depth: number;
  name: string;
  onOpenDiff: (file: string) => void;
}) {
  const { t } = useI18n();

  return (
    <button
      type="button"
      className="status-change-row"
      style={{ paddingLeft: `${depth * 14 + 10}px` }}
      title={t("git.openDiffTitle", { path: change.path })}
      onClick={() => onOpenDiff(change.path)}
    >
      <StatusChangeIcon kind="file" name={name} />
      <span className="status-change-main">
        <span className="status-change-path">{name}</span>
        {change.previousPath ? <span className="status-change-previous">{getTailPath(change.previousPath, 42)}</span> : null}
      </span>
      <span className="status-change-stats">
        {change.additions ? <span className="status-additions">+{change.additions}</span> : null}
        {change.deletions ? <span className="status-deletions">-{change.deletions}</span> : null}
        <span className={`git-change-status git-change-status-${change.status}`}>{getStatusLabel(change.status)}</span>
      </span>
    </button>
  );
}

function StatusChangeIcon({
  expanded,
  kind,
  name,
}: {
  expanded?: boolean;
  kind: "directory" | "file";
  name: string;
}) {
  const { Icon, className } = getPathDisplayIcon(name, kind, expanded);

  return <Icon className={`status-change-icon ${className}`} />;
}

function countChangeFiles(nodes: StatusChangeNode[]): number {
  return nodes.reduce((count, node) => count + (node.kind === "file" ? 1 : countChangeFiles(node.children)), 0);
}
