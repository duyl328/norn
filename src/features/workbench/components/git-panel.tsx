import {
  ChevronDown,
  ChevronRight,
  EyeOff,
  FileDiff,
  FilePlus2,
  GitCommitVertical,
  GitFork,
  History,
  RefreshCw,
  X,
} from "lucide-react";
import { type ComponentType, type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { gitActions } from "../hooks/use-git";
import { useI18n } from "../i18n";
import { useWorkbenchStore } from "../store/workbench-store";
import type {
  FolderView,
  GitBranches,
  GitChangeStatus,
  GitError,
  GitPanelMode,
  GitStatus,
  GitWorkspaceState,
} from "../types";
import { GitBranchesPane } from "./git-branches-pane";
import { GitChangesTree } from "./git-changes-tree";
import { GitHistoryPane } from "./git-history";
import { GitIgnoredTree } from "./git-ignored-tree";
import { useRailRowInset } from "./use-rail-row-inset";

const PANEL_MODES: {
  key: GitPanelMode;
  icon: ComponentType<{ className?: string }>;
  labelKey: "git.mode.commit" | "git.mode.branch" | "git.mode.history";
}[] = [
  { key: "commit", icon: GitCommitVertical, labelKey: "git.mode.commit" },
  { key: "branch", icon: GitFork, labelKey: "git.mode.branch" },
  { key: "history", icon: History, labelKey: "git.mode.history" },
];

const RefreshButton = ({ busy }: { busy: boolean }) => {
  const { t } = useI18n();
  const refreshing = useWorkbenchStore((state) => state.gitRefreshing);

  return (
    <Button
      size="toolbar"
      variant="ghost"
      className="git-toolbar-button"
      onClick={() => void gitActions.refresh()}
      disabled={busy || refreshing}
    >
      <RefreshCw className={cn("h-3.5 w-3.5", (busy || refreshing) && "animate-spin")} />
      {t("git.refresh")}
    </Button>
  );
};

// 各模式里会被右上角竖排标签盖住的行/卡片,交给 useRailRowInset 逐个判断、缩进。
const COMMIT_ROW_SELECTOR = ".git-tree-file, .git-tree-folder, .git-ignored-row, .git-ignored-head";
const BRANCH_ROW_SELECTOR =
  ".git-branch-summary, .git-branches-toolbar, .git-branches-group-label, .git-branch-leaf, .git-branch-folder, .git-branch-empty, .git-branch-relationship";

export function GitPanel({
  folderView,
  gitWorkspace,
  onOpenCommitDiff,
  onOpenDiff,
  onOpenFile,
  onOpenFolder,
}: {
  folderView: FolderView | null;
  gitWorkspace: GitWorkspaceState;
  onOpenCommitDiff: (hash: string, file: string) => void;
  onOpenDiff: (file: string) => void;
  onOpenFile: (path: string, size?: number) => void;
  onOpenFolder: (path: string) => void;
}) {
  const { t } = useI18n();
  const mode = useWorkbenchStore((state) => state.gitPanelMode);
  const setMode = useWorkbenchStore((state) => state.setGitPanelMode);
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const gitBranches = useWorkbenchStore((state) => state.gitBranches);

  const count = PANEL_MODES.length;
  const index = Math.max(
    0,
    PANEL_MODES.findIndex((item) => item.key === mode),
  );
  const paneHeight = `${100 / count}%`;
  const hasWorkspace = Boolean(folderView);
  const shouldShowWorkspaceNotice =
    !hasWorkspace || gitWorkspace.kind !== "ready" || !gitWorkspace.inspection.isRepository;

  return (
    <div className="git-panel-shell">
      <div className="git-panel-stack">
        {shouldShowWorkspaceNotice ? (
          <GitWorkspaceNoticePanel gitWorkspace={gitWorkspace} hasWorkspace={hasWorkspace} />
        ) : (
          // N 个模式纵向堆叠,切换时整条 track 上下滑动 = 模式切换的「上下滚动」手感。
          <div
            className="git-panel-track"
            style={{ height: `${count * 100}%`, transform: `translateY(-${(index * 100) / count}%)` } as CSSProperties}
          >
            <div className="git-panel-pane" style={{ height: paneHeight }} aria-hidden={mode !== "commit"}>
              <GitCommitMode onOpenDiff={onOpenDiff} onOpenFile={onOpenFile} />
            </div>
            <div className="git-panel-pane" style={{ height: paneHeight }} aria-hidden={mode !== "branch"}>
              <GitBranchMode onOpenFolder={onOpenFolder} />
            </div>
            <div className="git-panel-pane" style={{ height: paneHeight }} aria-hidden={mode !== "history"}>
              <GitHistoryMode onOpenCommitDiff={onOpenCommitDiff} />
            </div>
          </div>
        )}
      </div>
      {shouldShowWorkspaceNotice ? null : (
        <div className="git-panel-rail" role="tablist" aria-orientation="vertical">
          {PANEL_MODES.map((item) => (
            <RailTab
              key={item.key}
              icon={item.icon}
              label={t(item.labelKey)}
              meta={getRailTabMeta(item.key, gitStatus, gitBranches)}
              active={mode === item.key}
              onClick={() => setMode(item.key)}
            />
          ))}
        </div>
      )}
      <GitPendingOpBanner />
      <GitToast />
    </div>
  );
}

/** 进行中的 revert/merge/cherry-pick(通常因冲突卡住)横幅:顶部醒目提示 + 「放弃」按钮,免去跑命令行。 */
function GitPendingOpBanner() {
  const { t } = useI18n();
  const pendingOp = useWorkbenchStore((state) => state.gitPendingOp);
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  if (!pendingOp) return null;

  const opLabel =
    pendingOp === "merge" ? t("git.opMerge") : pendingOp === "cherry-pick" ? t("git.opCherryPick") : t("git.opRevert");

  return (
    <div className="git-pending-banner" role="alert">
      <div className="git-pending-banner-text">
        <div className="git-pending-banner-title">{t("git.pendingOpBanner", { op: opLabel })}</div>
        <div className="git-pending-banner-hint">{t("git.pendingOpHint")}</div>
      </div>
      <Button
        size="sm"
        variant="destructive"
        disabled={gitBusy}
        onClick={() => void gitActions.abortOp(pendingOp, t("git.toastOpAborted", { op: opLabel }))}
      >
        {t("git.abortOp")}
      </Button>
    </div>
  );
}

/** 写操作后的临时提示条:成功绿色一闪、失败红色显示原因，几秒后自动消失，可点 × 关闭。所有模式可见。 */
function GitToast() {
  const { t } = useI18n();
  const notice = useWorkbenchStore((state) => state.gitNotice);
  const setGitNotice = useWorkbenchStore((state) => state.setGitNotice);

  useEffect(() => {
    // 成功提示 3.2s 自动消失;错误保留(需手动 × 关闭),方便阅读 / 复制排查。
    if (!notice || notice.tone !== "ok") return;
    const timer = window.setTimeout(() => setGitNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice, setGitNotice]);

  if (!notice) return null;
  const text = notice.tone === "ok" ? notice.text : getGitErrorHint(notice.error, t);

  return (
    <div className={cn("git-toast", notice.tone === "ok" ? "git-toast-ok" : "git-toast-err")} role="status">
      <span className="git-toast-text">{text}</span>
      <button type="button" className="git-toast-close" aria-label={t("common.cancel")} onClick={() => setGitNotice(null)}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function RailTab({
  active,
  icon: Icon,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn("git-rail-tab", active && "git-rail-tab-active")}
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      <span className="git-rail-tab-label">{label}</span>
      {meta ? <span className="git-rail-tab-meta">{meta}</span> : null}
    </button>
  );
}

function getRailTabMeta(
  mode: GitPanelMode,
  gitStatus: GitStatus | null,
  gitBranches: GitBranches | null,
): string | undefined {
  if (mode === "commit") {
    const count = gitStatus?.changes.length ?? 0;
    return count > 0 ? String(count) : undefined;
  }
  if (mode === "branch") {
    const count = (gitBranches?.local.length ?? 0) + (gitBranches?.remote.length ?? 0);
    const behind = gitStatus?.behind ?? 0;
    return behind > 0 ? `${count} ↓${behind}` : count > 0 ? String(count) : undefined;
  }
  return undefined;
}

function GitCommitMode({
  onOpenDiff,
  onOpenFile,
}: {
  onOpenDiff: (file: string) => void;
  onOpenFile: (path: string, size?: number) => void;
}) {
  const { t } = useI18n();
  const gitStatus = useWorkbenchStore((state) => state.gitStatus);
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const gitError = useWorkbenchStore((state) => state.gitError);
  const bodyRef = useRef<HTMLDivElement>(null);
  useRailRowInset(bodyRef, COMMIT_ROW_SELECTOR);
  const changes = gitStatus?.changes ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // 记录被取消勾选的文件;新文件默认勾选(选中=不在该集合中),刷新无需重新同步。
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const changeCount = changes.length;
  const hasChanges = changeCount > 0;
  // 已跟踪改动进主区;未跟踪(新文件)挪到底部单独分组(类似 IDEA)。提交集合仍含勾选的未跟踪文件。
  const tracked = changes.filter((change) => change.status !== "untracked");
  const untracked = changes.filter((change) => change.status === "untracked");
  const selectedFiles = changes.filter((change) => !unchecked.has(change.path)).map((change) => change.path);

  const togglePaths = (paths: string[], value: boolean) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (value) {
          next.delete(path);
        } else {
          next.add(path);
        }
      }
      return next;
    });

  const treeProps = {
    isChecked: (path: string) => !unchecked.has(path),
    onAddIgnore: (entry: string) => void gitActions.addToGitignore(entry),
    onOpen: onOpenDiff,
    onSelect: setSelectedPath,
    onTogglePaths: togglePaths,
    selectedPath,
  };

  return (
    <RightTaskPanel
      toolbar={<RefreshButton busy={gitBusy} />}
      footer={<GitCommitBox disabled={!hasChanges} busy={gitBusy} files={selectedFiles} />}
    >
      <div className="git-panel-body" ref={bodyRef}>
        {gitError ? <GitErrorNotice error={gitError} /> : null}
        {hasChanges ? (
          <>
            {tracked.length > 0 ? (
              <GitFoldSection icon={FileDiff} title={t("git.uncommitted")} count={tracked.length} defaultOpen>
                <GitChangesTree changes={tracked} {...treeProps} />
              </GitFoldSection>
            ) : null}
            {untracked.length > 0 ? (
              <GitFoldSection icon={FilePlus2} title={t("git.untracked")} count={untracked.length}>
                <GitChangesTree changes={untracked} {...treeProps} />
              </GitFoldSection>
            ) : null}
          </>
        ) : (
          <div className="git-panel-clean">
            <div className="git-panel-clean-title">{t("git.cleanTitle")}</div>
            <div className="git-panel-clean-description">{t("git.cleanDescription")}</div>
          </div>
        )}
        <GitIgnoredSection onOpenFile={onOpenFile} />
      </div>
    </RightTaskPanel>
  );
}

/** 可折叠分组:标题栏 + 计数 + 限高滚动的内容区(未提交/未跟踪/已忽略共用)。 */
function GitFoldSection({
  children,
  count,
  defaultOpen = false,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  count: number;
  defaultOpen?: boolean;
  icon: ComponentType<{ className?: string }>;
  title: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="git-ignored-section">
      <button type="button" className="git-ignored-head" onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span>{title}</span>
        <span className="git-ignored-count">{count}</span>
      </button>
      {open ? <div className="git-fold-body">{children}</div> : null}
    </div>
  );
}

/** 底部「已忽略」区:被 .gitignore 忽略的条目;目录可展开看真实内容、文件可点击打开。 */
function GitIgnoredSection({ onOpenFile }: { onOpenFile: (path: string, size?: number) => void }) {
  const { t } = useI18n();
  const rootPath = useWorkbenchStore((state) => state.folderView?.rootPath ?? null);
  const items = useWorkbenchStore((state) => state.gitIgnoredFiles);

  if (items.length === 0 || !rootPath) {
    return null;
  }

  // 默认展开:每个忽略目录已折叠成单行(node_modules/、.idea/),展开也就几行,直接可见更直观。
  return (
    <GitFoldSection icon={EyeOff} title={t("git.ignored")} count={items.length} defaultOpen>
      <GitIgnoredTree entries={items} rootPath={rootPath} onOpenFile={onOpenFile} />
    </GitFoldSection>
  );
}

function GitBranchMode({ onOpenFolder }: { onOpenFolder: (path: string) => void }) {
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  const branchRef = useRef<HTMLDivElement>(null);
  useRailRowInset(branchRef, BRANCH_ROW_SELECTOR);
  return (
    <RightTaskPanel toolbar={<RefreshButton busy={gitBusy} />}>
      <div className="git-panel-body git-panel-body-flush" ref={branchRef}>
        <GitBranchesPane onOpenWorktree={onOpenFolder} />
      </div>
    </RightTaskPanel>
  );
}

function GitHistoryMode({ onOpenCommitDiff }: { onOpenCommitDiff: (hash: string, file: string) => void }) {
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);
  return (
    <RightTaskPanel toolbar={<RefreshButton busy={gitBusy} />} scroll={false}>
      <GitHistoryPane onOpenCommitDiff={onOpenCommitDiff} />
    </RightTaskPanel>
  );
}

export function GitCommitBox({ busy, disabled, files }: { busy: boolean; disabled: boolean; files: string[] }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState("");
  const fileCount = files.length;
  const canCommit = !disabled && !busy && summary.trim().length > 0 && fileCount > 0;
  // amend 可不填摘要(保留上一条说明)。
  const canAmend = !disabled && !busy && fileCount > 0;

  const submit = async (push: boolean, amend: boolean) => {
    const ok = await gitActions.commit(summary.trim(), push, files, amend);
    if (ok) {
      setSummary("");
    }
  };

  return (
    <div className="git-commit-box">
      <Textarea
        className="git-commit-summary"
        placeholder={t("git.commitSummaryPlaceholder")}
        disabled={disabled || busy}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
      />
      <div className="git-commit-actions">
        <span className="git-commit-hint">
          {disabled
            ? t("git.noCommitChanges")
            : fileCount > 0
              ? t("git.willCommitFiles", { count: fileCount })
              : t("git.noFilesSelected")}
        </span>
        <div className="git-commit-split">
          <Button
            className="git-action-button git-commit-split-main"
            size="sm"
            variant="ghost"
            disabled={!canCommit}
            onClick={() => void submit(false, false)}
          >
            {t("git.commit")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="git-action-button git-commit-split-caret"
                size="sm"
                variant="ghost"
                disabled={disabled || busy}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              <DropdownMenuItem disabled={!canCommit} onClick={() => void submit(true, false)}>
                {t("git.commitAndPush")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canAmend} onClick={() => void submit(false, true)}>
                {t("git.amendCommit")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

export function GitWorkspaceNotice({
  busy,
  gitWorkspace,
  hasWorkspace,
}: {
  busy: boolean;
  gitWorkspace: GitWorkspaceState;
  hasWorkspace: boolean;
}) {
  const { t } = useI18n();
  const title =
    gitWorkspace.kind === "loading"
      ? t("git.detecting")
      : !hasWorkspace
        ? t("git.noWorkspace")
        : gitWorkspace.kind === "error"
          ? t("git.detectFailed")
          : t("git.notRepo");
  const description =
    gitWorkspace.kind === "loading"
      ? t("git.detectingDescription")
      : !hasWorkspace
        ? t("git.noWorkspaceDescription")
        : gitWorkspace.kind === "ready"
          ? gitWorkspace.inspection.message
          : gitWorkspace.kind === "error"
            ? gitWorkspace.message
            : t("git.readyDescription");

  return (
    <div className="git-workspace-notice">
      <div className="git-workspace-notice-title">{title}</div>
      <div className="git-workspace-notice-description">{description}</div>
      {hasWorkspace ? (
        <Button
          className="git-action-button"
          size="sm"
          variant="ghost"
          disabled={busy || gitWorkspace.kind === "loading"}
          onClick={() => void gitActions.initRepo()}
        >
          {t("git.createRepo")}
        </Button>
      ) : null}
    </div>
  );
}

function GitWorkspaceNoticePanel({
  gitWorkspace,
  hasWorkspace,
}: {
  gitWorkspace: GitWorkspaceState;
  hasWorkspace: boolean;
}) {
  const gitBusy = useWorkbenchStore((state) => state.gitBusy);

  return (
    <RightTaskPanel toolbar={<RefreshButton busy={gitBusy} />}>
      <div className="git-panel-body">
        <GitWorkspaceNotice busy={gitBusy} gitWorkspace={gitWorkspace} hasWorkspace={hasWorkspace} />
      </div>
    </RightTaskPanel>
  );
}

function GitErrorNotice({ error }: { error: GitError }) {
  const { t } = useI18n();

  return (
    <div className="git-error-notice">
      <div className="git-error-notice-title">{t("git.operationIncomplete")}</div>
      <div className="git-error-notice-message">{getGitErrorHint(error, t)}</div>
    </div>
  );
}

function getGitErrorHint(error: GitError, t: ReturnType<typeof useI18n>["t"]): string {
  switch (error.kind) {
    case "identity-missing":
      return t("git.error.identityMissing");
    case "auth-failed":
      return t("git.error.authFailed");
    case "no-upstream":
      return t("git.error.noUpstream");
    case "nothing-to-commit":
      return t("git.error.nothingToCommit");
    case "conflict":
      return error.message ?? t("git.error.conflict");
    case "git-not-found":
      return t("git.error.notFound");
    default:
      return error.message ?? t("git.error.default");
  }
}

export function RightTaskPanel({
  badge,
  children,
  eyebrow,
  footer,
  scroll = true,
  title,
  toolbar,
}: {
  badge?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  footer?: ReactNode;
  // 内容是否套外层滚动区。历史模式自管内部滚动(图谱滚动 + 详情固定),关掉外层。
  scroll?: boolean;
  title?: string;
  toolbar?: ReactNode;
}) {
  const showHeader = Boolean(eyebrow || title);
  return (
    <aside className="right-task-panel">
      {showHeader ? (
        <div className="right-task-panel-header">
          <div className="min-w-0">
            {eyebrow ? <div className="right-task-panel-eyebrow">{eyebrow}</div> : null}
            {title ? <div className="right-task-panel-title">{title}</div> : null}
          </div>
          {badge ? <div className="right-task-panel-badge">{badge}</div> : null}
        </div>
      ) : null}
      {toolbar || (!showHeader && badge) ? (
        <div className="right-task-panel-toolbar" data-tauri-drag-region>
          {!showHeader && badge ? <div className="mr-auto">{badge}</div> : null}
          {toolbar}
        </div>
      ) : null}
      {scroll ? (
        <ScrollArea className="right-task-panel-content">{children}</ScrollArea>
      ) : (
        <div className="right-task-panel-content flex min-h-0 flex-col">{children}</div>
      )}
      {footer ? <div className="right-task-panel-footer">{footer}</div> : null}
    </aside>
  );
}

export function getChangeStatusLabel(status: GitChangeStatus) {
  const labels: Record<GitChangeStatus, string> = {
    added: "A",
    conflict: "!",
    deleted: "D",
    modified: "M",
    renamed: "R",
    untracked: "?",
  };

  return labels[status];
}
